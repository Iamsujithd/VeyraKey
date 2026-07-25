import type { EncryptedItemRevisionV1 } from "@zk-wallet/vault";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbSyncRepository,
  IndexedDbVaultHeaderRepository,
} from "./index";

function revision(itemId: string, revisionId: string, parentRevisionId: string | null) {
  return {
    algorithm: "xchacha20-poly1305-ietf",
    ciphertext: "opaque",
    format: "zk-wallet-item-revision",
    itemId,
    nonce: "opaque",
    operation: parentRevisionId === null ? "create" : "update",
    parentRevisionId,
    revisionId,
    schemaVersion: 1,
    version: 1,
    wrappedItemKey: {
      algorithm: "xchacha20-poly1305-ietf",
      ciphertext: "opaque",
      nonce: "opaque",
      version: 1,
    },
  } as EncryptedItemRevisionV1;
}

describe("IndexedDbItemRevisionRepository", () => {
  let databaseName: string;

  beforeEach(() => {
    databaseName = `items-${crypto.randomUUID()}`;
  });

  it("upgrades a Task 3 database without losing its bootstrap", async () => {
    const headers = new IndexedDbVaultHeaderRepository({ databaseName });
    const header = { vaultId: "existing", version: 2 } as never;
    await headers.create(header);
    const items = new IndexedDbItemRevisionRepository({ databaseName });
    await items.commit(null, revision("item", "r1", null));
    await expect(headers.read()).resolves.toEqual(header);
    await expect(items.listHeads()).resolves.toEqual([revision("item", "r1", null)]);
  });

  it("atomically rejects stale concurrent heads and preserves the winner", async () => {
    const repository = new IndexedDbItemRevisionRepository({ databaseName });
    await repository.commit(null, revision("item", "r1", null));
    const results = await Promise.allSettled([
      repository.commit("r1", revision("item", "r2", "r1")),
      repository.commit("r1", revision("item", "r3", "r1")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const heads = await repository.listHeads();
    expect(heads).toHaveLength(1);
    expect(["r2", "r3"]).toContain((heads[0] as { revisionId: string }).revisionId);
  });

  it("durably stores idempotent opaque sync objects and conflict summaries", async () => {
    const sync = new IndexedDbSyncRepository({ databaseName });
    const items = new IndexedDbItemRevisionRepository({ databaseName });
    const object = { body: "authenticated-ciphertext", locator: "opaque-revision" };
    await expect(sync.putIfAbsent(object)).resolves.toBe("created");
    await expect(sync.putIfAbsent(object)).resolves.toBe("exists");
    await expect(sync.list()).resolves.toEqual([object]);
    const conflicts = [{ itemId: "opaque-item", revisionIds: ["left", "right"] }];
    await items.setConflicts(conflicts);
    await expect(items.listConflicts()).resolves.toEqual(conflicts);
  });

  it("persists only the opaque encrypted rebuildable search index", async () => {
    const items = new IndexedDbItemRevisionRepository({ databaseName });
    const encrypted = {
      algorithm: "xchacha20-poly1305-ietf",
      ciphertext: "opaque-search-ciphertext",
      nonce: "opaque-nonce",
      version: 1,
    };
    await items.writeSearchIndex(encrypted);
    await expect(items.readSearchIndex()).resolves.toEqual(encrypted);
    expect(JSON.stringify(await items.readSearchIndex())).not.toContain("private title");
  });

  it("commits an import batch atomically and rolls back a colliding batch", async () => {
    const items = new IndexedDbItemRevisionRepository({ databaseName });
    await items.commitBatch([revision("first", "r1", null), revision("second", "r2", null)]);
    await expect(items.listHeads()).resolves.toHaveLength(2);
    await expect(
      items.commitBatch([revision("third", "r3", null), revision("first", "collision", null)]),
    ).rejects.toBeDefined();
    const heads = await items.listHeads();
    expect(heads).toHaveLength(2);
    expect(heads).not.toContainEqual(expect.objectContaining({ itemId: "third" }));
  });
});
