import {
  ARGON2ID_PRODUCTION_FLOOR,
  CryptoError,
  type CryptoProvider,
  createCryptoProvider,
  type DevicePrfCapability,
  type DevicePrfEnrollmentRequest,
  type DevicePrfEvaluationRequest,
  type DevicePrfProvider,
  utf8ToBytes,
} from "@zk-wallet/crypto";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVaultService,
  decodeRecoveryKit,
  encodeRecoveryKit,
  parseVaultHeader,
  type VaultHeader,
  type VaultHeaderRepository,
  type VaultHeaderWriteCondition,
} from "./index";

const MASTER_PASSWORD = "correct horse battery staple";
const NEW_MASTER_PASSWORD = "a newer correct horse battery staple";

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
    if (this.value === null) {
      throw Object.assign(new Error("vault does not exist"), { code: "VAULT_WRITE_CONFLICT" });
    }
    const current = this.value as {
      readonly revision?: number;
      readonly vaultId?: string;
      readonly version?: number;
    };
    if (
      current.vaultId !== condition.vaultId ||
      current.version !== condition.version ||
      (current.revision ?? null) !== condition.revision
    ) {
      throw Object.assign(new Error("stale vault header"), { code: "VAULT_WRITE_CONFLICT" });
    }
    this.value = structuredClone(header);
  }
}

class FakeDevicePrfProvider implements DevicePrfProvider {
  capability: DevicePrfCapability = "supported";
  credentialCounter = 0;
  evaluationCount = 0;
  output = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

  async getCapability(): Promise<DevicePrfCapability> {
    return this.capability;
  }

  async enroll(_request: DevicePrfEnrollmentRequest) {
    this.credentialCounter += 1;
    return {
      credentialId: `credential-${this.credentialCounter}`,
      prfOutput: this.output.slice(),
    };
  }

  async evaluate(_request: DevicePrfEvaluationRequest): Promise<Uint8Array> {
    this.evaluationCount += 1;
    return this.output.slice();
  }
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

function serviceFor(
  repository = new MemoryVaultHeaderRepository(),
  devicePrf = new FakeDevicePrfProvider(),
  crypto = fastCryptoProvider(),
) {
  return {
    devicePrf,
    repository,
    service: createVaultService({
      calibration: {
        maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
        targetMilliseconds: 0,
      },
      crypto,
      devicePrf,
      repository,
      session: {
        autoLockMilliseconds: 300_000,
        compartmentTtlMilliseconds: 60_000,
      },
    }),
  };
}

async function createAndVerify(service: ReturnType<typeof createVaultService>) {
  const created = await service.createVault(MASTER_PASSWORD);
  expect(created).toMatchObject({
    recovery: { status: "pending" },
    status: "unlocked",
    unlockedCompartments: [],
  });
  if (created.status !== "unlocked" || created.recovery.status !== "pending") {
    throw new Error("Expected a pending Recovery Kit drill");
  }
  await service.verifyRecoveryKit(created.recovery.recoveryKit);
  return created.recovery.recoveryKit;
}

describe("Recovery Kit encoding", () => {
  it("round-trips a versioned 256-bit secret in grouped Bech32m form", () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const encoded = encodeRecoveryKit(secret);

    expect(encoded).toMatch(/^ZKWR1[023456789AC-HJ-NP-Z ]+$/u);
    expect(encoded).toContain(" ");
    expect(decodeRecoveryKit(encoded)).toEqual(secret);
    expect(decodeRecoveryKit(encoded.toLowerCase())).toEqual(secret);
  });

  it("rejects checksum corruption, the wrong prefix, mixed case, and wrong entropy length", () => {
    const encoded = encodeRecoveryKit(new Uint8Array(32).fill(0xa5));
    const compact = encoded.replaceAll(" ", "");
    const replacement = compact.endsWith("Q") ? "P" : "Q";

    expect(() => decodeRecoveryKit(`${compact.slice(0, -1)}${replacement}`)).toThrow(
      expect.objectContaining({ code: "INVALID_RECOVERY_KIT" }),
    );
    expect(() => decodeRecoveryKit(compact.replace(/^ZKWR/u, "OTHER"))).toThrow(
      expect.objectContaining({ code: "INVALID_RECOVERY_KIT" }),
    );
    expect(() =>
      decodeRecoveryKit(`${compact.slice(0, 5).toLowerCase()}${compact.slice(5)}`),
    ).toThrow(expect.objectContaining({ code: "INVALID_RECOVERY_KIT" }));
    expect(() => encodeRecoveryKit(new Uint8Array(31))).toThrow(
      expect.objectContaining({ code: "INVALID_RECOVERY_KIT" }),
    );
  });

  it("property-round-trips arbitrary 256-bit Recovery Kit secrets", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (secret) => {
        expect(decodeRecoveryKit(encodeRecoveryKit(secret))).toEqual(secret);
      }),
      { numRuns: 64 },
    );
  });
});

