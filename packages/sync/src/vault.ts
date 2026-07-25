import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";
import { type EncryptedItemRevisionV1, parseEncryptedItemRevision } from "@zk-wallet/vault";
import {
  advanceClock,
  type HybridLogicalClock,
  parseSyncRevision,
  type SyncCodec,
  type SyncProvider,
  type SyncRepository,
  type SyncRevisionV1,
  synchronize,
} from "./index";

const FORMAT = "zk-wallet-sync-envelope";
const ALGORITHM = "xchacha20-poly1305-ietf";
const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export interface VaultRevisionStore {
  importRevision(revision: EncryptedItemRevisionV1): Promise<void>;
  listRevisions(): Promise<readonly unknown[]>;
  setConflicts?(
    conflicts: readonly {
      readonly itemId: string;
      readonly revisionIds: readonly string[];
    }[],
  ): Promise<void>;
  setHead(itemId: string, revisionId: string): Promise<void>;
}

export interface VaultItemSyncResult {
  readonly conflicts: readonly {
    readonly itemId: string;
    readonly revisionIds: readonly string[];
  }[];
  readonly itemCount: number;
  readonly quarantined: number;
  readonly revisionCount: number;
  readonly uploaded: number;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function syncAad(vaultId: string, locator: string) {
  return encodeEnvelopeAad({
    algorithm: ALGORITHM,
    contentSchemaVersion: 1,
    envelopeVersion: 1,
    purpose: "immutable-sync-revision",
    subjectId: locator,
    vaultId,
  });
}

async function syncKey(crypto: CryptoProvider, rootKey: Uint8Array, vaultId: string) {
  return crypto.hkdfSha256(
    rootKey,
    base64UrlToBytes(vaultId),
    utf8ToBytes("zk-wallet/v1/immutable-sync-revision"),
    KEY_BYTES,
  );
}

export function createEncryptedVaultSyncCodec(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
): SyncCodec {
  return {
    async decode(object) {
      const key = await syncKey(crypto, rootKey, vaultId);
      let plaintext: Uint8Array | null = null;
      try {
        const parsed = JSON.parse(object.body);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed) ||
          !exactKeys(parsed, ["algorithm", "ciphertext", "format", "nonce", "version"]) ||
          parsed.algorithm !== ALGORITHM ||
          parsed.format !== FORMAT ||
          parsed.version !== 1 ||
          typeof parsed.nonce !== "string" ||
          typeof parsed.ciphertext !== "string" ||
          base64UrlToBytes(parsed.nonce).length !== NONCE_BYTES
        ) {
          throw new Error();
        }
        plaintext = await crypto.openXChaCha20Poly1305(
          key,
          base64UrlToBytes(parsed.nonce),
          base64UrlToBytes(parsed.ciphertext),
          syncAad(vaultId, object.locator),
        );
        return parseSyncRevision(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        );
      } finally {
        zeroBytes(key);
        if (plaintext !== null) zeroBytes(plaintext);
      }
    },
    async encode(revision) {
      const validated = parseSyncRevision(revision);
      const key = await syncKey(crypto, rootKey, vaultId);
      const nonce = crypto.randomBytes(NONCE_BYTES);
      try {
        const ciphertext = await crypto.sealXChaCha20Poly1305(
          key,
          nonce,
          utf8ToBytes(JSON.stringify(validated)),
          syncAad(vaultId, validated.revisionId),
        );
        return {
          body: JSON.stringify({
            algorithm: ALGORITHM,
            ciphertext: bytesToBase64Url(ciphertext),
            format: FORMAT,
            nonce: bytesToBase64Url(nonce),
            version: 1,
          }),
          locator: validated.revisionId,
        };
      } finally {
        zeroBytes(key);
        zeroBytes(nonce);
      }
    },
  };
}

function maximumClock(revisions: readonly SyncRevisionV1[]): HybridLogicalClock {
  return revisions.reduce<HybridLogicalClock>(
    (current, revision) =>
      revision.clock.wallTime > current.wallTime ||
      (revision.clock.wallTime === current.wallTime && revision.clock.counter > current.counter)
        ? revision.clock
        : current,
    { counter: 0, wallTime: 0 },
  );
}

export async function syncVaultItems(options: {
  readonly codec: SyncCodec;
  readonly deviceId: string;
  readonly now: () => number;
  readonly provider: SyncProvider;
  readonly revisionStore: VaultRevisionStore;
  readonly syncRepository: SyncRepository;
}): Promise<VaultItemSyncResult> {
  const existingObjects = await options.syncRepository.list();
  const existing: SyncRevisionV1[] = [];
  for (const object of existingObjects) {
    try {
      existing.push(parseSyncRevision(await options.codec.decode(object)));
    } catch {
      // The core synchronization pass quarantines malformed local objects.
    }
  }
  const known = new Set(existing.map((revision) => revision.revisionId));
  let clock = maximumClock(existing);
  const localItemRevisions = (await options.revisionStore.listRevisions()).map(
    parseEncryptedItemRevision,
  );
  for (const itemRevision of localItemRevisions) {
    if (known.has(itemRevision.revisionId)) continue;
    const isLegacyRoot = itemRevision.parentRevisionId === null;
    if (!isLegacyRoot) clock = advanceClock(clock, options.now());
    const syncRevision: SyncRevisionV1 = {
      clock: isLegacyRoot ? { counter: 0, wallTime: 0 } : clock,
      deviceId: isLegacyRoot ? `legacy-${itemRevision.revisionId}` : options.deviceId,
      itemId: itemRevision.itemId,
      kind: itemRevision.operation === "delete" ? "tombstone" : "value",
      parents: itemRevision.parentRevisionId === null ? [] : [itemRevision.parentRevisionId],
      payload: JSON.stringify(itemRevision),
      revisionId: itemRevision.revisionId,
      version: 1,
    };
    await options.syncRepository.putIfAbsent(await options.codec.encode(syncRevision));
  }

  const result = await synchronize({
    codec: options.codec,
    provider: options.provider,
    repository: options.syncRepository,
  });
  for (const object of await options.syncRepository.list()) {
    try {
      const syncRevision = parseSyncRevision(await options.codec.decode(object));
      const itemRevision = parseEncryptedItemRevision(JSON.parse(syncRevision.payload));
      if (
        itemRevision.revisionId !== syncRevision.revisionId ||
        itemRevision.itemId !== syncRevision.itemId ||
        itemRevision.parentRevisionId !== (syncRevision.parents[0] ?? null) ||
        (itemRevision.operation === "delete") !== (syncRevision.kind === "tombstone")
      ) {
        throw new Error();
      }
      await options.revisionStore.importRevision(itemRevision);
    } catch {
      await options.syncRepository.quarantine(object, "corrupt");
    }
  }
  for (const item of result.items) {
    await options.revisionStore.setHead(item.itemId, item.headRevisionId);
  }
  const conflicts = result.items
    .filter((item) => item.status === "conflict")
    .map((item) => ({
      itemId: item.itemId,
      revisionIds: [...item.conflictRevisionIds, item.headRevisionId],
    }));
  await options.revisionStore.setConflicts?.(conflicts);
  return {
    conflicts,
    itemCount: result.items.filter((item) => item.status !== "deleted").length,
    quarantined: result.quarantined,
    revisionCount: result.revisionCount,
    uploaded: result.uploaded,
  };
}
