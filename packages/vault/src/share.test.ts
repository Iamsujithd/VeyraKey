import { bytesToBase64Url, createCryptoProvider } from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import type { LoginItem } from "./items";
import { createEncryptedItemShare, ItemShareError, openEncryptedItemShare } from "./share";

const crypto = createCryptoProvider();
const item: LoginItem = {
  createdAt: "2026-07-31T00:00:00.000Z",
  id: "AQEBAQEBAQEBAQEBAQEBAQ",
  notes: "private note",
  password: "correct horse battery staple",
  revisionId: "AgICAgICAgICAgICAgICAg",
  title: "Shared login",
  type: "login",
  updatedAt: "2026-07-31T00:00:00.000Z",
  uris: ["https://share.example"],
  username: "person@example.test",
};
const issuedAt = "2026-07-31T01:00:00.000Z";
const expiresAt = "2026-08-01T01:00:00.000Z";

describe("encrypted single-item sharing", () => {
  it("round-trips one item without exposing plaintext in the bundle", async () => {
    const created = await createEncryptedItemShare(crypto, item, expiresAt, issuedAt);
    const serialized = JSON.stringify(created.bundle);
    expect(serialized).not.toContain(item.password);
    expect(serialized).not.toContain(item.username);
    expect(serialized).not.toContain(item.uris[0]);
    await expect(
      openEncryptedItemShare(crypto, created.bundle, created.secret, issuedAt),
    ).resolves.toEqual(item);
  });

  it("rejects the wrong secret and authenticated-metadata tampering identically", async () => {
    const created = await createEncryptedItemShare(crypto, item, expiresAt, issuedAt);
    const wrongSecret = bytesToBase64Url(new Uint8Array(32).fill(9));
    await expect(
      openEncryptedItemShare(crypto, created.bundle, wrongSecret, issuedAt),
    ).rejects.toMatchObject({ code: "INVALID_SHARE" });
    await expect(
      openEncryptedItemShare(
        crypto,
        { ...created.bundle, expiresAt: "2026-08-02T01:00:00.000Z" },
        created.secret,
        issuedAt,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SHARE" });
  });

  it("authenticates before enforcing expiry and rejects expired shares", async () => {
    const created = await createEncryptedItemShare(crypto, item, expiresAt, issuedAt);
    await expect(
      openEncryptedItemShare(crypto, created.bundle, created.secret, expiresAt),
    ).rejects.toMatchObject({ code: "EXPIRED_SHARE" });
  });

  it("enforces bounded expiry and strict bundle schemas", async () => {
    await expect(
      createEncryptedItemShare(crypto, item, "2026-09-01T01:00:00.001Z", issuedAt),
    ).rejects.toBeInstanceOf(ItemShareError);
    const created = await createEncryptedItemShare(crypto, item, expiresAt, issuedAt);
    await expect(
      openEncryptedItemShare(
        crypto,
        { ...created.bundle, unexpected: true },
        created.secret,
        issuedAt,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SHARE" });
  });
});
