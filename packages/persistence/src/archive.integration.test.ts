import "fake-indexeddb/auto";
import {
  ARGON2ID_PRODUCTION_FLOOR,
  type CryptoProvider,
  createCryptoProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import { createVaultService } from "@zk-wallet/vault";
import { describe, expect, it } from "vitest";
import { IndexedDbItemRevisionRepository, IndexedDbVaultHeaderRepository } from "./index";

function fastCryptoProvider(): CryptoProvider {
  const provider = createCryptoProvider();
  return {
    deriveArgon2id: (password, salt) =>
      provider.hkdfSha256(password, salt, utf8ToBytes("test-only-fast-kdf"), 32),
    hkdfSha256: (inputKey, salt, info, length) => provider.hkdfSha256(inputKey, salt, info, length),
    openXChaCha20Poly1305: (key, nonce, ciphertext, aad) =>
      provider.openXChaCha20Poly1305(key, nonce, ciphertext, aad),
    randomBytes: (length) => provider.randomBytes(length),
    sealXChaCha20Poly1305: (key, nonce, plaintext, aad) =>
      provider.sealXChaCha20Poly1305(key, nonce, plaintext, aad),
  };
}

function service(databaseName: string) {
  return createVaultService({
    calibration: {
      maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
      targetMilliseconds: 0,
    },
    crypto: fastCryptoProvider(),
    itemRepository: new IndexedDbItemRevisionRepository({ databaseName }),
    repository: new IndexedDbVaultHeaderRepository({ databaseName }),
  });
}

describe("atomic encrypted archive recovery", () => {
  it("exports all encrypted revisions and restores them into a clean profile", async () => {
    const source = service(`archive-source-${crypto.randomUUID()}`);
    const created = await source.createVault("source master password");
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    const recoveryKit = created.recovery.recoveryKit;
    await source.verifyRecoveryKit(recoveryKit);
    await source.createLogin({
      folder: "Work",
      notes: "",
      password: "synthetic-archive-secret",
      tags: ["Important"],
      title: "Archive Example",
      totpUri: "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP",
      uris: ["https://example.test"],
      username: "person",
    });
    const archive = await source.exportEncryptedArchive?.();
    if (archive === undefined) throw new Error("Expected archive export");
    expect(JSON.stringify(archive)).not.toMatch(
      /synthetic-archive-secret|Archive Example|Important|otpauth/u,
    );

    const restored = service(`archive-target-${crypto.randomUUID()}`);
    await expect(
      restored.restoreEncryptedArchive?.({
        archive,
        newMasterPassword: "new master password",
        recoveryKit,
      }),
    ).resolves.toMatchObject({ status: "unlocked" });
    await expect(restored.listItems()).resolves.toEqual([
      expect.objectContaining({
        folder: "Work",
        password: "synthetic-archive-secret",
        title: "Archive Example",
      }),
    ]);
    restored.lock();
    await expect(restored.unlock("new master password")).resolves.toMatchObject({
      status: "unlocked",
    });
  });

  it("rolls back a corrupt archive without creating a local vault", async () => {
    const databaseName = `archive-corrupt-${crypto.randomUUID()}`;
    const target = service(databaseName);
    await expect(
      target.restoreEncryptedArchive?.({
        archive: { format: "wrong" },
        newMasterPassword: "new master password",
        recoveryKit: "invalid",
      }),
    ).rejects.toBeDefined();
    await expect(new IndexedDbVaultHeaderRepository({ databaseName }).read()).resolves.toBeNull();
  });
});