describe("Task 3 key hierarchy and recovery", () => {
  it("creates strict V2 independent master/recovery wrappers and requires a Recovery Kit drill", async () => {
    const { repository, service } = serviceFor();

    const created = await service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected a pending Recovery Kit drill");
    }

    const header = parseVaultHeader(await repository.read());
    if (header.version !== 2) throw new Error("Expected VaultHeaderV2");

    expect(header.revision).toBe(1);
    expect(header.deviceSlots).toEqual([]);
    expect(
      new Set([
        header.masterPasswordSlot.wrappedKeys.root.nonce,
        header.masterPasswordSlot.wrappedKeys.document.nonce,
        header.masterPasswordSlot.wrappedKeys.credential.nonce,
        header.recoverySlot.wrappedKeys.root.nonce,
        header.recoverySlot.wrappedKeys.document.nonce,
        header.recoverySlot.wrappedKeys.credential.nonce,
        header.encryptedPayload.nonce,
      ]).size,
    ).toBe(7);

    const persisted = JSON.stringify(await repository.read());
    expect(persisted).not.toContain(MASTER_PASSWORD);
    expect(persisted).not.toContain(created.recovery.recoveryKit.replaceAll(" ", ""));
    expect(persisted).not.toContain("zk-wallet-empty-vault");

    const recoveryKit = created.recovery.recoveryKit;
    const replacement = recoveryKit.endsWith("Q") ? "P" : "Q";
    const corrupted = `${recoveryKit.slice(0, -1)}${replacement}`;
    await expect(service.verifyRecoveryKit(corrupted)).rejects.toMatchObject({
      code: "INVALID_RECOVERY_KIT_OR_CORRUPT_DATA",
    });
    await expect(service.verifyRecoveryKit(created.recovery.recoveryKit)).resolves.toMatchObject({
      recovery: { status: "verified" },
      status: "unlocked",
    });
  });

  it("restores a clean profile from strict encrypted BYOS state and rewraps a new password", async () => {
    const source = serviceFor();
    const recoveryKit = await createAndVerify(source.service);
    const encryptedVault = await source.repository.read();

    const restored = serviceFor();
    await expect(
      restored.service.restoreVault({
        encryptedVault,
        newMasterPassword: NEW_MASTER_PASSWORD,
        recoveryKit,
      }),
    ).resolves.toMatchObject({
      recovery: { status: "verified" },
      status: "unlocked",
      unlockedCompartments: [],
    });

    restored.service.lock();
    await expect(restored.service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
    await expect(restored.service.unlock(NEW_MASTER_PASSWORD)).resolves.toMatchObject({
      status: "unlocked",
      unlockedCompartments: [],
    });
    await expect(
      restored.service.stepUpCompartment("document", {
        recoveryKit,
        type: "recovery-kit",
      }),
    ).resolves.toMatchObject({ unlockedCompartments: ["document"] });
  });

  it("rejects corrupted recovery state without creating anything in a clean profile", async () => {
    const source = serviceFor();
    const recoveryKit = await createAndVerify(source.service);
    const encryptedVault = structuredClone(await source.repository.read()) as {
      recoverySlot: { wrappedKeys: { credential: { ciphertext: string } } };
    };
    const ciphertext = encryptedVault.recoverySlot.wrappedKeys.credential.ciphertext;
    encryptedVault.recoverySlot.wrappedKeys.credential.ciphertext = `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`;

    const restored = serviceFor();
    await expect(
      restored.service.restoreVault({
        encryptedVault,
        newMasterPassword: NEW_MASTER_PASSWORD,
        recoveryKit,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RECOVERY_KIT_OR_CORRUPT_DATA" });
    await expect(restored.repository.read()).resolves.toBeNull();
  });

  it("preserves retryable persistence errors during recovery verification and restore", async () => {
    const verification = serviceFor();
    const created = await verification.service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    verification.repository.replace = async () => {
      throw Object.assign(new Error("conflict"), { code: "VAULT_WRITE_CONFLICT" });
    };
    await expect(
      verification.service.verifyRecoveryKit(created.recovery.recoveryKit),
    ).rejects.toMatchObject({ code: "VAULT_WRITE_CONFLICT" });

    const source = serviceFor();
    const recoveryKit = await createAndVerify(source.service);
    const encryptedVault = await source.repository.read();
    const restoreRepository = new MemoryVaultHeaderRepository();
    restoreRepository.create = async () => {
      throw Object.assign(new Error("storage unavailable"), { code: "PERSISTENCE_FAILURE" });
    };
    const restored = serviceFor(restoreRepository);
    await expect(
      restored.service.restoreVault({
        encryptedVault,
        newMasterPassword: NEW_MASTER_PASSWORD,
        recoveryKit,
      }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_FAILURE" });
  });

  it("preserves crypto-provider outages during Recovery Kit operations", async () => {
    const base = fastCryptoProvider();
    let unavailable = false;
    const controlled: CryptoProvider = {
      ...base,
      async hkdfSha256(inputKey, salt, info, length) {
        if (unavailable) {
          throw new CryptoError("CRYPTO_UNAVAILABLE", "Test crypto provider unavailable");
        }
        return base.hkdfSha256(inputKey, salt, info, length);
      },
    };
    const verification = serviceFor(
      new MemoryVaultHeaderRepository(),
      new FakeDevicePrfProvider(),
      controlled,
    );
    const created = await verification.service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    const recoveryKitUnderTest = created.recovery.recoveryKit;
    unavailable = true;
    await expect(
      verification.service.verifyRecoveryKit(recoveryKitUnderTest),
    ).rejects.toMatchObject({ code: "CRYPTO_UNAVAILABLE" });

    unavailable = false;
    await verification.service.verifyRecoveryKit(recoveryKitUnderTest);
    const enrolled = await verification.service.enrollDevice(MASTER_PASSWORD);
    if (enrolled.status !== "unlocked") throw new Error("Expected unlocked state");
    const slotId = enrolled.deviceUnlock.slots[0]?.id;
    if (slotId === undefined) throw new Error("Expected device slot");
    verification.service.lock();
    unavailable = true;
    await expect(verification.service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "CRYPTO_UNAVAILABLE",
    });
    await expect(verification.service.unlockWithDevice(slotId)).rejects.toMatchObject({
      code: "CRYPTO_UNAVAILABLE",
    });
    await expect(
      verification.service.unlockWithRecoveryKit(recoveryKitUnderTest),
    ).rejects.toMatchObject({ code: "CRYPTO_UNAVAILABLE" });

    unavailable = false;
    const source = serviceFor();
    const recoveryKit = await createAndVerify(source.service);
    const encryptedVault = await source.repository.read();
    unavailable = true;
    const restored = serviceFor(
      new MemoryVaultHeaderRepository(),
      new FakeDevicePrfProvider(),
      controlled,
    );
    await expect(
      restored.service.restoreVault({
        encryptedVault,
        newMasterPassword: NEW_MASTER_PASSWORD,
        recoveryKit,
      }),
    ).rejects.toMatchObject({ code: "CRYPTO_UNAVAILABLE" });
  });

  it("keeps document and credential keys sealed until a fresh step-up, then expires them", async () => {
    vi.useFakeTimers();
    const { service } = serviceFor();
    await createAndVerify(service);
    service.lock();

    await expect(service.unlock(MASTER_PASSWORD)).resolves.toMatchObject({
      status: "unlocked",
      unlockedCompartments: [],
    });
    await expect(
      service.stepUpCompartment("document", {
        password: MASTER_PASSWORD,
        type: "master-password",
      }),
    ).resolves.toMatchObject({ unlockedCompartments: ["document"] });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(service.getState()).toMatchObject({ unlockedCompartments: ["document"] });
    await vi.advanceTimersByTimeAsync(1);
    expect(service.getState()).toMatchObject({ status: "unlocked", unlockedCompartments: [] });
    service.lock();
  });

  it("auto-locks only after the bounded root idle timeout and activity resets that timeout", async () => {
    vi.useFakeTimers();
    const { service } = serviceFor();
    await createAndVerify(service);

    await vi.advanceTimersByTimeAsync(299_000);
    service.recordActivity();
    await vi.advanceTimersByTimeAsync(299_000);
    expect(service.getState()).toMatchObject({ status: "unlocked" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.getState()).toMatchObject({ status: "locked" });
  });
});

describe("Task 3 device slots and master-password rotation", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("enrolls a capability-gated PRF slot, unlocks with it, and preserves password fallback", async () => {
    const { devicePrf, repository, service } = serviceFor();
    await createAndVerify(service);

    const enrolled = await service.enrollDevice(MASTER_PASSWORD);
    expect(enrolled).toMatchObject({
      deviceUnlock: { available: true, slots: [{ id: expect.any(String) }] },
      status: "unlocked",
      unlockedCompartments: [],
    });
    if (enrolled.status !== "unlocked") throw new Error("Expected unlocked state");
    const slotId = enrolled.deviceUnlock.slots[0]?.id;
    if (slotId === undefined) throw new Error("Expected an enrolled slot");

    const header = parseVaultHeader(await repository.read());
    if (header.version !== 2) throw new Error("Expected VaultHeaderV2");
    expect(header.deviceSlots).toHaveLength(1);
    expect(header.deviceSlots[0]).toMatchObject({ status: "active", type: "webauthn-prf" });

    service.lock();
    await expect(service.unlockWithDevice(slotId)).resolves.toMatchObject({
      status: "unlocked",
      unlockedCompartments: [],
    });
    expect(devicePrf.evaluationCount).toBe(1);

    service.lock();
    devicePrf.output.fill(0xff);
    await expect(service.unlockWithDevice(slotId)).rejects.toMatchObject({
      code: "DEVICE_UNLOCK_FAILED",
    });
    await expect(service.unlock(MASTER_PASSWORD)).resolves.toMatchObject({ status: "unlocked" });
  });

  it("does not enroll when PRF is unsupported and never weakens fallback", async () => {
    const devicePrf = new FakeDevicePrfProvider();
    devicePrf.capability = "unsupported";
    const { service } = serviceFor(new MemoryVaultHeaderRepository(), devicePrf);
    await createAndVerify(service);

    await expect(service.enrollDevice(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "DEVICE_UNLOCK_UNAVAILABLE",
    });
    expect(service.getState()).toMatchObject({
      deviceUnlock: { available: false, slots: [] },
      status: "unlocked",
    });
    service.lock();
    await expect(service.unlock(MASTER_PASSWORD)).resolves.toMatchObject({ status: "unlocked" });
  });

  it("rejects a non-canonical PRF credential ID without persisting a device slot", async () => {
    const devicePrf = new FakeDevicePrfProvider();
    const rejectedOutput = devicePrf.output.slice();
    devicePrf.enroll = async () => ({
      credentialId: "credential",
      prfOutput: rejectedOutput,
    });
    const repository = new MemoryVaultHeaderRepository();
    const { service } = serviceFor(repository, devicePrf);
    await createAndVerify(service);
    const before = await repository.read();

    await expect(service.enrollDevice(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "DEVICE_UNLOCK_FAILED",
    });
    expect(rejectedOutput).toEqual(new Uint8Array(32));
    await expect(repository.read()).resolves.toEqual(before);
  });

  it("revokes a device to a wrapper-free tombstone and rejects future slot use", async () => {
    const { repository, service } = serviceFor();
    await createAndVerify(service);
    const enrolled = await service.enrollDevice(MASTER_PASSWORD);
    if (enrolled.status !== "unlocked") throw new Error("Expected unlocked state");
    const slotId = enrolled.deviceUnlock.slots[0]?.id;
    if (slotId === undefined) throw new Error("Expected an enrolled slot");

    await expect(service.revokeDevice(slotId)).resolves.toMatchObject({
      deviceUnlock: { slots: [] },
    });
    const header = parseVaultHeader(await repository.read());
    if (header.version !== 2) throw new Error("Expected VaultHeaderV2");
    expect(header.deviceSlots).toContainEqual({
      id: slotId,
      status: "revoked",
      type: "webauthn-prf",
      version: 1,
    });

    service.lock();
    await expect(service.unlockWithDevice(slotId)).rejects.toMatchObject({
      code: "DEVICE_SLOT_REVOKED",
    });
    await expect(service.unlock(MASTER_PASSWORD)).resolves.toMatchObject({ status: "unlocked" });
  });

  it("changes the master password by rewrapping keys without rewriting payload or fallback slots", async () => {
    const { repository, service } = serviceFor();
    const recoveryKit = await createAndVerify(service);
    await service.enrollDevice(MASTER_PASSWORD);
    const before = parseVaultHeader(await repository.read());
    if (before.version !== 2) throw new Error("Expected VaultHeaderV2");

    await service.changeMasterPassword({
      currentPassword: MASTER_PASSWORD,
      newPassword: NEW_MASTER_PASSWORD,
    });
    const after = parseVaultHeader(await repository.read());
    if (after.version !== 2) throw new Error("Expected VaultHeaderV2");

    expect(after.revision).toBe(before.revision + 1);
    expect(after.encryptedPayload).toEqual(before.encryptedPayload);
    expect(after.recoverySlot).toEqual(before.recoverySlot);
    expect(after.deviceSlots).toEqual(before.deviceSlots);
    expect(after.masterPasswordSlot).not.toEqual(before.masterPasswordSlot);

    service.lock();
    await expect(service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
    await expect(service.unlock(NEW_MASTER_PASSWORD)).resolves.toMatchObject({
      status: "unlocked",
    });
    service.lock();
    await expect(service.unlockWithRecoveryKit(recoveryKit)).resolves.toMatchObject({
      status: "unlocked",
    });
  });

  it("rejects duplicate device identities and wrapper-purpose substitution", async () => {
    const { repository, service } = serviceFor();
    await createAndVerify(service);
    await service.enrollDevice(MASTER_PASSWORD);
    const duplicate = structuredClone(await repository.read()) as {
      deviceSlots: unknown[];
    };
    duplicate.deviceSlots.push(structuredClone(duplicate.deviceSlots[0]));
    expect(() => parseVaultHeader(duplicate)).toThrow(
      expect.objectContaining({ code: "INVALID_VAULT_HEADER" }),
    );

    const substituted = structuredClone(await repository.read()) as {
      masterPasswordSlot: {
        wrappedKeys: { document: unknown; root: unknown };
      };
    };
    const root = substituted.masterPasswordSlot.wrappedKeys.root;
    substituted.masterPasswordSlot.wrappedKeys.root =
      substituted.masterPasswordSlot.wrappedKeys.document;
    substituted.masterPasswordSlot.wrappedKeys.document = root;
    repository.value = substituted;
    service.lock();
    await expect(service.unlock(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
  });

  it("authenticates and resumes a short-lived MV3 root session after service restart", async () => {
    const repository = new MemoryVaultHeaderRepository();
    const first = serviceFor(repository).service;
    await createAndVerify(first);
    const material = first.exportSessionMaterial?.();
    if (material === undefined) throw new Error("Expected session export support");
    first.lock();

    const restarted = serviceFor(repository).service;
    await restarted.initialize();
    await expect(restarted.resumeSession?.(material)).resolves.toMatchObject({
      status: "unlocked",
    });
    expect(material.rootKey).toEqual(new Uint8Array(32));

    expect(() => first.exportSessionMaterial?.()).toThrow(
      expect.objectContaining({ code: "VAULT_LOCKED" }),
    );
    const wrong = {
      expiresAt: Date.now() + 60_000,
      rootKey: new Uint8Array(32).fill(7),
      vaultId: "wrong-vault",
      version: 1 as const,
    };
    restarted.lock();
    await expect(restarted.resumeSession?.(wrong)).rejects.toMatchObject({ code: "VAULT_LOCKED" });
    expect(wrong.rootKey).toEqual(new Uint8Array(32));
  });
});
