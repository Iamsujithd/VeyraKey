import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ARGON2ID_PRODUCTION_FLOOR,
  assertProductionKdfParameters,
  bytesToHex,
  createCryptoProvider,
  encodeEnvelopeAad,
  hexToBytes,
  utf8ToBytes,
} from "./index";

const XCHACHA_KEY = hexToBytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
const XCHACHA_NONCE = hexToBytes("404142434445464748494a4b4c4d4e4f5051525354555657");
const XCHACHA_AAD = hexToBytes("50515253c0c1c2c3c4c5c6c7");
const XCHACHA_PLAINTEXT = utf8ToBytes(
  "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
);
const XCHACHA_CIPHERTEXT =
  "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb" +
  "731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452" +
  "2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9" +
  "21f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49";

describe("browser crypto provider", () => {
  it("matches the RFC 5869 HKDF-SHA-256 test vector", async () => {
    const provider = createCryptoProvider();
    const inputKey = new Uint8Array(22).fill(0x0b);
    const salt = hexToBytes("000102030405060708090a0b0c");
    const info = hexToBytes("f0f1f2f3f4f5f6f7f8f9");

    const output = await provider.hkdfSha256(inputKey, salt, info, 42);

    expect(bytesToHex(output)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865",
    );
  });

  it("overwrites the controllable HKDF raw-key import copy", async () => {
    const { vi } = await import("vitest");
    const provider = createCryptoProvider();
    const subtle = globalThis.crypto.subtle;
    const originalImportKey = subtle.importKey;
    let importedKeyCopy: ArrayBuffer | null = null;
    const importSpy = vi
      .spyOn(subtle, "importKey")
      .mockImplementation(async (format, keyData, algorithm, extractable, keyUsages) => {
        if (format === "raw" && keyData instanceof ArrayBuffer) {
          importedKeyCopy = keyData;
        }
        return Reflect.apply(originalImportKey, subtle, [
          format,
          keyData,
          algorithm,
          extractable,
          keyUsages,
        ]) as Promise<CryptoKey>;
      });

    try {
      await provider.hkdfSha256(
        new Uint8Array(32).fill(0xa5),
        new Uint8Array(16),
        utf8ToBytes("copy-cleanup-test"),
        32,
      );
    } finally {
      importSpy.mockRestore();
    }

    expect(importedKeyCopy).not.toBeNull();
    expect(new Uint8Array(importedKeyCopy ?? new ArrayBuffer(0))).toEqual(new Uint8Array(32));
  });

  it("matches the XChaCha20-Poly1305 draft vector", async () => {
    const provider = createCryptoProvider();

    const ciphertext = await provider.sealXChaCha20Poly1305(
      XCHACHA_KEY,
      XCHACHA_NONCE,
      XCHACHA_PLAINTEXT,
      XCHACHA_AAD,
    );

    expect(bytesToHex(ciphertext)).toBe(XCHACHA_CIPHERTEXT);
    await expect(
      provider.openXChaCha20Poly1305(XCHACHA_KEY, XCHACHA_NONCE, ciphertext, XCHACHA_AAD),
    ).resolves.toEqual(XCHACHA_PLAINTEXT);
  });

  it("matches a fixed Argon2id 1.3 vector at the production floor", async () => {
    const provider = createCryptoProvider();
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);

    const output = await provider.deriveArgon2id(
      utf8ToBytes("correct horse battery staple"),
      salt,
      ARGON2ID_PRODUCTION_FLOOR,
    );

    expect(bytesToHex(output)).toBe(
      "818259b6310026a8e0dbac5d2e6927abcfdb07b32258fac4f61b18b80f929085",
    );
  });

  it("rejects KDF parameters below any production floor dimension", () => {
    expect(() =>
      assertProductionKdfParameters({
        ...ARGON2ID_PRODUCTION_FLOOR,
        memoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB - 1,
      }),
    ).toThrow(/kdf policy/i);
    expect(() =>
      assertProductionKdfParameters({
        ...ARGON2ID_PRODUCTION_FLOOR,
        operations: ARGON2ID_PRODUCTION_FLOOR.operations - 1,
      }),
    ).toThrow(/kdf policy/i);
  });

  it("generates unique platform nonces", () => {
    const provider = createCryptoProvider();
    const nonces = new Set(Array.from({ length: 256 }, () => bytesToHex(provider.randomBytes(24))));

    expect(nonces.size).toBe(256);
  });

  it("rejects tampering, truncation, and substituted authenticated context", async () => {
    const provider = createCryptoProvider();
    const ciphertext = await provider.sealXChaCha20Poly1305(
      XCHACHA_KEY,
      XCHACHA_NONCE,
      XCHACHA_PLAINTEXT,
      XCHACHA_AAD,
    );
    const tampered = ciphertext.slice();
    const [firstByte] = tampered;
    if (firstByte === undefined) {
      throw new Error("Expected authenticated ciphertext bytes");
    }
    tampered[0] = firstByte ^ 1;

    await expect(
      provider.openXChaCha20Poly1305(XCHACHA_KEY, XCHACHA_NONCE, tampered, XCHACHA_AAD),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await expect(
      provider.openXChaCha20Poly1305(
        XCHACHA_KEY,
        XCHACHA_NONCE,
        ciphertext.subarray(0, ciphertext.length - 1),
        XCHACHA_AAD,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await expect(
      provider.openXChaCha20Poly1305(
        XCHACHA_KEY,
        XCHACHA_NONCE,
        ciphertext,
        utf8ToBytes("different-context"),
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("round-trips arbitrary bounded byte strings", async () => {
    const provider = createCryptoProvider();

    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (plaintext) => {
        const key = provider.randomBytes(32);
        const nonce = provider.randomBytes(24);
        const aad = encodeEnvelopeAad({
          algorithm: "xchacha20-poly1305-ietf",
          contentSchemaVersion: 1,
          envelopeVersion: 1,
          purpose: "property-test",
          subjectId: "subject",
          vaultId: "vault",
        });
        const ciphertext = await provider.sealXChaCha20Poly1305(key, nonce, plaintext, aad);

        await expect(provider.openXChaCha20Poly1305(key, nonce, ciphertext, aad)).resolves.toEqual(
          plaintext,
        );
      }),
      { numRuns: 32 },
    );
  });

  it("encodes authenticated fields without concatenation ambiguity", () => {
    const first = encodeEnvelopeAad({
      algorithm: "xchacha20-poly1305-ietf",
      contentSchemaVersion: 1,
      envelopeVersion: 1,
      purpose: "ab",
      subjectId: "c",
      vaultId: "vault",
    });
    const second = encodeEnvelopeAad({
      algorithm: "xchacha20-poly1305-ietf",
      contentSchemaVersion: 1,
      envelopeVersion: 1,
      purpose: "a",
      subjectId: "bc",
      vaultId: "vault",
    });

    expect(first).not.toEqual(second);
  });
});
