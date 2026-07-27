import {
  ARGON2ID_PRODUCTION_FLOOR,
  type CryptoProvider,
  createCryptoProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createVaultService,
  parseVaultHeader,
  type VaultHeader,
  type VaultHeaderRepository,
  type VaultHeaderWriteCondition,
} from "./index";

const MASTER_PASSWORD = "correct horse battery staple";

class MemoryVaultHeaderRepository implements VaultHeaderRepository {
  value: unknown = null;

  async read(): Promise<unknown | null> {
    return this.value === null ? null : structuredClone(this.value);
  }

  async create(header: VaultHeader): Promise<void> {
    if (this.value !== null) throw new Error("vault already exists");
    this.value = structuredClone(header);
  }

  async replace(condition: VaultHeaderWriteCondition, header: VaultHeader): Promise<void> {
    const current = this.value as { revision?: number; vaultId?: string; version?: number } | null;
    if (
      current === null ||
      current.vaultId !== condition.vaultId ||
      current.version !== condition.version ||
      (current.revision ?? null) !== condition.revision
    ) {
      throw Object.assign(new Error("conflict"), { code: "VAULT_WRITE_CONFLICT" });
    }
    this.value = structuredClone(header);
  }
}

type MutableHeader = {
  encryptedPayload: { ciphertext: string };
  masterPasswordSlot: {
    kdf: { memoryKiB: number };
    wrappedKeys: { root: { ciphertext: string } };
  };
  version: number;
};

function mutableHeader(value: unknown): MutableHeader {
  return structuredClone(value) as MutableHeader;
}

function createFastTestCryptoProvider(): CryptoProvider {
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

function serviceFor(repository = new MemoryVaultHeaderRepository()) {
  return {
    repository,
    service: createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto: createFastTestCryptoProvider(),
      repository,
    }),
  };
}

describe("vault creation and unlock", () => {
  it("creates, locks, rejects a wrong password, and unlocks an empty vault", async () => {
    const { repository, service } = serviceFor();

    await expect(service.initialize()).resolves.toEqual({ status: "needs-setup" });
    await expect(service.createVault(MASTER_PASSWORD)).resolves.toMatchObject({
      itemCount: 0,
      recovery: { status: "pending" },
      status: "unlocked",
    });

    const persisted = JSON.stringify(await repository.read());
    expect(persisted).not.toContain(MASTER_PASSWORD);
    expect(persisted).not.toContain("zk-wallet-empty-vault");

    expect(service.lock()).toMatchObject({ status: "locked" });
    await expect(service.unlock("definitely the wrong password")).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
    expect(service.getState()).toMatchObject({ status: "locked" });
    await expect(service.unlock(MASTER_PASSWORD)).resolves.toMatchObject({
      itemCount: 0,
      status: "unlocked",
      unlockedCompartments: [],
    });
  });

  it("uses distinct nonces across key wrappers and the payload", async () => {
    const { repository, service } = serviceFor();
    await service.createVault(MASTER_PASSWORD);

    const header = parseVaultHeader(await repository.read());
    if (header.version !== 2) throw new Error("Expected V2 header");
    expect(header.masterPasswordSlot.wrappedKeys.root.nonce).not.toBe(
      header.encryptedPayload.nonce,
    );
    expect(header.masterPasswordSlot.wrappedKeys.document.nonce).not.toBe(
      header.masterPasswordSlot.wrappedKeys.credential.nonce,
    );
  });

  it("fails closed for tampered and truncated ciphertext", async () => {
    const { repository, service } = serviceFor();
    await service.createVault(MASTER_PASSWORD);
    service.lock();

    const tampered = mutableHeader(parseVaultHeader(await repository.read()));
    const ciphertext = tampered.masterPasswordSlot.wrappedKeys.root.ciphertext;
    tampered.masterPasswordSlot.wrappedKeys.root.ciphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    repository.value = tampered;
    await expect(service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });

    const { repository: secondRepository, service: secondService } = serviceFor();
    await secondService.createVault(MASTER_PASSWORD);
    secondService.lock();
    const truncated = mutableHeader(parseVaultHeader(await secondRepository.read()));
    truncated.encryptedPayload.ciphertext = truncated.encryptedPayload.ciphertext.slice(0, -4);
    secondRepository.value = truncated;
    await expect(secondService.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
  });

  it("rejects unsupported versions and below-floor KDF parameters before derivation", async () => {
    const { repository, service } = serviceFor();
    await service.createVault(MASTER_PASSWORD);
    service.lock();

    const unsupported = mutableHeader(parseVaultHeader(await repository.read()));
    unsupported.version = 3;
    repository.value = unsupported;
    await expect(service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "UNSUPPORTED_VAULT_VERSION",
    });

    const { repository: secondRepository, service: secondService } = serviceFor();
    await secondService.createVault(MASTER_PASSWORD);
    secondService.lock();
    const weak = mutableHeader(parseVaultHeader(await secondRepository.read()));
    weak.masterPasswordSlot.kdf.memoryKiB = ARGON2ID_PRODUCTION_FLOOR.memoryKiB - 1;
    secondRepository.value = weak;
    await expect(secondService.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "KDF_POLICY_VIOLATION",
    });
  });

  it("round-trips generated Unicode master passwords", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }).filter((value) => value.trim().length > 0),
        async (password) => {
          const { service } = serviceFor();
          await service.createVault(password);
          service.lock();
          await expect(service.unlock(password)).resolves.toMatchObject({
            itemCount: 0,
            status: "unlocked",
          });
          service.lock();
        },
      ),
      { numRuns: 16 },
    );
  });
});
