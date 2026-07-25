import "fake-indexeddb/auto";
import {
  ARGON2ID_PRODUCTION_FLOOR,
  bytesToBase64Url,
  type CryptoProvider,
  createCryptoProvider,
  type DevicePrfProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import { IndexedDbVaultHeaderRepository } from "@zk-wallet/persistence";
import { createVaultService } from "@zk-wallet/vault";
import { afterEach, describe, expect, it } from "vitest";

const databaseNames: string[] = [];

function databaseName(): string {
  const name = `zk-wallet-task3-integration-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        }),
    ),
  );
});

const prfOutput = new Uint8Array(32).fill(0xd3);
const devicePrf: DevicePrfProvider = {
  async enroll() {
    return { credentialId: "synthetic-credential", prfOutput: prfOutput.slice() };
  },
  async evaluate() {
    return prfOutput.slice();
  },
  async getCapability() {
    return "supported";
  },
};

function service(
  name: string,
  cryptoProvider: CryptoProvider,
  repository = new IndexedDbVaultHeaderRepository({ databaseName: name }),
) {
  return createVaultService({
    calibration: {
      maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
      targetMilliseconds: 0,
    },
    crypto: cryptoProvider,
    devicePrf,
    repository,
  });
}

describe("Task 3 encrypted persistence integration", () => {
  it("persists no Recovery Kit, PRF output, password, raw root key, or compartment key", async () => {
    const provider = createCryptoProvider();
    const generatedSecrets: string[] = [];
    const fastProvider: CryptoProvider = {
      deriveArgon2id: (password, salt) =>
        provider.hkdfSha256(password, salt, utf8ToBytes("test-only-fast-kdf"), 32),
      hkdfSha256: (inputKey, salt, info, length) =>
        provider.hkdfSha256(inputKey, salt, info, length),
      openXChaCha20Poly1305: (key, nonce, ciphertext, aad) =>
        provider.openXChaCha20Poly1305(key, nonce, ciphertext, aad),
      randomBytes(length) {
        const bytes = provider.randomBytes(length);
        if (length === 32 && generatedSecrets.length < 4) {
          generatedSecrets.push(bytesToBase64Url(bytes.slice()));
        }
        return bytes;
      },
      sealXChaCha20Poly1305: (key, nonce, plaintext, aad) =>
        provider.sealXChaCha20Poly1305(key, nonce, plaintext, aad),
    };
    const name = databaseName();
    const repository = new IndexedDbVaultHeaderRepository({ databaseName: name });
    const masterPassword = "synthetic Task 3 master password";
    const newMasterPassword = "synthetic rotated Task 3 master password";
    const creator = service(name, fastProvider, repository);

    const created = await creator.createVault(masterPassword);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit drill state");
    }
    const recoveryKit = created.recovery.recoveryKit;
    await creator.verifyRecoveryKit(recoveryKit);
    await creator.enrollDevice(masterPassword);
    await creator.changeMasterPassword({
      currentPassword: masterPassword,
      newPassword: newMasterPassword,
    });

    const persisted = JSON.stringify(await repository.read());
    expect(persisted).not.toContain(masterPassword);
    expect(persisted).not.toContain(newMasterPassword);
    expect(persisted).not.toContain(recoveryKit.replaceAll(" ", ""));
    expect(persisted).not.toContain(bytesToBase64Url(prfOutput));
    expect(persisted).not.toContain("zk-wallet-empty-vault");
    expect(generatedSecrets).toHaveLength(4);
    for (const secret of generatedSecrets) expect(persisted).not.toContain(secret);

    creator.lock();
    const reopened = service(name, fastProvider);
    await expect(reopened.initialize()).resolves.toMatchObject({ status: "locked" });
    await expect(reopened.unlock(newMasterPassword)).resolves.toMatchObject({
      status: "unlocked",
      unlockedCompartments: [],
    });

    const restoredName = databaseName();
    const restored = service(restoredName, fastProvider);
    await expect(
      restored.restoreVault({
        encryptedVault: await repository.read(),
        newMasterPassword: "clean profile password",
        recoveryKit,
      }),
    ).resolves.toMatchObject({ status: "unlocked", unlockedCompartments: [] });
    restored.lock();
    await expect(restored.unlock("clean profile password")).resolves.toMatchObject({
      status: "unlocked",
    });
  });
});
