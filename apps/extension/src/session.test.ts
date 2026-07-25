import type { VaultClient, VaultPublicState, VaultSessionMaterialV1 } from "@zk-wallet/vault";
import { describe, expect, it, vi } from "vitest";
import {
  ExtensionSessionCoordinator,
  isTrustedExtensionSender,
  type SessionBroadcastBus,
  type SessionStorageArea,
  withExtensionSession,
} from "./session";

function harness(now = 100) {
  const values: Record<string, unknown> = {};
  const listeners = new Set<(message: never) => void>();
  const access: string[] = [];
  const storage: SessionStorageArea = {
    async get(key) {
      return { [key]: values[key] };
    },
    async remove(key) {
      delete values[key];
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
    async setAccessLevel(options) {
      access.push(options.accessLevel);
    },
  };
  const bus: SessionBroadcastBus = {
    async publish(message) {
      for (const listener of listeners) listener(message as never);
    },
    subscribe(listener) {
      listeners.add(listener as (message: never) => void);
      return () => listeners.delete(listener as (message: never) => void);
    },
  };
  return {
    access,
    coordinator: new ExtensionSessionCoordinator({ bus, now: () => now, storage }),
    values,
  };
}

function fakeClient(): VaultClient & {
  material: VaultSessionMaterialV1;
  state: VaultPublicState;
} {
  const locked: VaultPublicState = {
    deviceUnlock: { available: false, slots: [] },
    status: "locked",
    vaultId: "vault",
  };
  const unlocked: VaultPublicState = {
    deviceUnlock: { available: false, slots: [] },
    itemCount: 0,
    recovery: { status: "verified" },
    status: "unlocked",
    unlockedCompartments: [],
    vaultId: "vault",
  };
  const client: VaultClient & {
    material: VaultSessionMaterialV1;
    state: VaultPublicState;
  } = {
    material: {
      expiresAt: 1_000,
      rootKey: new Uint8Array(32).fill(4),
      vaultId: "vault",
      version: 1 as const,
    },
    state: locked,
    changeMasterPassword: vi.fn(async () => unlocked),
    createLogin: vi.fn(),
    createSecureNote: vi.fn(),
    async createVault() {
      client.state = unlocked;
      return unlocked;
    },
    deleteItem: vi.fn(),
    enrollDevice: vi.fn(async () => unlocked),
    exportSessionMaterial: () => ({
      ...client.material,
      rootKey: client.material.rootKey.slice(),
    }),
    getState: () => client.state,
    initialize: vi.fn(async () => locked),
    listItems: vi.fn(async () => []),
    lock: vi.fn(() => {
      client.state = locked;
      return locked;
    }),
    recordActivity: vi.fn(),
    replaceRecoveryKit: vi.fn(async () => unlocked),
    restoreVault: vi.fn(async () => unlocked),
    resumeSession: vi.fn(async () => {
      client.state = unlocked;
      return unlocked;
    }),
    revokeDevice: vi.fn(async () => unlocked),
    stepUpCompartment: vi.fn(async () => unlocked),
    subscribe: vi.fn(() => () => undefined),
    async unlock() {
      client.state = unlocked;
      return unlocked;
    },
    unlockWithDevice: vi.fn(async () => unlocked),
    unlockWithRecoveryKit: vi.fn(async () => unlocked),
    updateLogin: vi.fn(),
    updateSecureNote: vi.fn(),
    verifyRecoveryKit: vi.fn(async () => unlocked),
  };
  return client;
}

describe("restricted MV3 session coordination", () => {
  it("restricts storage.session before saving and restores after a worker restart", async () => {
    const shared = harness();
    await shared.coordinator.initialize();
    const material = {
      expiresAt: 1_000,
      rootKey: new Uint8Array(32).fill(9),
      vaultId: "vault",
      version: 1 as const,
    };
    await shared.coordinator.save(material);

    const restarted = new ExtensionSessionCoordinator({
      bus: {
        publish: async () => undefined,
        subscribe: () => () => undefined,
      },
      now: () => 200,
      storage: {
        get: async (key) => ({ [key]: shared.values[key] }),
        remove: async (key) => {
          delete shared.values[key];
        },
        set: async (items) => {
          Object.assign(shared.values, items);
        },
        setAccessLevel: async () => undefined,
      },
    });
    const restored = await restarted.load();
    expect(shared.access).toEqual(["TRUSTED_CONTEXTS"]);
    expect(restored).toMatchObject({ expiresAt: 1_000, vaultId: "vault", version: 1 });
    expect(restored?.rootKey).toEqual(material.rootKey);
  });

  it("clears expired or malformed state instead of resuming it", async () => {
    const expired = harness(2_000);
    await expired.coordinator
      .save({
        expiresAt: 1_000,
        rootKey: new Uint8Array(32),
        vaultId: "vault",
        version: 1,
      })
      .catch(() => undefined);
    expired.values["zk-wallet.authorized-session.v1"] = {
      epoch: 1,
      expiresAt: 1_000,
      rootKey: "bad",
      vaultId: "vault",
      version: 1,
    };
    await expect(expired.coordinator.load()).resolves.toBeNull();
    expect(expired.values).toEqual({});
  });

  it("persists successful unlock, resumes a new context, and broadcasts lock", async () => {
    const shared = harness();
    const first = fakeClient();
    const firstWrapped = withExtensionSession(first, shared.coordinator);
    await firstWrapped.initialize();
    await firstWrapped.unlock("secret");

    const second = fakeClient();
    const secondWrapped = withExtensionSession(second, shared.coordinator);
    await secondWrapped.initialize();
    expect(second.resumeSession).toHaveBeenCalledOnce();

    firstWrapped.lock();
    await vi.waitFor(() => expect(second.lock).toHaveBeenCalled());
  });

  it("rejects page, tab, foreign-extension, and lookalike senders", () => {
    const origin = "chrome-extension://trusted";
    expect(
      isTrustedExtensionSender(
        { id: "trusted", url: "chrome-extension://trusted/popup.html" },
        "trusted",
        origin,
      ),
    ).toBe(true);
    expect(
      isTrustedExtensionSender(
        { id: "trusted", tab: {}, url: "https://example.test" },
        "trusted",
        origin,
      ),
    ).toBe(false);
    expect(
      isTrustedExtensionSender(
        { id: "foreign", url: "chrome-extension://trusted/popup.html" },
        "trusted",
        origin,
      ),
    ).toBe(false);
    expect(
      isTrustedExtensionSender(
        { id: "trusted", url: "chrome-extension://trusted.evil/popup.html" },
        "trusted",
        origin,
      ),
    ).toBe(false);
  });
});
