import {
  ARGON2ID_PRODUCTION_FLOOR,
  bytesToBase64Url,
  type CryptoProvider,
  createCryptoProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import {
  createVaultService,
  parseVaultHeader,
  type VaultHeader,
  type VaultHeaderRepository,
  type VaultHeaderV2,
  type VaultHeaderWriteCondition,
} from "./index";

const MASTER_PASSWORD = "correct horse battery staple";

class MemoryVaultHeaderRepository implements VaultHeaderRepository {
  value: unknown = null;

  async create(header: VaultHeader): Promise<void> {
    if (this.value !== null) {
      throw Object.assign(new Error("vault already exists"), { code: "VAULT_ALREADY_EXISTS" });
    }
    this.value = structuredClone(header);
  }

  async read(): Promise<unknown | null> {
    return this.value === null ? null : structuredClone(this.value);
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

type MutableSecurityHeader = {
  encryptedPayload: { ciphertext: string };
  masterPasswordSlot: { kdf: { memoryKiB: number; operations: number } };
  minimumClientVersion: number;
};

function mutableHeader(value: unknown): MutableSecurityHeader {
  return structuredClone(value) as MutableSecurityHeader;
}

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

function serviceFor(repository: VaultHeaderRepository, crypto = fastCryptoProvider()) {
  return createVaultService({
    calibration: {
      maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
      targetMilliseconds: 0,
    },
    crypto,
    repository,
  });
}

async function createHeader(): Promise<VaultHeaderV2> {
  const repository = new MemoryVaultHeaderRepository();
  await serviceFor(repository).createVault(MASTER_PASSWORD);
  const header = parseVaultHeader(await repository.read());
  if (header.version !== 2) throw new Error("Expected V2 header");
  return header;
}

describe("vault security boundaries", () => {
  it("rejects persisted KDF work above the supported cap or operation count", async () => {
    const header = await createHeader();
    const excessiveMemory = mutableHeader(header);
    excessiveMemory.masterPasswordSlot.kdf.memoryKiB = 65_537;
    expect(() => parseVaultHeader(excessiveMemory)).toThrow(
      expect.objectContaining({ code: "KDF_POLICY_VIOLATION" }),
    );

    const excessiveOperations = mutableHeader(header);
    excessiveOperations.masterPasswordSlot.kdf.operations = 3;
    expect(() => parseVaultHeader(excessiveOperations)).toThrow(
      expect.objectContaining({ code: "KDF_POLICY_VIOLATION" }),
    );
  });

  it("rejects malformed minimum-client versions and oversized fixed payloads", async () => {
    const header = await createHeader();
    const invalidMinimum = mutableHeader(header);
    invalidMinimum.minimumClientVersion = 1;
    expect(() => parseVaultHeader(invalidMinimum)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_VAULT_VERSION" }),
    );

    const oversizedPayload = mutableHeader(header);
    oversizedPayload.encryptedPayload.ciphertext = bytesToBase64Url(new Uint8Array(256));
    expect(() => parseVaultHeader(oversizedPayload)).toThrow(
      expect.objectContaining({ code: "INVALID_VAULT_HEADER" }),
    );
  });

  it("keeps an explicit lock authoritative over an in-flight unlock", async () => {
    const repository = new MemoryVaultHeaderRepository();
    const base = fastCryptoProvider();
    let derivationCount = 0;
    let releaseDerivation: () => void = () => undefined;
    let signalDerivationStarted: () => void = () => undefined;
    const derivationStarted = new Promise<void>((resolve) => {
      signalDerivationStarted = resolve;
    });
    const derivationGate = new Promise<void>((resolve) => {
      releaseDerivation = resolve;
    });
    const controlled: CryptoProvider = {
      ...base,
      async deriveArgon2id(password, salt, parameters) {
        derivationCount += 1;
        if (derivationCount === 2) {
          signalDerivationStarted();
          await derivationGate;
        }
        return base.deriveArgon2id(password, salt, parameters);
      },
    };
    const service = serviceFor(repository, controlled);
    await service.createVault(MASTER_PASSWORD);
    service.lock();

    const unlocking = service.unlock(MASTER_PASSWORD);
    await derivationStarted;
    expect(service.lock()).toMatchObject({ status: "locked" });
    releaseDerivation();

    await expect(unlocking).resolves.toMatchObject({ status: "locked" });
    expect(service.getState()).toMatchObject({ status: "locked" });
  });

  it("recovers a stale setup client when another client already created the vault", async () => {
    const winningHeader = await createHeader();
    const repository = new MemoryVaultHeaderRepository();
    const staleService = serviceFor(repository);
    await expect(staleService.initialize()).resolves.toEqual({ status: "needs-setup" });
    repository.value = structuredClone(winningHeader);

    await expect(staleService.createVault("another strong password")).rejects.toMatchObject({
      code: "VAULT_ALREADY_EXISTS",
    });
    expect(staleService.getState()).toMatchObject({
      status: "locked",
      vaultId: winningHeader.vaultId,
    });
  });

  it("keeps an explicit lock authoritative over an in-flight create", async () => {
    const repository = new MemoryVaultHeaderRepository();
    const base = fastCryptoProvider();
    let releaseDerivation: () => void = () => undefined;
    let signalDerivationStarted: () => void = () => undefined;
    const derivationStarted = new Promise<void>((resolve) => {
      signalDerivationStarted = resolve;
    });
    const derivationGate = new Promise<void>((resolve) => {
      releaseDerivation = resolve;
    });
    const controlled: CryptoProvider = {
      ...base,
      async deriveArgon2id(password, salt, parameters) {
        signalDerivationStarted();
        await derivationGate;
        return base.deriveArgon2id(password, salt, parameters);
      },
    };
    const service = serviceFor(repository, controlled);

    const creating = service.createVault(MASTER_PASSWORD);
    await derivationStarted;
    expect(service.lock()).toEqual({ status: "needs-setup" });
    releaseDerivation();

    await expect(creating).resolves.toMatchObject({ status: "locked" });
    const committed = parseVaultHeader(await repository.read());
    expect(service.getState()).toMatchObject({ status: "locked", vaultId: committed.vaultId });
  });

  it("moves a duplicate-create loser to the winning vault's locked state", async () => {
    const winningHeader = await createHeader();
    let readCount = 0;
    const losingRepository: VaultHeaderRepository = {
      async create() {
        throw Object.assign(new Error("vault already exists"), { code: "VAULT_ALREADY_EXISTS" });
      },
      async read() {
        readCount += 1;
        return readCount === 1 ? null : structuredClone(winningHeader);
      },
      async replace() {
        throw Object.assign(new Error("conflict"), { code: "VAULT_WRITE_CONFLICT" });
      },
    };
    const losingService = serviceFor(losingRepository);

    await expect(losingService.createVault("another strong password")).rejects.toMatchObject({
      code: "VAULT_ALREADY_EXISTS",
    });
    expect(losingService.getState()).toMatchObject({
      status: "locked",
      vaultId: winningHeader.vaultId,
    });
  });
});
