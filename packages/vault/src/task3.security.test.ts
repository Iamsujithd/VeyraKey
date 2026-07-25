import {
  ARGON2ID_PRODUCTION_FLOOR,
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  createCryptoProvider,
  type DevicePrfProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";
import { describe, expect, it } from "vitest";
import {
  createVaultService,
  decodeRecoveryKit,
  type EncryptedEnvelopeV1,
  parseVaultHeader,
  type VaultHeader,
  type VaultHeaderRepository,
  type VaultHeaderV1,
  type VaultHeaderV2,
  type VaultHeaderWriteCondition,
} from "./index";

const MASTER_PASSWORD = "correct horse battery staple";

class MemoryRepository implements VaultHeaderRepository {
  value: unknown = null;

  async create(header: VaultHeader): Promise<void> {
    if (this.value !== null) {
      throw Object.assign(new Error("exists"), { code: "VAULT_ALREADY_EXISTS" });
    }
    this.value = structuredClone(header);
  }

  async read() {
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
  repository: VaultHeaderRepository,
  crypto = fastCryptoProvider(),
  devicePrf?: DevicePrfProvider,
) {
  return createVaultService({
    calibration: {
      maximumMemoryKiB: ARGON2ID_PRODUCTION_FLOOR.memoryKiB,
      targetMilliseconds: 0,
    },
    crypto,
    ...(devicePrf === undefined ? {} : { devicePrf }),
    repository,
  });
}

async function sealV1Envelope(
  crypto: CryptoProvider,
  key: Uint8Array,
  plaintext: Uint8Array,
  purpose: "root-key-wrap" | "vault-payload",
  vaultId: string,
  subjectId: string,
): Promise<EncryptedEnvelopeV1> {
  const nonce = crypto.randomBytes(24);
  const envelope: EncryptedEnvelopeV1 = {
    algorithm: "xchacha20-poly1305-ietf",
    ciphertext: "",
    contentSchemaVersion: 1,
    nonce: bytesToBase64Url(nonce),
    purpose,
    version: 1,
  };
  const aad = encodeEnvelopeAad({
    algorithm: envelope.algorithm,
    contentSchemaVersion: envelope.contentSchemaVersion,
    envelopeVersion: envelope.version,
    purpose,
    subjectId,
    vaultId,
  });
  const ciphertext = await crypto.sealXChaCha20Poly1305(key, nonce, plaintext, aad);
  return { ...envelope, ciphertext: bytesToBase64Url(ciphertext) };
}

async function replaceWrappedRootWithForeignKey(
  repository: MemoryRepository,
  crypto: CryptoProvider,
  slotKind: "master-password" | "recovery-kit" | "webauthn-prf",
  slotId: string,
  baseKey: Uint8Array,
  authenticationRoot: Uint8Array,
): Promise<void> {
  const parsed = parseVaultHeader(await repository.read());
  if (parsed.version !== 2) throw new Error("Expected V2 header");
  const changed = structuredClone(parsed) as VaultHeaderV2;
  const vaultIdBytes = base64UrlToBytes(changed.vaultId);
  const wrongRoot = new Uint8Array(32).fill(0xa7);
  const wrappingKey = await crypto.hkdfSha256(
    baseKey,
    vaultIdBytes,
    utf8ToBytes(`zk-wallet/v2/${slotKind}/root-wrap`),
    32,
  );
  try {
    const wrappedRoot = await sealV1Envelope(
      crypto,
      wrappingKey,
      wrongRoot,
      "root-key-wrap",
      changed.vaultId,
      slotId,
    );
    if (slotKind === "master-password") {
      (changed.masterPasswordSlot.wrappedKeys as { root: EncryptedEnvelopeV1 }).root = wrappedRoot;
    } else if (slotKind === "recovery-kit") {
      (changed.recoverySlot.wrappedKeys as { root: EncryptedEnvelopeV1 }).root = wrappedRoot;
    } else {
      const slot = changed.deviceSlots.find(
        (candidate) => candidate.status === "active" && candidate.id === slotId,
      );
      if (slot?.status !== "active") throw new Error("Expected active device slot");
      (slot.wrappedKeys as { root: EncryptedEnvelopeV1 }).root = wrappedRoot;
    }
    const authenticationData = utf8ToBytes(
      JSON.stringify({
        deviceSlots: changed.deviceSlots,
        encryptedPayload: changed.encryptedPayload,
        format: changed.format,
        masterPasswordSlot: changed.masterPasswordSlot,
        minimumClientVersion: changed.minimumClientVersion,
        recoverySlot: changed.recoverySlot,
        revision: changed.revision,
        vaultId: changed.vaultId,
        version: changed.version,
      }),
    );
    const authenticationInfo = utf8ToBytes("zk-wallet/v2/header-authentication");
    const authenticationNonce = crypto.randomBytes(24);
    const emptyPlaintext = new Uint8Array(0);
    let authenticationKey: Uint8Array | null = null;
    let authenticationCiphertext: Uint8Array | null = null;
    let securityTag: Uint8Array | null = null;
    try {
      authenticationKey = await crypto.hkdfSha256(
        authenticationRoot,
        vaultIdBytes,
        authenticationInfo,
        32,
      );
      authenticationCiphertext = await crypto.sealXChaCha20Poly1305(
        authenticationKey,
        authenticationNonce,
        emptyPlaintext,
        authenticationData,
      );
      securityTag = new Uint8Array(authenticationNonce.length + authenticationCiphertext.length);
      securityTag.set(authenticationNonce);
      securityTag.set(authenticationCiphertext, authenticationNonce.length);
      (changed as VaultHeaderV2 & { securityTag: string }).securityTag =
        bytesToBase64Url(securityTag);
      repository.value = changed;
    } finally {
      zeroBytes(authenticationData);
      zeroBytes(authenticationInfo);
      zeroBytes(authenticationNonce);
      zeroBytes(emptyPlaintext);
      if (authenticationKey !== null) zeroBytes(authenticationKey);
      if (authenticationCiphertext !== null) zeroBytes(authenticationCiphertext);
      if (securityTag !== null) zeroBytes(securityTag);
    }
  } finally {
    zeroBytes(vaultIdBytes);
    zeroBytes(wrongRoot);
    zeroBytes(wrappingKey);
  }
}

async function legacyV1Header(): Promise<VaultHeaderV1> {
  const crypto = fastCryptoProvider();
  const vaultIdBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const slotIdBytes = Uint8Array.from({ length: 16 }, (_, index) => index + 33);
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 65);
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 97);
  const password = utf8ToBytes(MASTER_PASSWORD);
  const vaultId = bytesToBase64Url(vaultIdBytes);
  const slotId = bytesToBase64Url(slotIdBytes);
  let baseKey: Uint8Array | null = null;
  let wrappingKey: Uint8Array | null = null;
  let payloadKey: Uint8Array | null = null;
  try {
    baseKey = await crypto.deriveArgon2id(password, salt, ARGON2ID_PRODUCTION_FLOOR);
    wrappingKey = await crypto.hkdfSha256(
      baseKey,
      vaultIdBytes,
      utf8ToBytes("zk-wallet/v1/master-password/root-wrap"),
      32,
    );
    payloadKey = await crypto.hkdfSha256(
      rootKey,
      vaultIdBytes,
      utf8ToBytes("zk-wallet/v1/vault-payload"),
      32,
    );
    return {
      encryptedPayload: await sealV1Envelope(
        crypto,
        payloadKey,
        utf8ToBytes(
          JSON.stringify({ format: "zk-wallet-empty-vault", items: [], schemaVersion: 1 }),
        ),
        "vault-payload",
        vaultId,
        "vault-payload",
      ),
      format: "zk-wallet-vault",
      masterPasswordSlot: {
        id: slotId,
        kdf: { ...ARGON2ID_PRODUCTION_FLOOR, salt: bytesToBase64Url(salt) },
        type: "master-password",
        version: 1,
        wrappedRootKey: await sealV1Envelope(
          crypto,
          wrappingKey,
          rootKey,
          "root-key-wrap",
          vaultId,
          slotId,
        ),
      },
      minimumClientVersion: 1,
      vaultId,
      version: 1,
    };
  } finally {
    zeroBytes(password);
    zeroBytes(rootKey);
    if (baseKey !== null) zeroBytes(baseKey);
    if (wrappingKey !== null) zeroBytes(wrappingKey);
    if (payloadKey !== null) zeroBytes(payloadKey);
  }
}

