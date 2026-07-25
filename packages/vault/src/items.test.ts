import { createCryptoProvider } from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import {
  createEncryptedItemRevision,
  createEncryptedTombstone,
  ItemError,
  openEncryptedItemRevision,
  parseLoginInput,
  parseSecureNoteInput,
} from "./items";

const crypto = createCryptoProvider();
const rootKey = new Uint8Array(32).fill(7);
const vaultId = "AQEBAQEBAQEBAQEBAQEBAQ";

describe("Task 4 item schemas and encryption", () => {
  it("strictly validates bounded login and secure-note inputs", () => {
    expect(
      parseLoginInput({
        notes: "",
        password: "correct horse",
        title: "Example",
        uris: ["https://example.test"],
        username: "person",
      }),
    ).toMatchObject({ title: "Example" });
    expect(() =>
      parseLoginInput({
        extra: true,
        notes: "",
        password: "",
        title: "Example",
        uris: [],
        username: "",
      }),
    ).toThrow(ItemError);
    expect(() => parseSecureNoteInput({ note: "", title: "" })).toThrow(ItemError);
    expect(() => parseSecureNoteInput({ note: "x".repeat(1_048_577), title: "large" })).toThrow(
      ItemError,
    );
  });

  it("round-trips a login without storing plaintext or raw item keys", async () => {
    const input = {
      favorite: true,
      folder: "sentinel-folder",
      notes: "sentinel-notes",
      password: "sentinel-password",
      tags: ["sentinel-tag"],
      title: "sentinel-title",
      totpUri: "otpauth://totp/Sentinel?secret=JBSWY3DPEHPK3PXP&issuer=Sentinel",
      uris: ["https://sentinel.invalid"],
      username: "sentinel-user",
    };
    const revision = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      { input, type: "login" },
      "2026-07-25T00:00:00.000Z",
    );
    const serialized = JSON.stringify(revision);
    for (const sentinel of Object.values(input).flat()) {
      expect(serialized).not.toContain(String(sentinel));
    }
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, revision),
    ).resolves.toMatchObject({ ...input, type: "login" });
  });

  it("binds vault, revision ancestry, operation, wrapper, and ciphertext", async () => {
    const revision = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      { input: { note: "private", title: "Note" }, type: "secure-note" },
      "2026-07-25T00:00:00.000Z",
    );
    await expect(
      openEncryptedItemRevision(crypto, rootKey, "AgICAgICAgICAgICAgICAg", revision),
    ).rejects.toMatchObject({ code: "ITEM_CORRUPT" });
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, {
        ...revision,
        operation: "delete",
        parentRevisionId: revision.revisionId,
      }),
    ).rejects.toMatchObject({ code: "ITEM_CORRUPT" });
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, {
        ...revision,
        ciphertext: `${revision.ciphertext[0] === "A" ? "B" : "A"}${revision.ciphertext.slice(1)}`,
      }),
    ).rejects.toMatchObject({ code: "ITEM_CORRUPT" });
  });

  it("creates authenticated tombstones that decrypt to deletion", async () => {
    const revision = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      { input: { note: "private", title: "Note" }, type: "secure-note" },
      "2026-07-25T00:00:00.000Z",
    );
    const item = await openEncryptedItemRevision(crypto, rootKey, vaultId, revision);
    if (item === null) throw new Error("Expected item");
    const tombstone = await createEncryptedTombstone(
      crypto,
      rootKey,
      vaultId,
      item,
      "2026-07-25T01:00:00.000Z",
    );
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, tombstone),
    ).resolves.toBeNull();
  });
});
