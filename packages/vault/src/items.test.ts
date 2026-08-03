import { createCryptoProvider } from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import {
  createEncryptedItemRevision,
  createEncryptedTombstone,
  ItemError,
  openEncryptedItemRevision,
  parseIdentityProfileInput,
  parseLoginInput,
  parsePaymentCardInput,
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

  it("strictly validates and encrypts an identity profile", async () => {
    const input = parseIdentityProfileInput({
      addressLine1: "1 Private Way",
      addressLine2: "",
      age: "26",
      city: "Example City",
      country: "IN",
      dateOfBirth: "2000-01-02",
      email: "person@example.test",
      firstName: "Private",
      lastName: "Person",
      middleName: "",
      nickname: "P",
      organization: "Example",
      phone: "+91 9000000000",
      postalCode: "000000",
      region: "Region",
      title: "Personal profile",
    });
    const revision = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      { input, type: "identity-profile" },
      "2026-07-28T00:00:00.000Z",
    );
    expect(JSON.stringify(revision)).not.toContain("person@example.test");
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, revision),
    ).resolves.toMatchObject({ ...input, type: "identity-profile" });
    expect(() => parseIdentityProfileInput({ ...input, unknown: true })).toThrow(ItemError);
    expect(
      parseIdentityProfileInput(
        Object.fromEntries(Object.entries(input).filter(([key]) => key !== "age")),
      ),
    ).toMatchObject({ age: "" });
  });

  it("validates and encrypts payment card records without plaintext leakage", async () => {
    const input = parsePaymentCardInput({
      billingAddress: "1 Private Way",
      cardNumber: "4111 1111 1111 1111",
      cardholderName: "Private Person",
      expiryMonth: "12",
      expiryYear: "2030",
      notes: "",
      securityCode: "123",
      title: "Personal card",
    });
    expect(input.securityCode).toBe("");
    const revision = await createEncryptedItemRevision(
      crypto,
      rootKey,
      vaultId,
      { input, type: "payment-card" },
      "2026-07-29T00:00:00.000Z",
    );
    const serialized = JSON.stringify(revision);
    expect(serialized).not.toContain("4111 1111 1111 1111");
    expect(serialized).not.toContain("Private Person");
    expect(serialized).not.toContain('"123"');
    await expect(
      openEncryptedItemRevision(crypto, rootKey, vaultId, revision),
    ).resolves.toMatchObject({ ...input, type: "payment-card" });
    expect(() => parsePaymentCardInput({ ...input, cardNumber: "not-a-card" })).toThrow(ItemError);
    expect(() => parsePaymentCardInput({ ...input, securityCode: "12" })).toThrow(ItemError);
  });

  it("round-trips a login without storing plaintext or raw item keys", async () => {
    const input = {
      emailAlias: {
        address: "private+veyrakey-example@sentinel.invalid",
        createdAt: "2026-07-25T00:00:00.000Z",
        createdForOrigin: "https://sentinel.invalid",
        provider: "plus" as const,
        sourceEmail: "private@sentinel.invalid",
      },
      favorite: true,
      folder: "sentinel-folder",
      notes: "sentinel-notes",
      password: "sentinel-password",
      passkeys: [
        {
          createdAt: "2026-07-25T00:00:00.000Z",
          displayName: "MacBook Touch ID",
          provider: "platform" as const,
          rpId: "sentinel.invalid",
          userName: "sentinel-user",
        },
      ],
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

  it("rejects secret-looking or malformed passkey and alias metadata", () => {
    const base = {
      notes: "",
      password: "password",
      title: "Example",
      uris: ["https://example.test"],
      username: "person",
    };
    expect(() =>
      parseLoginInput({
        ...base,
        passkeys: [
          {
            createdAt: new Date().toISOString(),
            displayName: "Laptop",
            privateKey: "must-never-be-stored",
            provider: "platform",
            rpId: "example.test",
            userName: "person",
          },
        ],
      }),
    ).toThrow(ItemError);
    expect(() =>
      parseLoginInput({
        ...base,
        emailAlias: {
          address: "alias@example.test",
          createdAt: new Date().toISOString(),
          createdForOrigin: "https://example.test",
          provider: "unknown",
        },
      }),
    ).toThrow(ItemError);
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
