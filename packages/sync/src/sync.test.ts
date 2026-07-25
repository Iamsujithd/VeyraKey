import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  advanceClock,
  canCollectTombstone,
  MemorySyncStore,
  type OpaqueSyncObject,
  resolveRevisions,
  type SyncCodec,
  type SyncRevisionV1,
  synchronize,
} from "./index";

const codec: SyncCodec = {
  decode(object) {
    return JSON.parse(object.body);
  },
  encode(revision) {
    return { body: JSON.stringify(revision), locator: revision.revisionId };
  },
};

function revision(
  revisionId: string,
  itemId: string,
  parents: readonly string[],
  deviceId: string,
  counter: number,
  kind: "tombstone" | "value" = "value",
): SyncRevisionV1 {
  return {
    clock: { counter, wallTime: 100 },
    deviceId,
    itemId,
    kind,
    parents,
    payload: `encrypted-${revisionId}`,
    revisionId,
    version: 1,
  };
}

describe("immutable sync engine", () => {
  it("advances a hybrid logical clock despite wall-clock rollback", () => {
    expect(advanceClock({ counter: 4, wallTime: 100 }, 50)).toEqual({
      counter: 5,
      wallTime: 100,
    });
    expect(advanceClock({ counter: 4, wallTime: 100 }, 90, { counter: 7, wallTime: 100 })).toEqual({
      counter: 8,
      wallTime: 100,
    });
  });

  it("converges independently of delivery order and duplication", () => {
    const revisions = [
      revision("root", "item", [], "a", 0),
      revision("left", "item", ["root"], "a", 1),
      revision("right", "item", ["root"], "b", 1),
    ];
    const expected = resolveRevisions(revisions);
    expect(expected).toEqual([
      {
        conflictRevisionIds: ["left"],
        headRevisionId: "right",
        itemId: "item",
        status: "conflict",
      },
    ]);
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...revisions, ...revisions], { minLength: 3 }),
        (delivery) => {
          const complete = [
            ...new Map(
              [...delivery, ...revisions].map((entry) => [entry.revisionId, entry]),
            ).values(),
          ];
          expect(resolveRevisions(complete)).toEqual(expected);
        },
      ),
    );
  });

  it("preserves delete/edit races as conflicts", () => {
    const revisions = [
      revision("root", "item", [], "a", 0),
      revision("delete", "item", ["root"], "a", 1, "tombstone"),
      revision("edit", "item", ["root"], "b", 1),
    ];
    expect(resolveRevisions(revisions)[0]).toMatchObject({
      conflictRevisionIds: ["delete"],
      headRevisionId: "edit",
      status: "conflict",
    });
  });

  it("is idempotent, retries transient uploads, and quarantines corruption", async () => {
    const local = new MemorySyncStore();
    const remote = new MemorySyncStore();
    await local.putIfAbsent(await codec.encode(revision("root", "item", [], "a", 0)));
    await remote.putIfAbsent({ body: "{bad", locator: "corrupt" });
    let failures = 1;
    const provider = {
      list: () => remote.list(),
      async putIfAbsent(object: OpaqueSyncObject) {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error("offline"), { retryable: true });
        }
        return remote.putIfAbsent(object);
      },
    };
    const first = await synchronize({ codec, provider, repository: local });
    expect(first).toMatchObject({ quarantined: 1, revisionCount: 1, uploaded: 1 });
    const second = await synchronize({ codec, provider, repository: local });
    expect(second).toMatchObject({ revisionCount: 1, uploaded: 0 });
  });

  it("quarantines descendants until missing parents arrive", async () => {
    const local = new MemorySyncStore();
    const remote = new MemorySyncStore();
    await remote.putIfAbsent(await codec.encode(revision("child", "item", ["missing"], "a", 1)));
    const result = await synchronize({ codec, provider: remote, repository: local });
    expect(result).toMatchObject({ quarantined: 1, revisionCount: 0 });
    expect(local.quarantined[0]?.reason).toBe("missing-parent");
  });

  it("quarantines locator collisions and their dependent chain", async () => {
    const local = new MemorySyncStore();
    const remote = new MemorySyncStore();
    const root = revision("root", "item", [], "a", 0);
    await local.putIfAbsent(await codec.encode(root));
    await remote.putIfAbsent({
      body: JSON.stringify({ ...root, payload: "different-authenticated-body" }),
      locator: "root",
    });
    await remote.putIfAbsent(await codec.encode(revision("child", "item", ["root"], "b", 1)));
    await remote.putIfAbsent(await codec.encode(revision("grandchild", "item", ["child"], "b", 2)));
    const result = await synchronize({ codec, provider: remote, repository: local });
    expect(result).toMatchObject({ quarantined: 3, revisionCount: 0 });
  });

  it("collects tombstones only after every active device checkpoint observed them", () => {
    const tombstone = revision("delete", "item", ["root"], "a", 1, "tombstone");
    expect(
      canCollectTombstone(
        tombstone,
        [
          { deviceId: "a", observedRevisionIds: ["delete"], version: 1 },
          { deviceId: "b", observedRevisionIds: ["delete"], version: 1 },
        ],
        ["a", "b"],
      ),
    ).toBe(true);
    expect(
      canCollectTombstone(
        tombstone,
        [{ deviceId: "a", observedRevisionIds: ["delete"], version: 1 }],
        ["a", "b"],
      ),
    ).toBe(false);
  });
});
