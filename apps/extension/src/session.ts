import { base64UrlToBytes, bytesToBase64Url, zeroBytes } from "@zk-wallet/crypto";
import type { VaultClient, VaultPublicState, VaultSessionMaterialV1 } from "@zk-wallet/vault";

const SESSION_KEY = "zk-wallet.authorized-session.v1";
const ROOT_KEY_BYTES = 32;
const MAX_VAULT_ID_LENGTH = 128;

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export interface SessionBroadcastBus {
  publish(message: ExtensionSessionEvent): Promise<void> | void;
  subscribe(listener: (message: ExtensionSessionEvent) => void): () => void;
}

export type ExtensionSessionEvent =
  | { readonly epoch: number; readonly type: "locked"; readonly version: 1 }
  | {
      readonly epoch: number;
      readonly expiresAt: number;
      readonly type: "unlocked";
      readonly version: 1;
    };

interface StoredSessionV1 {
  readonly epoch: number;
  readonly expiresAt: number;
  readonly rootKey: string;
  readonly vaultId: string;
  readonly version: 1;
}

export interface ExtensionMessageSender {
  readonly id?: string;
  readonly origin?: string;
  readonly tab?: unknown;
  readonly url?: string;
}

export function isTrustedExtensionSender(
  sender: ExtensionMessageSender,
  extensionId: string,
  extensionOrigin: string,
): boolean {
  if (sender.id !== extensionId || sender.tab !== undefined) return false;
  const candidate = sender.origin ?? sender.url;
  if (candidate === undefined) return false;
  try {
    const parsed = new URL(candidate);
    const expected = new URL(extensionOrigin);
    return parsed.protocol === expected.protocol && parsed.host === expected.host;
  } catch {
    return false;
  }
}

function parseStoredSession(value: unknown): StoredSessionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "epoch,expiresAt,rootKey,vaultId,version" ||
    record.version !== 1 ||
    !Number.isSafeInteger(record.epoch) ||
    (record.epoch as number) < 1 ||
    !Number.isSafeInteger(record.expiresAt) ||
    (record.expiresAt as number) < 0 ||
    typeof record.vaultId !== "string" ||
    record.vaultId.length === 0 ||
    record.vaultId.length > MAX_VAULT_ID_LENGTH ||
    typeof record.rootKey !== "string"
  ) {
    throw new Error("invalid");
  }
  const decoded = base64UrlToBytes(record.rootKey);
  try {
    if (decoded.length !== ROOT_KEY_BYTES) throw new Error("invalid");
  } finally {
    zeroBytes(decoded);
  }
  return record as unknown as StoredSessionV1;
}

export class ExtensionSessionCoordinator {
  readonly #bus: SessionBroadcastBus;
  readonly #now: () => number;
  readonly #storage: SessionStorageArea;
  #epoch = 0;

  constructor(options: {
    readonly bus: SessionBroadcastBus;
    readonly now?: () => number;
    readonly storage: SessionStorageArea;
  }) {
    this.#bus = options.bus;
    this.#now = options.now ?? Date.now;
    this.#storage = options.storage;
  }

  async initialize(): Promise<void> {
    if (this.#storage.setAccessLevel === undefined) {
      throw new Error("Restricted extension session storage is unavailable");
    }
    await this.#storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }

  async load(): Promise<VaultSessionMaterialV1 | null> {
    let stored: StoredSessionV1;
    try {
      stored = parseStoredSession((await this.#storage.get(SESSION_KEY))[SESSION_KEY]);
    } catch {
      await this.#storage.remove(SESSION_KEY);
      return null;
    }
    this.#epoch = Math.max(this.#epoch, stored.epoch);
    if (stored.expiresAt <= this.#now()) {
      await this.clear();
      return null;
    }
    return {
      expiresAt: stored.expiresAt,
      rootKey: base64UrlToBytes(stored.rootKey),
      vaultId: stored.vaultId,
      version: 1,
    };
  }

  async save(material: VaultSessionMaterialV1): Promise<void> {
    if (material.rootKey.length !== ROOT_KEY_BYTES || material.expiresAt <= this.#now()) {
      throw new Error("Invalid extension session material");
    }
    this.#epoch += 1;
    const stored: StoredSessionV1 = {
      epoch: this.#epoch,
      expiresAt: material.expiresAt,
      rootKey: bytesToBase64Url(material.rootKey),
      vaultId: material.vaultId,
      version: 1,
    };
    await this.#storage.set({ [SESSION_KEY]: stored });
    await this.#bus.publish({
      epoch: this.#epoch,
      expiresAt: material.expiresAt,
      type: "unlocked",
      version: 1,
    });
  }

  async clear(): Promise<void> {
    this.#epoch += 1;
    await this.#storage.remove(SESSION_KEY);
    await this.#bus.publish({ epoch: this.#epoch, type: "locked", version: 1 });
  }

  bind(client: VaultClient): () => void {
    return this.#bus.subscribe((event) => {
      if (event.epoch < this.#epoch) return;
      this.#epoch = event.epoch;
      if (event.type === "locked") client.lock();
    });
  }
}

const SESSION_CREATING_METHODS = new Set<keyof VaultClient>([
  "createVault",
  "restoreVault",
  "restoreEncryptedArchiveWithMasterPassword",
  "unlock",
  "unlockWithDevice",
  "unlockWithRecoveryKit",
]);

export function withExtensionSession(
  client: VaultClient,
  coordinator: ExtensionSessionCoordinator,
): VaultClient {
  coordinator.bind(client);
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "initialize") {
        return async (): Promise<VaultPublicState> => {
          await coordinator.initialize();
          const initial = await target.initialize();
          if (initial.status === "locked" && target.resumeSession !== undefined) {
            const material = await coordinator.load();
            if (material !== null) {
              try {
                return await target.resumeSession(material);
              } catch {
                await coordinator.clear();
              } finally {
                zeroBytes(material.rootKey);
              }
            }
          }
          return initial;
        };
      }
      if (property === "lock") {
        return (): VaultPublicState => {
          const next = target.lock();
          void coordinator.clear();
          return next;
        };
      }
      if (SESSION_CREATING_METHODS.has(property as keyof VaultClient)) {
        const method = Reflect.get(target, property, receiver);
        if (typeof method !== "function") return method;
        return async (...arguments_: unknown[]) => {
          const result = await Reflect.apply(method, target, arguments_);
          if (
            target.getState().status === "unlocked" &&
            target.exportSessionMaterial !== undefined
          ) {
            const material = target.exportSessionMaterial();
            try {
              await coordinator.save(material);
            } finally {
              zeroBytes(material.rootKey);
            }
          }
          return result;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
