import "fake-indexeddb/auto";
import {
  ARGON2ID_PRODUCTION_FLOOR,
  bytesToBase64Url,
  type CryptoProvider,
  createCryptoProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import {
  IndexedDbItemRevisionRepository,
  IndexedDbVaultHeaderRepository,
} from "@zk-wallet/persistence";
import { createVaultService } from "@zk-wallet/vault";
import { afterEach, describe, expect, it } from "vitest";

const databaseNames: string[] = [];

function databaseName(): string {
  const name = `zk-wallet-web-integration-${crypto.randomUUID()}`;
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

describe("encrypted IndexedDB vault integration", () => {
  it("persists no password, plaintext payload marker, or raw root key across reopen", async () => {
    const provider = createCryptoProvider();
    let rootKeyEncoding = "";
    const fastProvider: CryptoProvider = {
      deriveArgon2id: (password, salt) =>
        provider.hkdfSha256(password, salt, utf8ToBytes("test-only-fast-kdf"), 32),
      hkdfSha256: (inputKey, salt, info, length) =>
        provider.hkdfSha256(inputKey, salt, info, length),
      openXChaCha20Poly1305: (key, nonce, ciphertext, aad) =>
        provider.openXChaCha20Poly1305(key, nonce, ciphertext, aad),
      randomBytes(length) {
        const bytes = provider.randomBytes(length);
        if (length === 32) {
          rootKeyEncoding = bytesToBase64Url(bytes.slice());
        }
        return bytes;
      },
      sealXChaCha20Poly1305: (key, nonce, plaintext, aad) =>
        provider.sealXChaCha20Poly1305(key, nonce, plaintext, aad),
    };
    const name = databaseName();
    const repository = new IndexedDbVaultHeaderRepository({ databaseName: name });
    const masterPassword = "synthetic integration master password";
    const createService = () =>
      createVaultService({
        calibration: {
          maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
          targetMilliseconds: 0,
        },
        crypto: fastProvider,
        itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
        repository: new IndexedDbVaultHeaderRepository({ databaseName: name }),
      });
    const creator = createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto: fastProvider,
      itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
      repository,
    });

    await creator.createVault(masterPassword);
    creator.lock();

    const persisted = JSON.stringify(await repository.read());
    expect(persisted).not.toContain(masterPassword);
    expect(persisted).not.toContain("zk-wallet-empty-vault");
    expect(rootKeyEncoding).not.toBe("");
    expect(persisted).not.toContain(rootKeyEncoding);

    const reopened = createService();
    await expect(reopened.initialize()).resolves.toMatchObject({ status: "locked" });
    await expect(reopened.unlock("wrong synthetic password")).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
    await expect(reopened.unlock(masterPassword)).resolves.toMatchObject({
      itemCount: 0,
      status: "unlocked",
    });
    reopened.lock();
  });

  it("creates, updates, deletes, and reopens encrypted login and note revisions", async () => {
    const provider = createCryptoProvider();
    const fastProvider: CryptoProvider = {
      deriveArgon2id: (password, salt) =>
        provider.hkdfSha256(password, salt, utf8ToBytes("test-only-fast-kdf"), 32),
      hkdfSha256: (inputKey, salt, info, length) =>
        provider.hkdfSha256(inputKey, salt, info, length),
      openXChaCha20Poly1305: (key, nonce, ciphertext, aad) =>
        provider.openXChaCha20Poly1305(key, nonce, ciphertext, aad),
      randomBytes: (length) => provider.randomBytes(length),
      sealXChaCha20Poly1305: (key, nonce, plaintext, aad) =>
        provider.sealXChaCha20Poly1305(key, nonce, plaintext, aad),
    };
    const name = databaseName();
    const makeService = () =>
      createVaultService({
        calibration: {
          maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
          targetMilliseconds: 0,
        },
        crypto: fastProvider,
        itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
        repository: new IndexedDbVaultHeaderRepository({ databaseName: name }),
      });
    const creator = makeService();
    await creator.createVault("task-four-master-password");
    const login = await creator.createLogin({
      notes: "sentinel login notes",
      password: "sentinel login password",
      title: "Example login",
      uris: ["https://example.test"],
      username: "person@example.test",
    });
    const note = await creator.createSecureNote({
      note: "sentinel private note",
      title: "Private note",
    });
    const updated = await creator.updateLogin(login.id, login.revisionId, {
      notes: "updated notes",
      password: "updated password",
      title: "Example login",
      uris: ["https://example.test"],
      username: "person@example.test",
    });
    await creator.deleteItem(note.id, note.revisionId);
    expect(await creator.listItems()).toEqual([updated]);
    creator.lock();

    const reopened = makeService();
    await reopened.initialize();
    await reopened.unlock("task-four-master-password");
    await expect(reopened.listItems()).resolves.toEqual([updated]);

    const stored = JSON.stringify(
      await new IndexedDbItemRevisionRepository({ databaseName: name }).listHeads(),
    );
    expect(stored).not.toContain("updated password");
    expect(stored).not.toContain("person@example.test");
    expect(stored).not.toContain("sentinel private note");
  });
});
