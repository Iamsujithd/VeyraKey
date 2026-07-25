export interface HybridLogicalClock {
  readonly counter: number;
  readonly wallTime: number;
}

export interface SyncRevisionV1 {
  readonly clock: HybridLogicalClock;
  readonly deviceId: string;
  readonly itemId: string;
  readonly kind: "tombstone" | "value";
  readonly parents: readonly string[];
  readonly payload: string;
  readonly revisionId: string;
  readonly version: 1;
}

export interface OpaqueSyncObject {
  readonly body: string;
  readonly locator: string;
}

export interface SyncCodec {
  decode(object: OpaqueSyncObject): Promise<SyncRevisionV1> | SyncRevisionV1;
  encode(revision: SyncRevisionV1): Promise<OpaqueSyncObject> | OpaqueSyncObject;
}

export interface SyncProvider {
  list(): Promise<readonly OpaqueSyncObject[]>;
  putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists">;
}

export interface SyncRepository {
  list(): Promise<readonly OpaqueSyncObject[]>;
  putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists">;
  quarantine(object: OpaqueSyncObject, reason: "corrupt" | "missing-parent"): Promise<void>;
}

export interface ResolvedSyncItem {
  readonly conflictRevisionIds: readonly string[];
  readonly headRevisionId: string;
  readonly itemId: string;
  readonly status: "conflict" | "deleted" | "value";
}

export interface SyncCheckpointV1 {
  readonly deviceId: string;
  readonly observedRevisionIds: readonly string[];
  readonly version: 1;
}

export interface SyncSnapshotV1 {
  readonly heads: Readonly<Record<string, readonly string[]>>;
  readonly knownRevisionIds: readonly string[];
  readonly version: 1;
}

export interface SyncResult {
  readonly items: readonly ResolvedSyncItem[];
  readonly quarantined: number;
  readonly revisionCount: number;
  readonly snapshot: SyncSnapshotV1;
  readonly uploaded: number;
}

export type SyncErrorCode = "PROVIDER_RETRY_EXHAUSTED" | "SYNC_CORRUPT" | "SYNC_INVALID_INPUT";

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}

const MAX_CLOCK = Number.MAX_SAFE_INTEGER;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function parseSyncRevision(value: unknown): SyncRevisionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SyncError("SYNC_CORRUPT", "Encrypted sync revision is invalid");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.join(",") !== "clock,deviceId,itemId,kind,parents,payload,revisionId,version" ||
    record.version !== 1 ||
    !validId(record.deviceId) ||
    !validId(record.itemId) ||
    !validId(record.revisionId) ||
    !["tombstone", "value"].includes(record.kind as string) ||
    !Array.isArray(record.parents) ||
    record.parents.length > 32 ||
    !record.parents.every(validId) ||
    !unique(record.parents) ||
    typeof record.payload !== "string" ||
    record.payload.length > 16_777_216 ||
    record.parents.includes(record.revisionId) ||
    typeof record.clock !== "object" ||
    record.clock === null ||
    Array.isArray(record.clock)
  ) {
    throw new SyncError("SYNC_CORRUPT", "Encrypted sync revision is invalid");
  }
  const clock = record.clock as Record<string, unknown>;
  if (
    Object.keys(clock).sort().join(",") !== "counter,wallTime" ||
    !Number.isSafeInteger(clock.wallTime) ||
    !Number.isSafeInteger(clock.counter) ||
    (clock.wallTime as number) < 0 ||
    (clock.wallTime as number) > MAX_CLOCK ||
    (clock.counter as number) < 0 ||
    (clock.counter as number) > MAX_CLOCK
  ) {
    throw new SyncError("SYNC_CORRUPT", "Encrypted sync revision is invalid");
  }
  return {
    clock: { counter: clock.counter as number, wallTime: clock.wallTime as number },
    deviceId: record.deviceId,
    itemId: record.itemId,
    kind: record.kind as "tombstone" | "value",
    parents: [...record.parents],
    payload: record.payload,
    revisionId: record.revisionId,
    version: 1,
  };
}

