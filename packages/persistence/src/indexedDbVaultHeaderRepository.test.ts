// @vitest-environment jsdom

import "fake-indexeddb/auto";
import type { VaultHeaderV1 } from "@zk-wallet/vault";
import { afterEach, describe, expect, it } from "vitest";
import { IndexedDbVaultHeaderRepository } from "./index";

const databaseNames: string[] = [];

function repository() {
  const databaseName = `zk-wallet-test-${crypto.randomUUID()}`;
  databaseNames.push(databaseName);
  return new IndexedDbVaultHeaderRepository({ databaseName });
}

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (databaseName) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        }),
    ),
  );
});

describe("IndexedDbVaultHeaderRepository", () => {
  it("returns null before a vault exists", async () => {
    await expect(repository().read()).resolves.toBeNull();
  });

  it("atomically persists one structured-clone-safe encrypted header", async () => {
    const first = repository();
    const header = {
      encryptedPayload: {
        algorithm: "xchacha20-poly1305-ietf",
        ciphertext: "opaque-payload-ciphertext",
        contentSchemaVersion: 1,
        nonce: "opaque-payload-nonce",
        purpose: "vault-payload",
        version: 1,
      },
      format: "zk-wallet-vault",
      masterPasswordSlot: {
        id: "opaque-slot-id",
        kdf: {
          algorithm: "argon2id-1.3",
          memoryKiB: 19_456,
          operations: 2,
          outputLength: 32,
          parallelism: 1,
          salt: "opaque-salt",
        },
        type: "master-password",
        version: 1,
        wrappedRootKey: {
          algorithm: "xchacha20-poly1305-ietf",
          ciphertext: "opaque-root-key-ciphertext",
          contentSchemaVersion: 1,
          nonce: "opaque-root-key-nonce",
          purpose: "root-key-wrap",
          version: 1,
        },
      },
      minimumClientVersion: 1,
      vaultId: "opaque-vault-id",
      version: 1,
    } satisfies VaultHeaderV1;

    await first.create(header);

    const reopened = new IndexedDbVaultHeaderRepository({
      databaseName: first.databaseName,
    });
    await expect(reopened.read()).resolves.toEqual(header);
    await expect(reopened.create(header)).rejects.toMatchObject({
      code: "VAULT_ALREADY_EXISTS",
    });
  });
});

describe("IndexedDbVaultHeaderRepository compare-and-replace", () => {
  it("atomically accepts one matching writer and rejects a stale competing writer", async () => {
    const first = repository();
    const original = {
      encryptedPayload: {
        algorithm: "xchacha20-poly1305-ietf",
        ciphertext: "original-payload-ciphertext",
        contentSchemaVersion: 1,
        nonce: "opaque-payload-nonce",
        purpose: "vault-payload",
        version: 1,
      },
      format: "zk-wallet-vault",
      masterPasswordSlot: {
        id: "opaque-slot-id",
        kdf: {
          algorithm: "argon2id-1.3",
          memoryKiB: 19_456,
          operations: 2,
          outputLength: 32,
          parallelism: 1,
          salt: "opaque-salt",
        },
        type: "master-password",
        version: 1,
        wrappedRootKey: {
          algorithm: "xchacha20-poly1305-ietf",
          ciphertext: "opaque-root-key-ciphertext",
          contentSchemaVersion: 1,
          nonce: "opaque-root-key-nonce",
          purpose: "root-key-wrap",
          version: 1,
        },
      },
      minimumClientVersion: 1,
      vaultId: "opaque-vault-id",
      version: 1,
    } satisfies VaultHeaderV1;
    await first.create(original);

    const competing = new IndexedDbVaultHeaderRepository({ databaseName: first.databaseName });
    const winner = {
      ...structuredClone(original),
      revision: 1,
      version: 2,
    } as unknown as VaultHeaderV1;
    (winner.encryptedPayload as { ciphertext: string }).ciphertext = "winner-payload-ciphertext";
    await first.replace(
      { revision: null, vaultId: original.vaultId, version: original.version },
      winner,
    );

    const loser = structuredClone(original);
    loser.encryptedPayload.ciphertext = "loser-payload-ciphertext";
    await expect(
      competing.replace(
        { revision: null, vaultId: original.vaultId, version: original.version },
        loser,
      ),
    ).rejects.toMatchObject({ code: "VAULT_WRITE_CONFLICT" });
    await expect(first.read()).resolves.toEqual(winner);
  });

  it("rejects replacement when no committed vault matches", async () => {
    await expect(
      repository().replace(
        { revision: 1, vaultId: "missing-vault", version: 2 },
        {} as VaultHeaderV1,
      ),
    ).rejects.toMatchObject({ code: "VAULT_WRITE_CONFLICT" });
  });
});