describe("Task 3 migration and lifecycle races", () => {
  it("migrates an authenticated V1 vault atomically and leaves a wrong-password V1 untouched", async () => {
    const original = await legacyV1Header();
    const repository = new MemoryRepository();
    repository.value = structuredClone(original);
    const service = serviceFor(repository);

    await expect(service.initialize()).resolves.toMatchObject({ status: "locked" });
    await expect(service.unlock("wrong password")).rejects.toMatchObject({
      code: "INVALID_PASSWORD_OR_CORRUPT_DATA",
    });
    expect(repository.value).toEqual(original);

    const migrated = await service.unlock(MASTER_PASSWORD);
    expect(migrated).toMatchObject({
      recovery: { recoveryKit: expect.stringMatching(/^ZKWR1/u), status: "pending" },
      status: "unlocked",
      unlockedCompartments: [],
    });
    const header = parseVaultHeader(repository.value);
    expect(header).toMatchObject({ minimumClientVersion: 2, revision: 1, version: 2 });
  });

  it("keeps lock authoritative over an in-flight PRF unlock", async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signal = new Promise<void>((resolve) => {
      started = resolve;
    });
    const output = new Uint8Array(32).fill(0x44);
    let blockEvaluation = false;
    const devicePrf: DevicePrfProvider = {
      async enroll() {
        return { credentialId: "Y3JlZGVudGlhbA", prfOutput: output.slice() };
      },
      async evaluate() {
        if (blockEvaluation) {
          started();
          await gate;
        }
        return output.slice();
      },
      async getCapability() {
        return "supported";
      },
    };
    const repository = new MemoryRepository();
    const service = serviceFor(repository, fastCryptoProvider(), devicePrf);
    const created = await service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending")
      throw new Error("kit");
    await service.verifyRecoveryKit(created.recovery.recoveryKit);
    const enrolled = await service.enrollDevice(MASTER_PASSWORD);
    if (enrolled.status !== "unlocked") throw new Error("Expected unlocked state");
    const slotId = enrolled.deviceUnlock.slots[0]?.id;
    if (slotId === undefined) throw new Error("slot");
    service.lock();

    blockEvaluation = true;
    const unlocking = service.unlockWithDevice(slotId);
    await signal;
    expect(service.lock()).toMatchObject({ status: "locked" });
    release();
    await expect(unlocking).resolves.toMatchObject({ status: "locked" });
    expect(service.getState()).toMatchObject({ status: "locked" });
  });

  it("keeps lock authoritative over an in-flight compartment step-up", async () => {
    const repository = new MemoryRepository();
    const base = fastCryptoProvider();
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signal = new Promise<void>((resolve) => {
      started = resolve;
    });
    let blockDerivation = false;
    const controlled: CryptoProvider = {
      ...base,
      async deriveArgon2id(password, salt, parameters) {
        if (blockDerivation) {
          started();
          await gate;
        }
        return base.deriveArgon2id(password, salt, parameters);
      },
    };
    const service = serviceFor(repository, controlled);
    const created = await service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending")
      throw new Error("kit");
    await service.verifyRecoveryKit(created.recovery.recoveryKit);

    blockDerivation = true;
    const steppingUp = service.stepUpCompartment("credential", {
      password: MASTER_PASSWORD,
      type: "master-password",
    });
    await signal;
    expect(service.lock()).toMatchObject({ status: "locked" });
    release();
    await expect(steppingUp).resolves.toMatchObject({ status: "locked" });
    expect(service.getState()).toMatchObject({ status: "locked" });
  });

  it("binds every compartment step-up credential to the active root session", async () => {
    const repository = new MemoryRepository();
    const crypto = fastCryptoProvider();
    const deviceOutput = new Uint8Array(32).fill(0x5c);
    const devicePrf: DevicePrfProvider = {
      async enroll() {
        return { credentialId: "Y3JlZGVudGlhbC0x", prfOutput: deviceOutput.slice() };
      },
      async evaluate() {
        return deviceOutput.slice();
      },
      async getCapability() {
        return "supported";
      },
    };
    const service = serviceFor(repository, crypto, devicePrf);
    const created = await service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    const recoveryKit = created.recovery.recoveryKit;
    await service.verifyRecoveryKit(recoveryKit);
    const enrolled = await service.enrollDevice(MASTER_PASSWORD);
    if (enrolled.status !== "unlocked") throw new Error("Expected unlocked state");
    const deviceSlotId = enrolled.deviceUnlock.slots[0]?.id;
    if (deviceSlotId === undefined) throw new Error("Expected device slot");

    const header = parseVaultHeader(await repository.read());
    if (header.version !== 2) throw new Error("Expected V2 header");
    const password = utf8ToBytes(MASTER_PASSWORD);
    const salt = base64UrlToBytes(header.masterPasswordSlot.kdf.salt);
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    const masterBase = await crypto.deriveArgon2id(password, salt, header.masterPasswordSlot.kdf);
    const masterWrappingKey = await crypto.hkdfSha256(
      masterBase,
      vaultIdBytes,
      utf8ToBytes("zk-wallet/v2/master-password/root-wrap"),
      32,
    );
    const wrappedRoot = header.masterPasswordSlot.wrappedKeys.root;
    const wrappedRootNonce = base64UrlToBytes(wrappedRoot.nonce);
    const wrappedRootCiphertext = base64UrlToBytes(wrappedRoot.ciphertext);
    const wrappedRootAad = encodeEnvelopeAad({
      algorithm: wrappedRoot.algorithm,
      contentSchemaVersion: wrappedRoot.contentSchemaVersion,
      envelopeVersion: wrappedRoot.version,
      purpose: wrappedRoot.purpose,
      subjectId: header.masterPasswordSlot.id,
      vaultId: header.vaultId,
    });
    const authenticationRoot = await crypto.openXChaCha20Poly1305(
      masterWrappingKey,
      wrappedRootNonce,
      wrappedRootCiphertext,
      wrappedRootAad,
    );
    const recoveryBase = decodeRecoveryKit(recoveryKit);
    try {
      await replaceWrappedRootWithForeignKey(
        repository,
        crypto,
        "master-password",
        header.masterPasswordSlot.id,
        masterBase,
        authenticationRoot,
      );
      await expect(
        service.stepUpCompartment("document", {
          password: MASTER_PASSWORD,
          type: "master-password",
        }),
      ).rejects.toMatchObject({ code: "INVALID_PASSWORD_OR_CORRUPT_DATA" });

      await replaceWrappedRootWithForeignKey(
        repository,
        crypto,
        "recovery-kit",
        header.recoverySlot.id,
        recoveryBase,
        authenticationRoot,
      );
      await expect(
        service.stepUpCompartment("document", {
          recoveryKit,
          type: "recovery-kit",
        }),
      ).rejects.toMatchObject({ code: "INVALID_RECOVERY_KIT_OR_CORRUPT_DATA" });

      await replaceWrappedRootWithForeignKey(
        repository,
        crypto,
        "webauthn-prf",
        deviceSlotId,
        deviceOutput,
        authenticationRoot,
      );
      await expect(
        service.stepUpCompartment("credential", {
          slotId: deviceSlotId,
          type: "device",
        }),
      ).rejects.toMatchObject({ code: "DEVICE_UNLOCK_FAILED" });
      expect(service.getState()).toMatchObject({ unlockedCompartments: [] });
    } finally {
      zeroBytes(password);
      zeroBytes(salt);
      zeroBytes(vaultIdBytes);
      zeroBytes(masterBase);
      zeroBytes(masterWrappingKey);
      zeroBytes(wrappedRootNonce);
      zeroBytes(wrappedRootCiphertext);
      zeroBytes(wrappedRootAad);
      zeroBytes(authenticationRoot);
      zeroBytes(recoveryBase);
      zeroBytes(deviceOutput);
      service.lock();
    }
  });

  it("locks and reloads a CAS loser that held an open compartment", async () => {
    const repository = new MemoryRepository();
    const winner = serviceFor(repository);
    const created = await winner.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    await winner.verifyRecoveryKit(created.recovery.recoveryKit);

    const base = fastCryptoProvider();
    let blockDerivation = false;
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signal = new Promise<void>((resolve) => {
      started = resolve;
    });
    const controlled: CryptoProvider = {
      ...base,
      async deriveArgon2id(password, salt, parameters) {
        if (blockDerivation) {
          started();
          await gate;
        }
        return base.deriveArgon2id(password, salt, parameters);
      },
    };
    const loser = serviceFor(repository, controlled);
    await loser.initialize();
    await loser.unlock(MASTER_PASSWORD);
    await loser.stepUpCompartment("document", {
      password: MASTER_PASSWORD,
      type: "master-password",
    });
    expect(loser.getState()).toMatchObject({ unlockedCompartments: ["document"] });

    blockDerivation = true;
    const losingWrite = loser.changeMasterPassword({
      currentPassword: MASTER_PASSWORD,
      newPassword: "losing replacement password",
    });
    await signal;
    await winner.replaceRecoveryKit(MASTER_PASSWORD);
    release();

    await expect(losingWrite).rejects.toMatchObject({ code: "VAULT_WRITE_CONFLICT" });
    expect(loser.getState()).toMatchObject({
      status: "locked",
      vaultId: expect.any(String),
    });
  });

  it("rejects authenticated recovery-payload replay and full-header rollback", async () => {
    const repository = new MemoryRepository();
    const service = serviceFor(repository);
    const created = await service.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    await service.verifyRecoveryKit(created.recovery.recoveryKit);
    const verifiedHeader = parseVaultHeader(await repository.read());
    if (verifiedHeader.version !== 2) throw new Error("Expected V2 header");

    await service.replaceRecoveryKit(MASTER_PASSWORD);
    const replacementHeader = parseVaultHeader(await repository.read());
    if (replacementHeader.version !== 2) throw new Error("Expected V2 header");
    repository.value = {
      ...structuredClone(replacementHeader),
      encryptedPayload: structuredClone(verifiedHeader.encryptedPayload),
    };

    await expect(
      service.changeMasterPassword({
        currentPassword: MASTER_PASSWORD,
        newPassword: "replacement password",
      }),
    ).rejects.toMatchObject({ code: "VAULT_WRITE_CONFLICT" });
    expect(service.getState()).toMatchObject({ status: "locked" });

    repository.value = structuredClone(replacementHeader);
    await service.initialize();
    await service.unlock(MASTER_PASSWORD);
    repository.value = structuredClone(verifiedHeader);
    await expect(service.replaceRecoveryKit(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "VAULT_WRITE_CONFLICT",
    });
    expect(service.getState()).toMatchObject({ status: "locked" });
  });

  it("reconciles a newer encrypted recovery gate before privileged mutations", async () => {
    const repository = new MemoryRepository();
    const first = serviceFor(repository);
    const created = await first.createVault(MASTER_PASSWORD);
    if (created.status !== "unlocked" || created.recovery.status !== "pending") {
      throw new Error("Expected Recovery Kit");
    }
    await first.verifyRecoveryKit(created.recovery.recoveryKit);

    const stale = serviceFor(repository, fastCryptoProvider(), {
      async enroll() {
        return {
          credentialId: "Y3JlZGVudGlhbC1zdGFsZQ",
          prfOutput: new Uint8Array(32).fill(0x33),
        };
      },
      async evaluate() {
        return new Uint8Array(32).fill(0x33);
      },
      async getCapability() {
        return "supported";
      },
    });
    await stale.initialize();
    await stale.unlock(MASTER_PASSWORD);
    expect(stale.getState()).toMatchObject({ recovery: { status: "verified" } });

    await first.replaceRecoveryKit(MASTER_PASSWORD);
    const before = await repository.read();
    await expect(
      stale.changeMasterPassword({
        currentPassword: MASTER_PASSWORD,
        newPassword: "replacement password",
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_VERIFICATION_REQUIRED" });
    await expect(stale.enrollDevice(MASTER_PASSWORD)).rejects.toMatchObject({
      code: "RECOVERY_VERIFICATION_REQUIRED",
    });
    expect(stale.getState()).toMatchObject({ recovery: { status: "replacement-required" } });
    await expect(repository.read()).resolves.toEqual(before);
  });
});