export function advanceClock(
  local: HybridLogicalClock,
  now: number,
  observed?: HybridLogicalClock,
): HybridLogicalClock {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(local.wallTime) ||
    !Number.isSafeInteger(local.counter)
  ) {
    throw new SyncError("SYNC_INVALID_INPUT", "Hybrid logical clock input is invalid");
  }
  const wallTime = Math.max(now, local.wallTime, observed?.wallTime ?? 0);
  let counter = 0;
  if (wallTime === local.wallTime && wallTime === observed?.wallTime) {
    counter = Math.max(local.counter, observed.counter) + 1;
  } else if (wallTime === local.wallTime) {
    counter = local.counter + 1;
  } else if (wallTime === observed?.wallTime) {
    counter = (observed?.counter ?? 0) + 1;
  }
  if (!Number.isSafeInteger(counter)) {
    throw new SyncError("SYNC_INVALID_INPUT", "Hybrid logical clock overflow");
  }
  return { counter, wallTime };
}

function compareRevision(left: SyncRevisionV1, right: SyncRevisionV1): number {
  return (
    left.clock.wallTime - right.clock.wallTime ||
    left.clock.counter - right.clock.counter ||
    left.deviceId.localeCompare(right.deviceId) ||
    left.revisionId.localeCompare(right.revisionId)
  );
}

function isAncestor(
  candidate: string,
  descendant: SyncRevisionV1,
  revisions: ReadonlyMap<string, SyncRevisionV1>,
): boolean {
  const pending = [...descendant.parents];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === candidate) return true;
    seen.add(current);
    const revision = revisions.get(current);
    if (revision !== undefined) pending.push(...revision.parents);
  }
  return false;
}

export function resolveRevisions(revisions: readonly SyncRevisionV1[]): ResolvedSyncItem[] {
  const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  const byItem = new Map<string, SyncRevisionV1[]>();
  for (const revision of revisions) {
    const existing = byItem.get(revision.itemId) ?? [];
    existing.push(revision);
    byItem.set(revision.itemId, existing);
  }
  return [...byItem.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, itemRevisions]) => {
      const heads = itemRevisions
        .filter(
          (candidate) =>
            !itemRevisions.some(
              (other) =>
                other.revisionId !== candidate.revisionId &&
                isAncestor(candidate.revisionId, other, byId),
            ),
        )
        .sort(compareRevision);
      const selected = heads.at(-1);
      if (selected === undefined) throw new SyncError("SYNC_CORRUPT", "Revision graph is empty");
      return {
        conflictRevisionIds: heads.slice(0, -1).map((head) => head.revisionId),
        headRevisionId: selected.revisionId,
        itemId,
        status: heads.length > 1 ? "conflict" : selected.kind === "tombstone" ? "deleted" : "value",
      };
    });
}

export function createSnapshot(revisions: readonly SyncRevisionV1[]): SyncSnapshotV1 {
  const resolved = resolveRevisions(revisions);
  return {
    heads: Object.fromEntries(
      resolved.map((item) => [
        item.itemId,
        [...item.conflictRevisionIds, item.headRevisionId].sort(),
      ]),
    ),
    knownRevisionIds: revisions.map((revision) => revision.revisionId).sort(),
    version: 1,
  };
}

export function canCollectTombstone(
  revision: SyncRevisionV1,
  checkpoints: readonly SyncCheckpointV1[],
  activeDeviceIds: readonly string[],
): boolean {
  if (revision.kind !== "tombstone") return false;
  return activeDeviceIds.every((deviceId) =>
    checkpoints.some(
      (checkpoint) =>
        checkpoint.deviceId === deviceId &&
        checkpoint.observedRevisionIds.includes(revision.revisionId),
    ),
  );
}

