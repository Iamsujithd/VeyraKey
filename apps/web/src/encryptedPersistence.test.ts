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
import { createVaultService, openEncryptedItemShare } from "@zk-wallet/vault";
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

  it("keeps immutable item history and restores an older value as a new revision", async () => {
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
    const service = createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto: fastProvider,
      itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
      repository: new IndexedDbVaultHeaderRepository({ databaseName: name }),
    });
    const listItemHistory = service.listItemHistory;
    const restoreItemRevision = service.restoreItemRevision;
    if (listItemHistory === undefined || restoreItemRevision === undefined) {
      throw new Error("Item history is unavailable");
    }
    await service.createVault("history-master-password");
    const created = await service.createLogin({
      notes: "first",
      password: "first-password",
      title: "History test",
      uris: ["https://history.example"],
      username: "person@example.test",
    });
    const updated = await service.updateLogin(created.id, created.revisionId, {
      notes: "second",
      password: "second-password",
      title: "History test",
      uris: ["https://history.example"],
      username: "person@example.test",
    });

    await expect(listItemHistory(created.id)).resolves.toMatchObject([
      { item: { password: "second-password" }, operation: "update" },
      { item: { password: "first-password" }, operation: "create" },
    ]);
    const restored = await restoreItemRevision(created.id, created.revisionId, updated.revisionId);
    expect(restored).toMatchObject({
      id: created.id,
      password: "first-password",
      type: "login",
    });
    expect(restored.revisionId).not.toBe(created.revisionId);
    await expect(listItemHistory(created.id)).resolves.toHaveLength(3);
    await expect(
      restoreItemRevision(created.id, updated.revisionId, updated.revisionId),
    ).rejects.toMatchObject({ code: "ITEM_WRITE_CONFLICT" });
  });

  it("can recover a deleted item without removing its tombstone from history", async () => {
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
    const service = createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto: fastProvider,
      itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
      repository: new IndexedDbVaultHeaderRepository({ databaseName: name }),
    });
    const listItemHistory = service.listItemHistory;
    const restoreItemRevision = service.restoreItemRevision;
    if (listItemHistory === undefined || restoreItemRevision === undefined) {
      throw new Error("Item history is unavailable");
    }
    await service.createVault("deleted-history-master-password");
    const note = await service.createSecureNote({ note: "recover me", title: "Deleted note" });
    await service.deleteItem(note.id, note.revisionId);
    const history = await listItemHistory(note.id);
    expect(history).toMatchObject([
      { item: null, operation: "delete" },
      { item: { note: "recover me" }, operation: "create" },
    ]);

    const deletedHead = history[0];
    if (deletedHead === undefined) throw new Error("Missing deletion history");
    const restored = await restoreItemRevision(note.id, note.revisionId, deletedHead.revisionId);
    expect(restored).toMatchObject({ note: "recover me", type: "secure-note" });
    await expect(listItemHistory(note.id)).resolves.toMatchObject([
      { item: { note: "recover me" }, operation: "update" },
      { item: null, operation: "delete" },
      { item: { note: "recover me" }, operation: "create" },
    ]);
  });

  it("exports one authenticated item without exposing its plaintext or vault keys", async () => {
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
    const service = createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto: fastProvider,
      itemRepository: new IndexedDbItemRevisionRepository({ databaseName: name }),
      repository: new IndexedDbVaultHeaderRepository({ databaseName: name }),
    });
    if (service.createItemShare === undefined) throw new Error("Encrypted sharing is unavailable");
    await service.createVault("sharing-master-password");
    const login = await service.createLogin({
      notes: "one item only",
      password: "share-only-password",
      title: "Share test",
      uris: ["https://share.example"],
      username: "shared@example.test",
    });
    const now = new Date().toISOString();
    const created = await service.createItemShare(
      login.id,
      new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    );

    expect(JSON.stringify(created.bundle)).not.toContain("share-only-password");
    expect(JSON.stringify(created.bundle)).not.toContain("shared@example.test");
    await expect(
      openEncryptedItemShare(fastProvider, created.bundle, created.secret, now),
    ).resolves.toMatchObject({ password: "share-only-password", type: "login" });
  });
});
