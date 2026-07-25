import { createCryptoProvider } from "@zk-wallet/crypto";
import {
  createEncryptedItemRevision,
  type EncryptedItemRevisionV1,
  openEncryptedItemRevision,
} from "@zk-wallet/vault";
import { describe, expect, it } from "vitest";
import { MemorySyncStore } from "./index";
import { createEncryptedVaultSyncCodec, syncVaultItems, type VaultRevisionStore } from "./vault";

class MemoryVaultRevisionStore implements VaultRevisionStore {
  readonly revisions = new Map<string, EncryptedItemRevisionV1>();
  readonly heads = new Map<string, string>();

  constructor(revisions: readonly EncryptedItemRevisionV1[]) {
    for (const revision of revisions) {
      this.revisions.set(revision.revisionId, structuredClone(revision));
      this.heads.set(revision.itemId, revision.revisionId);
    }
  }

  async importRevision(revision: EncryptedItemRevisionV1): Promise<void> {
    const existing = this.revisions.get(revision.revisionId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(revision)) {
      throw new Error("collision");
    }
    this.revisions.set(revision.revisionId, structuredClone(revision));
  }

  async listRevisions(): Promise<readonly unknown[]> {
    return [...this.revisions.values()].map((revision) => structuredClone(revision));
  }

  async setHead(itemId: string, revisionId: string): Promise<void> {
    if (!this.revisions.has(revisionId)) throw new Error("missing");
    this.heads.set(itemId, revisionId);
  }
}

describe("encrypted vault item synchronization", () => {
  it("converges two encrypted offline edits and exposes both conflict revisions", async () => {
    const crypto = createCryptoProvider();
    const rootKey = new Uint8Array(32).fill(9);
    const vaultId = "AQEBAQEBAQEBAQEBAQEBAQ";
    const initial = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      {
        input: {
          notes: "",
          password: "initial-secret",
          title: "Example",
          uris: ["https://example.test"],
          username: "person",
        },
        type: "login",
      },
      "2026-07-25T00:00:00.000Z",
    );
    const item = await openEncryptedItemRevision(crypto, rootKey, vaultId, initial);
    if (item === null) throw new Error("Expected item");
    const left = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      {
        input: {
          notes: item.type === "login" ? item.notes : "",
          password: "left-secret",
          title: item.title,
          uris: item.type === "login" ? item.uris : [],
          username: item.type === "login" ? item.username : "",
        },
        type: "login",
      },
      "2026-07-25T00:01:00.000Z",
      item,
    );
    const right = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      {
        input: {
          notes: item.type === "login" ? item.notes : "",
          password: "right-secret",
          title: item.title,
          uris: item.type === "login" ? item.uris : [],
          username: item.type === "login" ? item.username : "",
        },
        type: "login",
      },
      "2026-07-25T00:02:00.000Z",
      item,
    );
    const provider = new MemorySyncStore();
    const leftSync = new MemorySyncStore();
    const rightSync = new MemorySyncStore();
    const leftItems = new MemoryVaultRevisionStore([initial, left]);
    const rightItems = new MemoryVaultRevisionStore([initial, right]);
    const codec = createEncryptedVaultSyncCodec(crypto, rootKey, vaultId);
    const common = { codec, now: () => 100, provider };

    await syncVaultItems({
      ...common,
      deviceId: "left-device",
      revisionStore: leftItems,
      syncRepository: leftSync,
    });
    await syncVaultItems({
      ...common,
      deviceId: "right-device",
      revisionStore: rightItems,
      syncRepository: rightSync,
    });
    const leftResult = await syncVaultItems({
      ...common,
      deviceId: "left-device",
      revisionStore: leftItems,
      syncRepository: leftSync,
    });
    const rightResult = await syncVaultItems({
      ...common,
      deviceId: "right-device",
      revisionStore: rightItems,
      syncRepository: rightSync,
    });

    expect(leftResult.conflicts).toEqual(rightResult.conflicts);
    expect(leftResult.conflicts).toHaveLength(1);
    expect(new Set(leftResult.conflicts[0]?.revisionIds)).toEqual(
      new Set([left.revisionId, right.revisionId]),
    );
    expect(leftItems.revisions.size).toBe(3);
    expect(rightItems.revisions.size).toBe(3);
    const providerSerialization = JSON.stringify(await provider.list());
    expect(providerSerialization).not.toContain("left-secret");
    expect(providerSerialization).not.toContain("right-secret");
    expect(providerSerialization).not.toContain("https://example.test");
  });

  it("fails authentication with a different vault root", async () => {
    const crypto = createCryptoProvider();
    const vaultId = "AQEBAQEBAQEBAQEBAQEBAQ";
    const codec = createEncryptedVaultSyncCodec(crypto, new Uint8Array(32).fill(1), vaultId);
    const object = await codec.encode({
      clock: { counter: 0, wallTime: 1 },
      deviceId: "device",
      itemId: "item",
      kind: "value",
      parents: [],
      payload: "opaque",
      revisionId: "revision",
      version: 1,
    });
    const wrong = createEncryptedVaultSyncCodec(crypto, new Uint8Array(32).fill(2), vaultId);
    await expect(wrong.decode(object)).rejects.toBeDefined();
  });
});