async function retryPut(
  provider: SyncProvider,
  object: OpaqueSyncObject,
  maximumAttempts: number,
): Promise<"created" | "exists"> {
  let attempt = 0;
  while (attempt < maximumAttempts) {
    attempt += 1;
    try {
      return await provider.putIfAbsent(object);
    } catch (error) {
      const retryable =
        typeof error === "object" &&
        error !== null &&
        "retryable" in error &&
        error.retryable === true;
      if (!retryable || attempt === maximumAttempts) {
        throw new SyncError("PROVIDER_RETRY_EXHAUSTED", "Encrypted sync upload failed");
      }
    }
  }
  throw new SyncError("PROVIDER_RETRY_EXHAUSTED", "Encrypted sync upload failed");
}

export async function synchronize(options: {
  readonly codec: SyncCodec;
  readonly maximumUploadAttempts?: number;
  readonly provider: SyncProvider;
  readonly repository: SyncRepository;
}): Promise<SyncResult> {
  const maximumAttempts = options.maximumUploadAttempts ?? 3;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 10) {
    throw new SyncError("SYNC_INVALID_INPUT", "Retry configuration is invalid");
  }
  const local = await options.repository.list();
  const remote = await options.provider.list();
  const objects = new Map<string, OpaqueSyncObject[]>();
  for (const object of [...local, ...remote]) {
    const existing = objects.get(object.locator) ?? [];
    existing.push(object);
    objects.set(object.locator, existing);
  }

  const valid = new Map<string, { object: OpaqueSyncObject; revision: SyncRevisionV1 }>();
  let quarantined = 0;
  for (const candidates of objects.values()) {
    try {
      const decoded = await Promise.all(
        candidates.map(async (object) => ({
          object,
          revision: parseSyncRevision(await options.codec.decode(object)),
        })),
      );
      const first = decoded[0];
      if (
        first === undefined ||
        first.revision.revisionId !== first.object.locator ||
        decoded.some(
          (entry) =>
            entry.revision.revisionId !== entry.object.locator ||
            JSON.stringify(entry.revision) !== JSON.stringify(first.revision),
        )
      ) {
        throw new Error();
      }
      valid.set(first.revision.revisionId, first);
    } catch {
      quarantined += 1;
      await options.repository.quarantine(candidates[0] as OpaqueSyncObject, "corrupt");
    }
  }

  let removedMissingParent = true;
  while (removedMissingParent) {
    removedMissingParent = false;
    for (const [revisionId, entry] of [...valid]) {
      if (entry.revision.parents.some((parent) => !valid.has(parent))) {
        valid.delete(revisionId);
        quarantined += 1;
        removedMissingParent = true;
        await options.repository.quarantine(entry.object, "missing-parent");
      }
    }
  }

  let uploaded = 0;
  for (const entry of valid.values()) {
    await options.repository.putIfAbsent(entry.object);
    if (!remote.some((object) => object.locator === entry.object.locator)) {
      if ((await retryPut(options.provider, entry.object, maximumAttempts)) === "created")
        uploaded += 1;
    }
  }
  const revisions = [...valid.values()].map((entry) => entry.revision);
  return {
    items: resolveRevisions(revisions),
    quarantined,
    revisionCount: revisions.length,
    snapshot: createSnapshot(revisions),
    uploaded,
  };
}

export class MemorySyncStore implements SyncProvider, SyncRepository {
  readonly objects = new Map<string, OpaqueSyncObject>();
  readonly quarantined: Array<{
    readonly object: OpaqueSyncObject;
    readonly reason: "corrupt" | "missing-parent";
  }> = [];

  async list(): Promise<readonly OpaqueSyncObject[]> {
    return [...this.objects.values()].map((object) => ({ ...object }));
  }

  async putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists"> {
    if (this.objects.has(object.locator)) return "exists";
    this.objects.set(object.locator, { ...object });
    return "created";
  }

  async quarantine(object: OpaqueSyncObject, reason: "corrupt" | "missing-parent"): Promise<void> {
    this.quarantined.push({ object: { ...object }, reason });
  }
}

export {
  createEncryptedVaultSyncCodec,
  syncVaultItems,
  type VaultItemSyncResult,
  type VaultRevisionStore,
} from "./vault";
