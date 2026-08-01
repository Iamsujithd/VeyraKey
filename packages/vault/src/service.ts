import {
  ARGON2ID_ALGORITHM,
  ARGON2ID_PRODUCTION_FLOOR,
  type Argon2idParameters,
  base64UrlToBytes,
  bytesToBase64Url,
  CryptoError,
  type CryptoProvider,
  DevicePrfError,
  type DevicePrfProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  XCHACHA20_POLY1305_ALGORITHM,
  zeroBytes,
} from "@zk-wallet/crypto";
import { createEncryptedVaultArchive, openEncryptedVaultArchive } from "./archive";
import { parseVaultHeader } from "./header";
import {
  createEncryptedItemRevision,
  createEncryptedTombstone,
  type EncryptedItemRevisionV1,
  type IdentityProfileItemInput,
  ItemError,
  type ItemRevisionRepository,
  type LoginItemInput,
  openEncryptedItemRevision,
  type PaymentCardItemInput,
  parseEncryptedItemRevision,
  type SecureNoteItemInput,
  type VaultItem,
} from "./items";
import { decodeRecoveryKit, encodeRecoveryKit } from "./recovery";
import { encryptSearchIndex, searchEncryptedIndex } from "./search";
import { createEncryptedItemShare } from "./share";
import {
  type ActiveDeviceSlot,
  type ActiveDeviceSlotV2,
  type ChangeMasterPasswordRequest,
  type DeviceSlotV1,
  type DeviceUnlockSummary,
  EMPTY_VAULT_SCHEMA_VERSION,
  type EmptyVaultPayloadV1,
  ENVELOPE_VERSION,
  type EncryptedEnvelope,
  type EnvelopePurpose,
  type KeyKind,
  type MasterPasswordSlotV2,
  type PasswordKdfV1,
  type RecoveryKitSlotV1,
  type RecoveryPublicState,
  type RestoreVaultRequest,
  type SensitiveCompartment,
  type StepUpCredential,
  TASK3_VAULT_SCHEMA_VERSION,
  type Task3VaultPayloadV2,
  VAULT_HEADER_FORMAT,
  VAULT_HEADER_VERSION,
  VAULT_MINIMUM_CLIENT_VERSION,
  type VaultClient,
  VaultError,
  type VaultHeader,
  type VaultHeaderRepository,
  type VaultHeaderV1,
  type VaultHeaderV2,
  type VaultItemHistoryEntry,
  type VaultPublicState,
  type WrappedKeySetV1,
} from "./types";

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const OPAQUE_ID_BYTES = 16;
const NONCE_BYTES = 24;
const PRF_INPUT_BYTES = 32;
const MAX_CREDENTIAL_ID_BYTES = 1024;
const MAX_PASSWORD_BYTES = 1024;
const DEFAULT_TARGET_MILLISECONDS = 350;
const DEFAULT_MAXIMUM_MEMORY_KIB = 65_536;
const MEMORY_CANDIDATES_KIB = [19_456, 32_768, 49_152, 65_536] as const;
const DEFAULT_AUTO_LOCK_MILLISECONDS = 300_000;
const MINIMUM_AUTO_LOCK_MILLISECONDS = 60_000;
const MAXIMUM_AUTO_LOCK_MILLISECONDS = 3_600_000;
const DEFAULT_COMPARTMENT_TTL_MILLISECONDS = 60_000;
const MINIMUM_COMPARTMENT_TTL_MILLISECONDS = 15_000;
const MAXIMUM_COMPARTMENT_TTL_MILLISECONDS = 300_000;
const MAXIMUM_DEVICE_SLOTS = 16;
const PAYLOAD_SUBJECT_ID = "vault-payload";
const V1_ROOT_WRAP_INFO = utf8ToBytes("zk-wallet/v1/master-password/root-wrap");
const V1_PAYLOAD_INFO = utf8ToBytes("zk-wallet/v1/vault-payload");
const V2_PAYLOAD_INFO = utf8ToBytes("zk-wallet/v2/vault-payload");
const V2_HEADER_AUTH_INFO = utf8ToBytes("zk-wallet/v2/header-authentication");

const EMPTY_PAYLOAD_V1: EmptyVaultPayloadV1 = Object.freeze({
  format: "zk-wallet-empty-vault",
  items: [] as const,
  schemaVersion: EMPTY_VAULT_SCHEMA_VERSION,
});

const unavailableDevicePrf: DevicePrfProvider = {
  async enroll() {
    throw new Error("PRF unavailable");
  },
  async evaluate() {
    throw new Error("PRF unavailable");
  },
  async getCapability() {
    return "unsupported";
  },
  getScope() {
    return null;
  },
};

interface KeySetBytes {
  credential: Uint8Array;
  document: Uint8Array;
  root: Uint8Array;
}

export interface KdfCalibrationOptions {
  readonly maximumMemoryKiB?: number;
  readonly targetMilliseconds?: number;
}

export interface VaultSessionOptions {
  readonly autoLockMilliseconds?: number;
  readonly compartmentTtlMilliseconds?: number;
}

export interface CreateVaultServiceOptions {
  readonly calibration?: KdfCalibrationOptions;
  readonly crypto: CryptoProvider;
  readonly devicePrf?: DevicePrfProvider;
  readonly itemRepository?: ItemRevisionRepository;
  readonly now?: () => number;
  readonly repository: VaultHeaderRepository;
  readonly session?: VaultSessionOptions;
}

function invalidUnlock(): VaultError {
  return new VaultError(
    "INVALID_PASSWORD_OR_CORRUPT_DATA",
    "The password is incorrect or the local vault data is corrupt",
  );
}

function invalidRecovery(): VaultError {
  return new VaultError(
    "INVALID_RECOVERY_KIT_OR_CORRUPT_DATA",
    "The Recovery Kit is invalid or the encrypted vault data is corrupt",
  );
}

function deviceUnlockFailed(message = "Device unlock failed"): VaultError {
  return new VaultError("DEVICE_UNLOCK_FAILED", message);
}

function isCryptoUnavailable(error: unknown): boolean {
  return error instanceof CryptoError && error.code === "CRYPTO_UNAVAILABLE";
}

function validateGeneratedV2Header(header: VaultHeaderV2): VaultHeaderV2 {
  const validated = parseVaultHeader(header);
  if (validated.version !== VAULT_HEADER_VERSION) {
    throw new VaultError("INVALID_VAULT_HEADER", "Generated vault header version is invalid");
  }
  return validated;
}

function validateCredentialId(credentialId: string): string {
  let decoded: Uint8Array | null = null;
  try {
    decoded = base64UrlToBytes(credentialId);
    if (decoded.length === 0 || decoded.length > MAX_CREDENTIAL_ID_BYTES) {
      throw new Error("Credential ID length is invalid");
    }
    return credentialId;
  } catch {
    throw deviceUnlockFailed();
  } finally {
    if (decoded !== null) zeroBytes(decoded);
  }
}

function passwordBytes(masterPassword: string): Uint8Array {
  const bytes = utf8ToBytes(masterPassword);
  if (bytes.length === 0 || bytes.length > MAX_PASSWORD_BYTES) {
    zeroBytes(bytes);
    throw invalidUnlock();
  }
  return bytes;
}

function aadFor(envelope: EncryptedEnvelope, vaultId: string, subjectId: string): Uint8Array {
  return encodeEnvelopeAad({
    algorithm: envelope.algorithm,
    contentSchemaVersion: envelope.contentSchemaVersion,
    envelopeVersion: envelope.version,
    purpose: envelope.purpose,
    subjectId,
    vaultId,
  });
}

function parsePayloadV1(bytes: Uint8Array): EmptyVaultPayloadV1 {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "format,items,schemaVersion"
    ) {
      throw new Error("schema");
    }
    const payload = value as Record<string, unknown>;
    if (
      payload.format !== EMPTY_PAYLOAD_V1.format ||
      payload.schemaVersion !== EMPTY_PAYLOAD_V1.schemaVersion ||
      !Array.isArray(payload.items) ||
      payload.items.length !== 0
    ) {
      throw new Error("schema");
    }
    return EMPTY_PAYLOAD_V1;
  } catch {
    throw invalidUnlock();
  }
}

function task3Payload(recoveryKitVerified: boolean): Task3VaultPayloadV2 {
  return {
    format: "zk-wallet-empty-vault",
    items: [],
    recoveryKitVerified,
    schemaVersion: TASK3_VAULT_SCHEMA_VERSION,
  };
}

function parsePayloadV2(bytes: Uint8Array): Task3VaultPayloadV2 {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "format,items,recoveryKitVerified,schemaVersion"
    ) {
      throw new Error("schema");
    }
    const payload = value as Record<string, unknown>;
    if (
      payload.format !== "zk-wallet-empty-vault" ||
      payload.schemaVersion !== TASK3_VAULT_SCHEMA_VERSION ||
      typeof payload.recoveryKitVerified !== "boolean" ||
      !Array.isArray(payload.items) ||
      payload.items.length !== 0
    ) {
      throw new Error("schema");
    }
    return task3Payload(payload.recoveryKitVerified);
  } catch {
    throw invalidUnlock();
  }
}

function defaultNow(): number {
  return Date.now();
}

function wipeKeySet(keys: Partial<KeySetBytes> | null): void {
  if (keys === null) return;
  if (keys.root !== undefined) zeroBytes(keys.root);
  if (keys.document !== undefined) zeroBytes(keys.document);
  if (keys.credential !== undefined) zeroBytes(keys.credential);
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  let difference = first.length ^ second.length;
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (first[index] ?? 0) ^ (second[index] ?? 0);
  }
  return difference === 0;
}

function wrapPurpose(keyKind: KeyKind): EnvelopePurpose {
  if (keyKind === "root") return "root-key-wrap";
  if (keyKind === "document") return "document-key-wrap";
  return "credential-key-wrap";
}

function wrapInfo(slotKind: "master-password" | "recovery-kit" | "webauthn-prf", keyKind: KeyKind) {
  return utf8ToBytes(`zk-wallet/v2/${slotKind}/${keyKind}-wrap`);
}

async function sealEnvelope(
  crypto: CryptoProvider,
  key: Uint8Array,
  plaintext: Uint8Array,
  purpose: EnvelopePurpose,
  contentSchemaVersion: 1 | 2,
  vaultId: string,
  subjectId: string,
): Promise<EncryptedEnvelope> {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  try {
    const template: EncryptedEnvelope = {
      algorithm: XCHACHA20_POLY1305_ALGORITHM,
      ciphertext: "",
      contentSchemaVersion,
      nonce: bytesToBase64Url(nonce),
      purpose,
      version: ENVELOPE_VERSION,
    };
    const ciphertext = await crypto.sealXChaCha20Poly1305(
      key,
      nonce,
      plaintext,
      aadFor(template, vaultId, subjectId),
    );
    return { ...template, ciphertext: bytesToBase64Url(ciphertext) };
  } finally {
    zeroBytes(nonce);
  }
}

async function openEnvelope(
  crypto: CryptoProvider,
  key: Uint8Array,
  envelope: EncryptedEnvelope,
  vaultId: string,
  subjectId: string,
): Promise<Uint8Array> {
  const nonce = base64UrlToBytes(envelope.nonce);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  try {
    return await crypto.openXChaCha20Poly1305(
      key,
      nonce,
      ciphertext,
      aadFor(envelope, vaultId, subjectId),
    );
  } finally {
    zeroBytes(nonce);
    zeroBytes(ciphertext);
  }
}

export function createVaultService(options: CreateVaultServiceOptions): VaultClient {
  const { crypto, repository } = options;
  const devicePrf = options.devicePrf ?? unavailableDevicePrf;
  const itemRepository = options.itemRepository;
  const now = options.now ?? defaultNow;
  const targetMilliseconds = options.calibration?.targetMilliseconds ?? DEFAULT_TARGET_MILLISECONDS;
  const maximumMemoryKiB = options.calibration?.maximumMemoryKiB ?? DEFAULT_MAXIMUM_MEMORY_KIB;
  const autoLockMilliseconds =
    options.session?.autoLockMilliseconds ?? DEFAULT_AUTO_LOCK_MILLISECONDS;
  const compartmentTtlMilliseconds =
    options.session?.compartmentTtlMilliseconds ?? DEFAULT_COMPARTMENT_TTL_MILLISECONDS;

  if (
    !Number.isFinite(targetMilliseconds) ||
    targetMilliseconds < 0 ||
    !Number.isSafeInteger(maximumMemoryKiB) ||
    maximumMemoryKiB < ARGON2ID_PRODUCTION_FLOOR.memoryKiB ||
    maximumMemoryKiB > DEFAULT_MAXIMUM_MEMORY_KIB ||
    !Number.isSafeInteger(autoLockMilliseconds) ||
    autoLockMilliseconds < MINIMUM_AUTO_LOCK_MILLISECONDS ||
    autoLockMilliseconds > MAXIMUM_AUTO_LOCK_MILLISECONDS ||
    !Number.isSafeInteger(compartmentTtlMilliseconds) ||
    compartmentTtlMilliseconds < MINIMUM_COMPARTMENT_TTL_MILLISECONDS ||
    compartmentTtlMilliseconds > MAXIMUM_COMPARTMENT_TTL_MILLISECONDS
  ) {
    throw new VaultError("KDF_POLICY_VIOLATION", "Vault security configuration is invalid");
  }

  let state: VaultPublicState = { status: "needs-setup" };
  let rootKey: Uint8Array | null = null;
  let documentKey: Uint8Array | null = null;
  let credentialKey: Uint8Array | null = null;
  let operationInProgress = false;
  let sessionGeneration = 0;
  let authenticatedRevision: number | null = null;
  let itemCount = 0;
  let syncConflicts: readonly {
    readonly itemId: string;
    readonly revisionIds: readonly string[];
  }[] = [];
  let deviceAvailable = false;
  let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  const compartmentTimers: Partial<Record<SensitiveCompartment, ReturnType<typeof setTimeout>>> =
    {};
  const listeners = new Set<(nextState: VaultPublicState) => void>();

  function snapshot(): VaultPublicState {
    if (state.status === "needs-setup") return { status: "needs-setup" };
    if (state.status === "locked") {
      return {
        deviceUnlock: {
          available: state.deviceUnlock.available,
          slots: state.deviceUnlock.slots.map((slot) => ({ ...slot })),
        },
        status: "locked",
        vaultId: state.vaultId,
      };
    }
    const recovery: RecoveryPublicState =
      state.recovery.status === "pending"
        ? { recoveryKit: state.recovery.recoveryKit, status: "pending" }
        : { status: state.recovery.status };
    return {
      deviceUnlock: {
        available: state.deviceUnlock.available,
        slots: state.deviceUnlock.slots.map((slot) => ({ ...slot })),
      },
      itemCount,
      recovery,
      status: "unlocked",
      syncConflicts: syncConflicts.map((conflict) => ({
        itemId: conflict.itemId,
        revisionIds: [...conflict.revisionIds],
      })),
      unlockedCompartments: [...state.unlockedCompartments],
      vaultId: state.vaultId,
    };
  }

  function publish(nextState: VaultPublicState): VaultPublicState {
    state = nextState;
    const next = snapshot();
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // A UI subscriber cannot affect the key lifecycle.
      }
    }
    return next;
  }

  function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    const candidate = timer as unknown as { unref?: () => void };
    candidate.unref?.();
  }

  function clearAutoLockTimer(): void {
    if (autoLockTimer !== null) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
  }

  function clearCompartment(compartment: SensitiveCompartment): void {
    const timer = compartmentTimers[compartment];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete compartmentTimers[compartment];
    }
    if (compartment === "document" && documentKey !== null) {
      zeroBytes(documentKey);
      documentKey = null;
    }
    if (compartment === "credential" && credentialKey !== null) {
      zeroBytes(credentialKey);
      credentialKey = null;
    }
  }

  function clearSessionKeys(): void {
    clearAutoLockTimer();
    clearCompartment("document");
    clearCompartment("credential");
    authenticatedRevision = null;
    if (rootKey !== null) {
      zeroBytes(rootKey);
      rootKey = null;
    }
  }

  function deviceSummary(header: VaultHeader): DeviceUnlockSummary {
    const currentScope = devicePrf.getScope?.() ?? null;
    const slots =
      header.version === 2
        ? header.deviceSlots
            .filter(
              (slot): slot is ActiveDeviceSlot =>
                slot.status === "active" &&
                (currentScope === null || (slot.version === 2 && slot.scope === currentScope)),
            )
            .map((slot) => ({ id: slot.id }))
        : [];
    return { available: deviceAvailable, slots };
  }

  function recoveryState(verified: boolean, recoveryKit?: string): RecoveryPublicState {
    if (verified) return { status: "verified" };
    if (recoveryKit !== undefined) return { recoveryKit, status: "pending" };
    return { status: "replacement-required" };
  }

  function openCompartments(): SensitiveCompartment[] {
    const compartments: SensitiveCompartment[] = [];
    if (documentKey !== null) compartments.push("document");
    if (credentialKey !== null) compartments.push("credential");
    return compartments;
  }

  function unlockedState(
    header: VaultHeaderV2,
    verified: boolean,
    recoveryKit?: string,
  ): VaultPublicState {
    authenticatedRevision = header.revision;
    return {
      deviceUnlock: deviceSummary(header),
      itemCount,
      recovery: recoveryState(verified, recoveryKit),
      status: "unlocked",
      syncConflicts: syncConflicts.map((conflict) => ({
        itemId: conflict.itemId,
        revisionIds: [...conflict.revisionIds],
      })),
      unlockedCompartments: openCompartments(),
      vaultId: header.vaultId,
    };
  }

  function startAutoLockTimer(): void {
    clearAutoLockTimer();
    if (state.status !== "unlocked") return;
    autoLockTimer = setTimeout(() => {
      autoLockTimer = null;
      lockInternal();
    }, autoLockMilliseconds);
    unrefTimer(autoLockTimer);
  }

  function startCompartmentTimer(compartment: SensitiveCompartment): void {
    const existing = compartmentTimers[compartment];
    if (existing !== undefined) clearTimeout(existing);
    const generation = sessionGeneration;
    const timer = setTimeout(() => {
      delete compartmentTimers[compartment];
      if (generation !== sessionGeneration || state.status !== "unlocked") return;
      if (compartment === "document" && documentKey !== null) {
        zeroBytes(documentKey);
        documentKey = null;
      }
      if (compartment === "credential" && credentialKey !== null) {
        zeroBytes(credentialKey);
        credentialKey = null;
      }
      publish({ ...state, unlockedCompartments: openCompartments() });
    }, compartmentTtlMilliseconds);
    compartmentTimers[compartment] = timer;
    unrefTimer(timer);
  }

  function installRootSession(
    key: Uint8Array,
    header: VaultHeaderV2,
    verified: boolean,
    recoveryKit: string | undefined,
    operationGeneration: number,
  ): VaultPublicState {
    if (operationGeneration !== sessionGeneration) {
      zeroBytes(key);
      return publish({
        deviceUnlock: deviceSummary(header),
        status: "locked",
        vaultId: header.vaultId,
      });
    }
    clearSessionKeys();
    rootKey = key;
    const next = publish(unlockedState(header, verified, recoveryKit));
    startAutoLockTimer();
    return next;
  }

  function lockInternal(): VaultPublicState {
    sessionGeneration += 1;
    clearSessionKeys();
    if (state.status === "unlocked") {
      return publish({
        deviceUnlock: state.deviceUnlock,
        status: "locked",
        vaultId: state.vaultId,
      });
    }
    return snapshot();
  }

  async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (operationInProgress) {
      throw new VaultError("OPERATION_IN_PROGRESS", "A vault operation is already running");
    }
    operationInProgress = true;
    try {
      return await operation();
    } finally {
      operationInProgress = false;
    }
  }

  async function refreshCapability(): Promise<void> {
    try {
      deviceAvailable = (await devicePrf.getCapability()) === "supported";
    } catch {
      deviceAvailable = false;
    }
  }

  async function calibrateAndDerive(
    password: Uint8Array,
    salt: Uint8Array,
  ): Promise<{ readonly key: Uint8Array; readonly parameters: Argon2idParameters }> {
    const candidates: number[] = MEMORY_CANDIDATES_KIB.filter(
      (memoryKiB) => memoryKiB <= maximumMemoryKiB,
    );
    if (!candidates.includes(ARGON2ID_PRODUCTION_FLOOR.memoryKiB)) {
      candidates.unshift(ARGON2ID_PRODUCTION_FLOOR.memoryKiB);
    }
    let lastKey: Uint8Array | null = null;
    try {
      for (const memoryKiB of candidates) {
        const parameters: Argon2idParameters = {
          algorithm: ARGON2ID_ALGORITHM,
          memoryKiB,
          operations: ARGON2ID_PRODUCTION_FLOOR.operations,
          outputLength: 32,
          parallelism: 1,
        };
        const startedAt = now();
        const key = await crypto.deriveArgon2id(password, salt, parameters);
        if (lastKey !== null) zeroBytes(lastKey);
        lastKey = key;
        if (
          Math.max(0, now() - startedAt) >= targetMilliseconds ||
          memoryKiB === candidates.at(-1)
        ) {
          lastKey = null;
          return { key, parameters };
        }
      }
      throw new VaultError("KDF_POLICY_VIOLATION", "No acceptable KDF profile is available");
    } finally {
      if (lastKey !== null) zeroBytes(lastKey);
    }
  }

  async function derivePersistedPasswordBase(
    masterPassword: string,
    slot: MasterPasswordSlotV2 | VaultHeaderV1["masterPasswordSlot"],
  ): Promise<Uint8Array> {
    const password = passwordBytes(masterPassword);
    const salt = base64UrlToBytes(slot.kdf.salt);
    try {
      return await crypto.deriveArgon2id(password, salt, slot.kdf);
    } finally {
      zeroBytes(password);
      zeroBytes(salt);
    }
  }

  async function deriveWrapKey(
    baseKey: Uint8Array,
    vaultIdBytes: Uint8Array,
    slotKind: "master-password" | "recovery-kit" | "webauthn-prf",
    keyKind: KeyKind,
  ): Promise<Uint8Array> {
    return crypto.hkdfSha256(baseKey, vaultIdBytes, wrapInfo(slotKind, keyKind), KEY_BYTES);
  }

  async function sealWrappedKeys(
    baseKey: Uint8Array,
    slotKind: "master-password" | "recovery-kit" | "webauthn-prf",
    keys: KeySetBytes,
    vaultId: string,
    vaultIdBytes: Uint8Array,
    slotId: string,
  ): Promise<WrappedKeySetV1> {
    const result = {} as Record<KeyKind, EncryptedEnvelope>;
    for (const keyKind of ["root", "document", "credential"] as const) {
      const wrappingKey = await deriveWrapKey(baseKey, vaultIdBytes, slotKind, keyKind);
      try {
        result[keyKind] = await sealEnvelope(
          crypto,
          wrappingKey,
          keys[keyKind],
          wrapPurpose(keyKind),
          EMPTY_VAULT_SCHEMA_VERSION,
          vaultId,
          slotId,
        );
      } finally {
        zeroBytes(wrappingKey);
      }
    }
    return {
      credential: result.credential,
      document: result.document,
      root: result.root,
    };
  }

  async function openWrappedKey(
    baseKey: Uint8Array,
    slotKind: "master-password" | "recovery-kit" | "webauthn-prf",
    wrappedKeys: WrappedKeySetV1,
    keyKind: KeyKind,
    vaultId: string,
    vaultIdBytes: Uint8Array,
    slotId: string,
  ): Promise<Uint8Array> {
    const wrappingKey = await deriveWrapKey(baseKey, vaultIdBytes, slotKind, keyKind);
    try {
      const opened = await openEnvelope(crypto, wrappingKey, wrappedKeys[keyKind], vaultId, slotId);
      if (opened.length !== KEY_BYTES) {
        zeroBytes(opened);
        throw invalidUnlock();
      }
      return opened;
    } finally {
      zeroBytes(wrappingKey);
    }
  }

  async function openAllWrappedKeys(
    baseKey: Uint8Array,
    slotKind: "master-password" | "recovery-kit" | "webauthn-prf",
    wrappedKeys: WrappedKeySetV1,
    vaultId: string,
    vaultIdBytes: Uint8Array,
    slotId: string,
  ): Promise<KeySetBytes> {
    const opened: Partial<KeySetBytes> = {};
    try {
      for (const keyKind of ["root", "document", "credential"] as const) {
        opened[keyKind] = await openWrappedKey(
          baseKey,
          slotKind,
          wrappedKeys,
          keyKind,
          vaultId,
          vaultIdBytes,
          slotId,
        );
      }
      return opened as KeySetBytes;
    } catch (error) {
      wipeKeySet(opened);
      throw error;
    }
  }

  async function sealPayload(
    root: Uint8Array,
    vaultId: string,
    vaultIdBytes: Uint8Array,
    recoveryKitVerified: boolean,
  ): Promise<EncryptedEnvelope> {
    const payloadKey = await crypto.hkdfSha256(root, vaultIdBytes, V2_PAYLOAD_INFO, KEY_BYTES);
    const plaintext = utf8ToBytes(JSON.stringify(task3Payload(recoveryKitVerified)));
    try {
      return await sealEnvelope(
        crypto,
        payloadKey,
        plaintext,
        "vault-payload",
        TASK3_VAULT_SCHEMA_VERSION,
        vaultId,
        PAYLOAD_SUBJECT_ID,
      );
    } finally {
      zeroBytes(payloadKey);
      zeroBytes(plaintext);
    }
  }

  async function openPayloadV2(
    header: VaultHeaderV2,
    root: Uint8Array,
  ): Promise<Task3VaultPayloadV2> {
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    const payloadKey = await crypto.hkdfSha256(root, vaultIdBytes, V2_PAYLOAD_INFO, KEY_BYTES);
    let plaintext: Uint8Array | null = null;
    try {
      plaintext = await openEnvelope(
        crypto,
        payloadKey,
        header.encryptedPayload,
        header.vaultId,
        PAYLOAD_SUBJECT_ID,
      );
      return parsePayloadV2(plaintext);
    } finally {
      zeroBytes(vaultIdBytes);
      zeroBytes(payloadKey);
      if (plaintext !== null) zeroBytes(plaintext);
    }
  }

  async function createMasterSlot(
    masterPassword: string,
    keys: KeySetBytes,
    vaultId: string,
    vaultIdBytes: Uint8Array,
  ): Promise<MasterPasswordSlotV2> {
    const password = passwordBytes(masterPassword);
    const salt = crypto.randomBytes(SALT_BYTES);
    let baseKey: Uint8Array | null = null;
    try {
      const derived = await calibrateAndDerive(password, salt);
      baseKey = derived.key;
      const id = bytesToBase64Url(crypto.randomBytes(OPAQUE_ID_BYTES));
      return {
        id,
        kdf: { ...derived.parameters, salt: bytesToBase64Url(salt) },
        type: "master-password",
        version: 2,
        wrappedKeys: await sealWrappedKeys(
          baseKey,
          "master-password",
          keys,
          vaultId,
          vaultIdBytes,
          id,
        ),
      };
    } finally {
      zeroBytes(password);
      zeroBytes(salt);
      if (baseKey !== null) zeroBytes(baseKey);
    }
  }

  async function createMasterSlotFromBase(
    baseKey: Uint8Array,
    kdf: PasswordKdfV1,
    keys: KeySetBytes,
    vaultId: string,
    vaultIdBytes: Uint8Array,
  ): Promise<MasterPasswordSlotV2> {
    const id = bytesToBase64Url(crypto.randomBytes(OPAQUE_ID_BYTES));
    return {
      id,
      kdf,
      type: "master-password",
      version: 2,
      wrappedKeys: await sealWrappedKeys(
        baseKey,
        "master-password",
        keys,
        vaultId,
        vaultIdBytes,
        id,
      ),
    };
  }

  async function createRecoverySlot(
    recoverySecret: Uint8Array,
    keys: KeySetBytes,
    vaultId: string,
    vaultIdBytes: Uint8Array,
  ): Promise<RecoveryKitSlotV1> {
    const id = bytesToBase64Url(crypto.randomBytes(OPAQUE_ID_BYTES));
    return {
      id,
      type: "recovery-kit",
      version: 1,
      wrappedKeys: await sealWrappedKeys(
        recoverySecret,
        "recovery-kit",
        keys,
        vaultId,
        vaultIdBytes,
        id,
      ),
    };
  }

  function headerAuthenticationBytes(
    header: Omit<VaultHeaderV2, "securityTag"> | VaultHeaderV2,
  ): Uint8Array {
    return utf8ToBytes(
      JSON.stringify({
        deviceSlots: header.deviceSlots,
        encryptedPayload: header.encryptedPayload,
        format: header.format,
        masterPasswordSlot: header.masterPasswordSlot,
        minimumClientVersion: header.minimumClientVersion,
        recoverySlot: header.recoverySlot,
        revision: header.revision,
        vaultId: header.vaultId,
        version: header.version,
      }),
    );
  }

  async function createHeaderSecurityTag(
    header: Omit<VaultHeaderV2, "securityTag"> | VaultHeaderV2,
    authenticationRoot: Uint8Array,
  ): Promise<Uint8Array> {
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    const authenticationData = headerAuthenticationBytes(header);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const emptyPlaintext = new Uint8Array(0);
    let authenticationKey: Uint8Array | null = null;
    let ciphertext: Uint8Array | null = null;
    try {
      if (nonce.length !== NONCE_BYTES) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Header authentication nonce is invalid");
      }
      authenticationKey = await crypto.hkdfSha256(
        authenticationRoot,
        vaultIdBytes,
        V2_HEADER_AUTH_INFO,
        KEY_BYTES,
      );
      ciphertext = await crypto.sealXChaCha20Poly1305(
        authenticationKey,
        nonce,
        emptyPlaintext,
        authenticationData,
      );
      if (ciphertext.length !== 16) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Header authentication tag is invalid");
      }
      const result = new Uint8Array(NONCE_BYTES + ciphertext.length);
      result.set(nonce);
      result.set(ciphertext, NONCE_BYTES);
      return result;
    } finally {
      zeroBytes(vaultIdBytes);
      zeroBytes(authenticationData);
      zeroBytes(nonce);
      zeroBytes(emptyPlaintext);
      if (authenticationKey !== null) zeroBytes(authenticationKey);
      if (ciphertext !== null) zeroBytes(ciphertext);
    }
  }

  async function authenticateGeneratedHeader(
    header: Omit<VaultHeaderV2, "securityTag"> | VaultHeaderV2,
    authenticationRoot: Uint8Array,
  ): Promise<VaultHeaderV2> {
    const securityTag = await createHeaderSecurityTag(header, authenticationRoot);
    try {
      return validateGeneratedV2Header({
        ...header,
        securityTag: bytesToBase64Url(securityTag),
      });
    } finally {
      zeroBytes(securityTag);
    }
  }

  async function verifyHeaderSecurityTag(
    header: VaultHeaderV2,
    authenticationRoot: Uint8Array,
  ): Promise<boolean> {
    const persistedTag = base64UrlToBytes(header.securityTag);
    const nonce = persistedTag.slice(0, NONCE_BYTES);
    const ciphertext = persistedTag.slice(NONCE_BYTES);
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    const authenticationData = headerAuthenticationBytes(header);
    let authenticationKey: Uint8Array | null = null;
    let plaintext: Uint8Array | null = null;
    try {
      authenticationKey = await crypto.hkdfSha256(
        authenticationRoot,
        vaultIdBytes,
        V2_HEADER_AUTH_INFO,
        KEY_BYTES,
      );
      plaintext = await crypto.openXChaCha20Poly1305(
        authenticationKey,
        nonce,
        ciphertext,
        authenticationData,
      );
      return plaintext.length === 0;
    } catch (error) {
      if (isCryptoUnavailable(error)) throw error;
      return false;
    } finally {
      zeroBytes(persistedTag);
      zeroBytes(nonce);
      zeroBytes(ciphertext);
      zeroBytes(vaultIdBytes);
      zeroBytes(authenticationData);
      if (authenticationKey !== null) zeroBytes(authenticationKey);
      if (plaintext !== null) zeroBytes(plaintext);
    }
  }

  function conditionFor(header: VaultHeader) {
    return {
      revision: header.version === 2 ? header.revision : null,
      vaultId: header.vaultId,
      version: header.version,
    };
  }

  async function readHeader(): Promise<VaultHeader> {
    const stored = await repository.read();
    if (stored === null) throw new VaultError("VAULT_NOT_FOUND", "No local vault exists");
    return parseVaultHeader(stored);
  }

  async function persistReplacement(
    current: VaultHeader,
    next: Omit<VaultHeaderV2, "securityTag"> | VaultHeaderV2,
    authenticationRoot: Uint8Array,
  ): Promise<VaultHeaderV2> {
    const validated = await authenticateGeneratedHeader(next, authenticationRoot);
    try {
      await repository.replace(conditionFor(current), validated);
      return validated;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "VAULT_WRITE_CONFLICT"
      ) {
        lockInternal();
        try {
          const winner = await readHeader();
          await refreshCapability();
          publish({
            deviceUnlock: deviceSummary(winner),
            status: "locked",
            vaultId: winner.vaultId,
          });
        } catch {
          // The conflict remains authoritative even if the winner cannot be reloaded safely.
        }
        throw new VaultError("VAULT_WRITE_CONFLICT", "The encrypted vault changed concurrently");
      }
      throw error;
    }
  }

  async function openV1Root(header: VaultHeaderV1, masterPassword: string): Promise<Uint8Array> {
    const password = passwordBytes(masterPassword);
    const salt = base64UrlToBytes(header.masterPasswordSlot.kdf.salt);
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    let baseKey: Uint8Array | null = null;
    let wrappingKey: Uint8Array | null = null;
    let openedRoot: Uint8Array | null = null;
    let payloadKey: Uint8Array | null = null;
    let payloadPlaintext: Uint8Array | null = null;
    try {
      baseKey = await crypto.deriveArgon2id(password, salt, header.masterPasswordSlot.kdf);
      wrappingKey = await crypto.hkdfSha256(baseKey, vaultIdBytes, V1_ROOT_WRAP_INFO, KEY_BYTES);
      const wrapped = header.masterPasswordSlot.wrappedRootKey;
      openedRoot = await openEnvelope(
        crypto,
        wrappingKey,
        wrapped,
        header.vaultId,
        header.masterPasswordSlot.id,
      );
      if (openedRoot.length !== KEY_BYTES) throw invalidUnlock();
      payloadKey = await crypto.hkdfSha256(openedRoot, vaultIdBytes, V1_PAYLOAD_INFO, KEY_BYTES);
      payloadPlaintext = await openEnvelope(
        crypto,
        payloadKey,
        header.encryptedPayload,
        header.vaultId,
        PAYLOAD_SUBJECT_ID,
      );
      parsePayloadV1(payloadPlaintext);
      const result = openedRoot;
      openedRoot = null;
      return result;
    } catch {
      throw invalidUnlock();
    } finally {
      zeroBytes(password);
      zeroBytes(salt);
      zeroBytes(vaultIdBytes);
      if (baseKey !== null) zeroBytes(baseKey);
      if (wrappingKey !== null) zeroBytes(wrappingKey);
      if (openedRoot !== null) zeroBytes(openedRoot);
      if (payloadKey !== null) zeroBytes(payloadKey);
      if (payloadPlaintext !== null) zeroBytes(payloadPlaintext);
    }
  }

  async function migrateV1(
    header: VaultHeaderV1,
    masterPassword: string,
    openedRoot: Uint8Array,
  ): Promise<{ header: VaultHeaderV2; recoveryKit: string }> {
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    const password = passwordBytes(masterPassword);
    const salt = base64UrlToBytes(header.masterPasswordSlot.kdf.salt);
    const document = crypto.randomBytes(KEY_BYTES);
    const credential = crypto.randomBytes(KEY_BYTES);
    const recoverySecret = crypto.randomBytes(KEY_BYTES);
    let baseKey: Uint8Array | null = null;
    try {
      baseKey = await crypto.deriveArgon2id(password, salt, header.masterPasswordSlot.kdf);
      const keys: KeySetBytes = { credential, document, root: openedRoot };
      const masterPasswordSlot = await createMasterSlotFromBase(
        baseKey,
        header.masterPasswordSlot.kdf,
        keys,
        header.vaultId,
        vaultIdBytes,
      );
      const recoverySlot = await createRecoverySlot(
        recoverySecret,
        keys,
        header.vaultId,
        vaultIdBytes,
      );
      const migrated: Omit<VaultHeaderV2, "securityTag"> = {
        deviceSlots: [],
        encryptedPayload: await sealPayload(openedRoot, header.vaultId, vaultIdBytes, false),
        format: VAULT_HEADER_FORMAT,
        masterPasswordSlot,
        minimumClientVersion: VAULT_MINIMUM_CLIENT_VERSION,
        recoverySlot,
        revision: 1,
        vaultId: header.vaultId,
        version: VAULT_HEADER_VERSION,
      };
      const committed = await persistReplacement(header, migrated, openedRoot);
      return { header: committed, recoveryKit: encodeRecoveryKit(recoverySecret) };
    } finally {
      zeroBytes(vaultIdBytes);
      zeroBytes(password);
      zeroBytes(salt);
      zeroBytes(document);
      zeroBytes(credential);
      zeroBytes(recoverySecret);
      if (baseKey !== null) zeroBytes(baseKey);
    }
  }

  async function openMasterRoot(
    header: VaultHeaderV2,
    masterPassword: string,
  ): Promise<Uint8Array> {
    const baseKey = await derivePersistedPasswordBase(masterPassword, header.masterPasswordSlot);
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    try {
      return await openWrappedKey(
        baseKey,
        "master-password",
        header.masterPasswordSlot.wrappedKeys,
        "root",
        header.vaultId,
        vaultIdBytes,
        header.masterPasswordSlot.id,
      );
    } catch (error) {
      if (isCryptoUnavailable(error)) throw error;
      if (error instanceof VaultError && error.code === "KDF_POLICY_VIOLATION") throw error;
      throw invalidUnlock();
    } finally {
      zeroBytes(baseKey);
      zeroBytes(vaultIdBytes);
    }
  }

  async function openRecoveryRoot(header: VaultHeaderV2, recoveryKit: string): Promise<Uint8Array> {
    let secret: Uint8Array | null = null;
    const vaultIdBytes = base64UrlToBytes(header.vaultId);
    try {
      secret = decodeRecoveryKit(recoveryKit);
      return await openWrappedKey(
        secret,
        "recovery-kit",
        header.recoverySlot.wrappedKeys,
        "root",
        header.vaultId,
        vaultIdBytes,
        header.recoverySlot.id,
      );
    } catch (error) {
      if (isCryptoUnavailable(error)) throw error;
      throw invalidRecovery();
    } finally {
      if (secret !== null) zeroBytes(secret);
      zeroBytes(vaultIdBytes);
    }
  }

  function activeDeviceSlot(header: VaultHeaderV2, slotId: string): ActiveDeviceSlot {
    const slot = header.deviceSlots.find((candidate) => candidate.id === slotId);
    if (slot?.status === "revoked") {
      throw new VaultError("DEVICE_SLOT_REVOKED", "This device slot has been revoked");
    }
    if (slot === undefined) throw deviceUnlockFailed();
    const currentScope = devicePrf.getScope?.() ?? null;
    if (currentScope !== null && (slot.version !== 2 || slot.scope !== currentScope)) {
      throw deviceUnlockFailed("This biometric enrollment is not available to this app");
    }
    return slot;
  }

  async function evaluateDeviceSlot(slot: ActiveDeviceSlot): Promise<Uint8Array> {
    let prfInput: Uint8Array | null = null;
    try {
      prfInput = base64UrlToBytes(slot.prfInput);
      const output = await devicePrf.evaluate({
        credentialId: slot.credentialId,
        prfInput,
      });
      if (output.length !== KEY_BYTES) {
        zeroBytes(output);
        throw deviceUnlockFailed();
      }
      return output;
    } catch (error) {
      if (error instanceof VaultError && error.code === "DEVICE_UNLOCK_UNAVAILABLE") throw error;
      if (error instanceof DevicePrfError) throw deviceUnlockFailed(error.message);
      throw deviceUnlockFailed();
    } finally {
      if (prfInput !== null) zeroBytes(prfInput);
    }
  }

  async function unlockV2WithRoot(
    header: VaultHeaderV2,
    openedRoot: Uint8Array,
    operationGeneration: number,
  ): Promise<VaultPublicState> {
    try {
      if (!(await verifyHeaderSecurityTag(header, openedRoot))) throw invalidUnlock();
      const payload = await openPayloadV2(header, openedRoot);
      return installRootSession(
        openedRoot,
        header,
        payload.recoveryKitVerified,
        undefined,
        operationGeneration,
      );
    } catch (error) {
      zeroBytes(openedRoot);
      throw error;
    }
  }

  async function requireUnlockedHeader(): Promise<VaultHeaderV2> {
    if (state.status !== "unlocked" || rootKey === null || authenticatedRevision === null) {
      throw new VaultError("VAULT_LOCKED", "The vault is locked");
    }
    const activeRoot = rootKey;
    const activeRevision = authenticatedRevision;
    const header = await readHeader();
    if (
      header.version !== 2 ||
      header.vaultId !== state.vaultId ||
      header.revision < activeRevision
    ) {
      lockInternal();
      throw new VaultError("VAULT_WRITE_CONFLICT", "The encrypted vault changed concurrently");
    }
    let authenticated: boolean;
    try {
      authenticated = await verifyHeaderSecurityTag(header, activeRoot);
    } catch (error) {
      if (isCryptoUnavailable(error)) throw error;
      lockInternal();
      throw new VaultError("VAULT_WRITE_CONFLICT", "The encrypted vault changed concurrently");
    }
    if (!authenticated) {
      lockInternal();
      throw new VaultError("VAULT_WRITE_CONFLICT", "The encrypted vault changed concurrently");
    }
    if (state.status !== "unlocked" || rootKey !== activeRoot) {
      throw new VaultError("VAULT_LOCKED", "The vault is locked");
    }
    if (header.revision > activeRevision) {
      let payload: Task3VaultPayloadV2;
      try {
        payload = await openPayloadV2(header, activeRoot);
      } catch (error) {
        if (isCryptoUnavailable(error)) throw error;
        lockInternal();
        throw new VaultError("VAULT_WRITE_CONFLICT", "The encrypted vault changed concurrently");
      }
      if (state.status !== "unlocked" || rootKey !== activeRoot) {
        throw new VaultError("VAULT_LOCKED", "The vault is locked");
      }
      clearCompartment("document");
      clearCompartment("credential");
      publish(unlockedState(header, payload.recoveryKitVerified));
    }
    return header;
  }

  function requireItemRepository(): ItemRevisionRepository {
    if (itemRepository === undefined) {
      throw new ItemError("ITEM_CORRUPT", "Encrypted item persistence is unavailable");
    }
    return itemRepository;
  }

  async function loadItems(): Promise<VaultItem[]> {
    const header = await requireUnlockedHeader();
    if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
    const activeRoot = rootKey;
    const items: VaultItem[] = [];
    syncConflicts = (await itemRepository?.listConflicts?.()) ?? [];
    for (const stored of await requireItemRepository().listHeads()) {
      if (state.status !== "unlocked" || rootKey !== activeRoot) {
        throw new VaultError("VAULT_LOCKED", "The vault is locked");
      }
      const item = await openEncryptedItemRevision(crypto, activeRoot, header.vaultId, stored);
      if (item !== null) items.push(item);
    }
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (itemRepository?.writeSearchIndex !== undefined) {
      await itemRepository.writeSearchIndex(
        await encryptSearchIndex(crypto, activeRoot, header.vaultId, items),
      );
    }
    itemCount = items.length;
    if (state.status === "unlocked") publish({ ...state, itemCount });
    return items;
  }

  async function writeItem(
    request:
      | { readonly input: LoginItemInput; readonly type: "login" }
      | { readonly input: IdentityProfileItemInput; readonly type: "identity-profile" }
      | { readonly input: PaymentCardItemInput; readonly type: "payment-card" }
      | { readonly input: SecureNoteItemInput; readonly type: "secure-note" },
    itemId?: string,
    expectedRevisionId?: string,
  ): Promise<VaultItem> {
    const header = await requireUnlockedHeader();
    if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
    const activeRoot = rootKey;
    const current =
      itemId === undefined ? undefined : (await loadItems()).find((item) => item.id === itemId);
    if (
      itemId !== undefined &&
      (current === undefined ||
        current.revisionId !== expectedRevisionId ||
        current.type !== request.type)
    ) {
      throw new ItemError(
        current === undefined ? "ITEM_NOT_FOUND" : "ITEM_WRITE_CONFLICT",
        current === undefined ? "The item does not exist" : "The item changed concurrently",
      );
    }
    const revision = await createEncryptedItemRevision(
      crypto,
      activeRoot,
      header.vaultId,
      request,
      new Date(now()).toISOString(),
      current,
    );
    try {
      await requireItemRepository().commit(current?.revisionId ?? null, revision);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "VAULT_WRITE_CONFLICT"
      ) {
        throw new ItemError("ITEM_WRITE_CONFLICT", "The item changed concurrently");
      }
      throw error;
    }
    if (state.status !== "unlocked" || rootKey !== activeRoot) {
      throw new VaultError("VAULT_LOCKED", "The vault is locked");
    }
    const opened = await openEncryptedItemRevision(crypto, activeRoot, header.vaultId, revision);
    if (opened === null) throw new ItemError("ITEM_CORRUPT", "Encrypted item data is invalid");
    itemCount = (await loadItems()).length;
    startAutoLockTimer();
    return opened;
  }

  function itemRequest(
    item: VaultItem,
  ):
    | { readonly input: LoginItemInput; readonly type: "login" }
    | { readonly input: IdentityProfileItemInput; readonly type: "identity-profile" }
    | { readonly input: PaymentCardItemInput; readonly type: "payment-card" }
    | { readonly input: SecureNoteItemInput; readonly type: "secure-note" } {
    if (item.type === "login") {
      const {
        createdAt: _createdAt,
        id: _id,
        revisionId: _revisionId,
        type: _type,
        updatedAt: _updatedAt,
        ...input
      } = item;
      return { input, type: "login" };
    }
    if (item.type === "identity-profile") {
      const {
        createdAt: _createdAt,
        id: _id,
        revisionId: _revisionId,
        type: _type,
        updatedAt: _updatedAt,
        ...input
      } = item;
      return { input, type: "identity-profile" };
    }
    if (item.type === "payment-card") {
      const {
        createdAt: _createdAt,
        id: _id,
        revisionId: _revisionId,
        type: _type,
        updatedAt: _updatedAt,
        ...input
      } = item;
      return { input, type: "payment-card" };
    }
    const {
      createdAt: _createdAt,
      id: _id,
      revisionId: _revisionId,
      type: _type,
      updatedAt: _updatedAt,
      ...input
    } = item;
    return { input, type: "secure-note" };
  }

  async function itemHistory(itemId: string): Promise<VaultItemHistoryEntry[]> {
    const header = await requireUnlockedHeader();
    if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
    const activeRoot = rootKey;
    const repository = requireItemRepository();
    if (repository.listRevisions === undefined) {
      throw new ItemError("ITEM_CORRUPT", "Encrypted item history is unavailable");
    }
    const heads = (await repository.listHeads()).map(parseEncryptedItemRevision);
    const head = heads.find((revision) => revision.itemId === itemId);
    if (head === undefined) throw new ItemError("ITEM_NOT_FOUND", "The item does not exist");
    const revisions = (await repository.listRevisions())
      .map(parseEncryptedItemRevision)
      .filter((revision) => revision.itemId === itemId);
    const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
    const history: VaultItemHistoryEntry[] = [];
    let cursor: EncryptedItemRevisionV1 | undefined = head;
    while (cursor !== undefined) {
      if (state.status !== "unlocked" || rootKey !== activeRoot) {
        throw new VaultError("VAULT_LOCKED", "The vault is locked");
      }
      history.push({
        item: await openEncryptedItemRevision(crypto, activeRoot, header.vaultId, cursor),
        operation: cursor.operation,
        parentRevisionId: cursor.parentRevisionId,
        revisionId: cursor.revisionId,
      });
      cursor = cursor.parentRevisionId === null ? undefined : byId.get(cursor.parentRevisionId);
      if (cursor === undefined && history.at(-1)?.parentRevisionId !== null) {
        throw new ItemError("ITEM_CORRUPT", "Encrypted item history is incomplete");
      }
    }
    return history;
  }

  return {
    async changeMasterPassword(request: ChangeMasterPasswordRequest) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (
          state.status !== "unlocked" ||
          state.recovery.status !== "verified" ||
          rootKey === null
        ) {
          throw new VaultError(
            "RECOVERY_VERIFICATION_REQUIRED",
            "Verify the Recovery Kit before changing the password",
          );
        }
        const baseKey = await derivePersistedPasswordBase(
          request.currentPassword,
          header.masterPasswordSlot,
        ).catch(() => {
          throw invalidUnlock();
        });
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        let keys: KeySetBytes | null = null;
        try {
          keys = await openAllWrappedKeys(
            baseKey,
            "master-password",
            header.masterPasswordSlot.wrappedKeys,
            header.vaultId,
            vaultIdBytes,
            header.masterPasswordSlot.id,
          );
          if (!bytesEqual(keys.root, rootKey)) throw invalidUnlock();
          const masterPasswordSlot = await createMasterSlot(
            request.newPassword,
            keys,
            header.vaultId,
            vaultIdBytes,
          );
          const next: VaultHeaderV2 = {
            ...header,
            masterPasswordSlot,
            revision: header.revision + 1,
          };
          const committed = await persistReplacement(header, next, keys.root);
          if (operationGeneration !== sessionGeneration) return snapshot();
          startAutoLockTimer();
          return publish(unlockedState(committed, true));
        } catch (error) {
          if (error instanceof VaultError) throw error;
          throw invalidUnlock();
        } finally {
          zeroBytes(baseKey);
          zeroBytes(vaultIdBytes);
          wipeKeySet(keys);
        }
      });
    },

    async createIdentityProfile(input) {
      return exclusive(() => writeItem({ input, type: "identity-profile" }));
    },

    async createLogin(input) {
      return exclusive(() => writeItem({ input, type: "login" }));
    },

    async createPaymentCard(input) {
      return exclusive(() => writeItem({ input, type: "payment-card" }));
    },

    async createSecureNote(input) {
      return exclusive(() => writeItem({ input, type: "secure-note" }));
    },

    async createVault(masterPassword) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const existingRecord = await repository.read();
        if (existingRecord !== null) {
          const existingHeader = parseVaultHeader(existingRecord);
          await refreshCapability();
          publish({
            deviceUnlock: deviceSummary(existingHeader),
            status: "locked",
            vaultId: existingHeader.vaultId,
          });
          throw new VaultError("VAULT_ALREADY_EXISTS", "A local vault already exists");
        }
        const vaultIdBytes = crypto.randomBytes(OPAQUE_ID_BYTES);
        const vaultId = bytesToBase64Url(vaultIdBytes);
        const keys: KeySetBytes = {
          credential: crypto.randomBytes(KEY_BYTES),
          document: crypto.randomBytes(KEY_BYTES),
          root: crypto.randomBytes(KEY_BYTES),
        };
        const recoverySecret = crypto.randomBytes(KEY_BYTES);
        try {
          const header = await authenticateGeneratedHeader(
            {
              deviceSlots: [],
              encryptedPayload: await sealPayload(keys.root, vaultId, vaultIdBytes, false),
              format: VAULT_HEADER_FORMAT,
              masterPasswordSlot: await createMasterSlot(
                masterPassword,
                keys,
                vaultId,
                vaultIdBytes,
              ),
              minimumClientVersion: VAULT_MINIMUM_CLIENT_VERSION,
              recoverySlot: await createRecoverySlot(recoverySecret, keys, vaultId, vaultIdBytes),
              revision: 1,
              vaultId,
              version: VAULT_HEADER_VERSION,
            },
            keys.root,
          );
          try {
            await repository.create(header);
          } catch (error) {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "VAULT_ALREADY_EXISTS"
            ) {
              const winningRecord = await repository.read();
              if (winningRecord !== null) {
                const winningHeader = parseVaultHeader(winningRecord);
                await refreshCapability();
                publish({
                  deviceUnlock: deviceSummary(winningHeader),
                  status: "locked",
                  vaultId: winningHeader.vaultId,
                });
              }
              throw new VaultError("VAULT_ALREADY_EXISTS", "A local vault already exists");
            }
            throw error;
          }
          await refreshCapability();
          const recoveryKit = encodeRecoveryKit(recoverySecret);
          const sessionRoot = keys.root;
          keys.root = new Uint8Array(0);
          return installRootSession(sessionRoot, header, false, recoveryKit, operationGeneration);
        } finally {
          zeroBytes(vaultIdBytes);
          wipeKeySet(keys);
          zeroBytes(recoverySecret);
        }
      });
    },

    async deleteItem(itemId, expectedRevisionId) {
      return exclusive(async () => {
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        const current = (await loadItems()).find((item) => item.id === itemId);
        if (current === undefined) throw new ItemError("ITEM_NOT_FOUND", "The item does not exist");
        if (current.revisionId !== expectedRevisionId) {
          throw new ItemError("ITEM_WRITE_CONFLICT", "The item changed concurrently");
        }
        const revision = await createEncryptedTombstone(
          crypto,
          activeRoot,
          header.vaultId,
          current,
          new Date(now()).toISOString(),
        );
        try {
          await requireItemRepository().commit(expectedRevisionId, revision);
        } catch {
          throw new ItemError("ITEM_WRITE_CONFLICT", "The item changed concurrently");
        }
        if (state.status !== "unlocked" || rootKey !== activeRoot) {
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        itemCount = (await loadItems()).length;
        startAutoLockTimer();
      });
    },

    async createItemShare(itemId, expiresAt) {
      return exclusive(async () => {
        await requireUnlockedHeader();
        const item = (await loadItems()).find((candidate) => candidate.id === itemId);
        if (item === undefined) {
          throw new ItemError("ITEM_NOT_FOUND", "The item does not exist");
        }
        const share = await createEncryptedItemShare(
          crypto,
          item,
          expiresAt,
          new Date(now()).toISOString(),
        );
        startAutoLockTimer();
        return share;
      });
    },

    async listItemHistory(itemId) {
      return exclusive(() => itemHistory(itemId));
    },

    async enrollDevice(masterPassword) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (
          state.status !== "unlocked" ||
          state.recovery.status !== "verified" ||
          rootKey === null
        ) {
          throw new VaultError(
            "RECOVERY_VERIFICATION_REQUIRED",
            "Verify the Recovery Kit before enrolling a device",
          );
        }
        if (header.deviceSlots.length >= MAXIMUM_DEVICE_SLOTS) {
          throw new VaultError("DEVICE_UNLOCK_FAILED", "No additional device slot is available");
        }
        const baseKey = await derivePersistedPasswordBase(
          masterPassword,
          header.masterPasswordSlot,
        ).catch(() => {
          throw invalidUnlock();
        });
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        const prfInput = crypto.randomBytes(PRF_INPUT_BYTES);
        let keys: KeySetBytes | null = null;
        let prfOutput: Uint8Array | null = null;
        try {
          keys = await openAllWrappedKeys(
            baseKey,
            "master-password",
            header.masterPasswordSlot.wrappedKeys,
            header.vaultId,
            vaultIdBytes,
            header.masterPasswordSlot.id,
          );
          if (!bytesEqual(keys.root, rootKey)) throw invalidUnlock();
          const enrolled = await devicePrf.enroll({ prfInput, userId: vaultIdBytes });
          prfOutput = enrolled.prfOutput;
          const credentialId = validateCredentialId(enrolled.credentialId);
          if (
            prfOutput.length !== KEY_BYTES ||
            header.deviceSlots.some(
              (slot) => slot.status === "active" && slot.credentialId === credentialId,
            )
          ) {
            throw deviceUnlockFailed();
          }
          const id = bytesToBase64Url(crypto.randomBytes(OPAQUE_ID_BYTES));
          const wrappedKeys = await sealWrappedKeys(
            prfOutput,
            "webauthn-prf",
            keys,
            header.vaultId,
            vaultIdBytes,
            id,
          );
          const scope = devicePrf.getScope?.() ?? null;
          const slot: ActiveDeviceSlot =
            scope === null
              ? {
                  credentialId,
                  id,
                  prfInput: bytesToBase64Url(prfInput),
                  status: "active",
                  type: "webauthn-prf",
                  version: 1,
                  wrappedKeys,
                }
              : ({
                  credentialId,
                  id,
                  prfInput: bytesToBase64Url(prfInput),
                  scope,
                  status: "active",
                  type: "webauthn-prf",
                  version: 2,
                  wrappedKeys,
                } satisfies ActiveDeviceSlotV2);
          const next: VaultHeaderV2 = {
            ...header,
            deviceSlots: [...header.deviceSlots, slot],
            revision: header.revision + 1,
          };
          const committed = await persistReplacement(header, next, keys.root);
          if (operationGeneration !== sessionGeneration) return snapshot();
          startAutoLockTimer();
          return publish(unlockedState(committed, true));
        } catch (error) {
          if (error instanceof VaultError) throw error;
          if (error instanceof DevicePrfError && error.reason === "unsupported") {
            throw new VaultError("DEVICE_UNLOCK_UNAVAILABLE", error.message);
          }
          if (error instanceof DevicePrfError) throw deviceUnlockFailed(error.message);
          throw deviceUnlockFailed();
        } finally {
          zeroBytes(baseKey);
          zeroBytes(vaultIdBytes);
          zeroBytes(prfInput);
          if (prfOutput !== null) zeroBytes(prfOutput);
          wipeKeySet(keys);
        }
      });
    },

    exportSessionMaterial() {
      if (state.status !== "unlocked" || rootKey === null) {
        throw new VaultError("VAULT_LOCKED", "The vault is locked");
      }
      return {
        expiresAt: Date.now() + autoLockMilliseconds,
        rootKey: rootKey.slice(),
        vaultId: state.vaultId,
        version: 1,
      };
    },

    async exportEncryptedArchive() {
      return exclusive(async () => {
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        if (itemRepository?.listRevisions === undefined) {
          throw new VaultError("INVALID_VAULT_HEADER", "Encrypted archive export is unavailable");
        }
        const revisions = (await itemRepository.listRevisions()).map(parseEncryptedItemRevision);
        const heads = (await itemRepository.listHeads()).map(parseEncryptedItemRevision);
        const archive = await createEncryptedVaultArchive(crypto, rootKey, header, {
          headRevisionIds: heads.map((revision) => revision.revisionId),
          revisions,
          version: 1,
        });
        startAutoLockTimer();
        return archive;
      });
    },

    getState() {
      return snapshot();
    },

    async initialize() {
      return exclusive(async () => {
        sessionGeneration += 1;
        clearSessionKeys();
        const stored = await repository.read();
        if (stored === null) return publish({ status: "needs-setup" });
        const header = parseVaultHeader(stored);
        await refreshCapability();
        return publish({
          deviceUnlock: deviceSummary(header),
          status: "locked",
          vaultId: header.vaultId,
        });
      });
    },

    async importItems(requests) {
      return exclusive(async () => {
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        const itemStore = requireItemRepository();
        if (itemStore.commitBatch === undefined) {
          throw new ItemError("ITEM_WRITE_CONFLICT", "Atomic import is unavailable");
        }
        if (requests.length === 0 || requests.length > 10_000) {
          throw new ItemError("INVALID_ITEM", "Import item count is invalid");
        }
        const timestamp = new Date(now()).toISOString();
        const revisions: EncryptedItemRevisionV1[] = [];
        for (const request of requests) {
          revisions.push(
            await createEncryptedItemRevision(
              crypto,
              activeRoot,
              header.vaultId,
              request,
              timestamp,
            ),
          );
        }
        await itemStore.commitBatch(revisions);
        if (state.status !== "unlocked" || rootKey !== activeRoot) {
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        const imported: VaultItem[] = [];
        for (const revision of revisions) {
          const item = await openEncryptedItemRevision(
            crypto,
            activeRoot,
            header.vaultId,
            revision,
          );
          if (item === null) throw new ItemError("ITEM_CORRUPT", "Imported item is invalid");
          imported.push(item);
        }
        itemCount = (await loadItems()).length;
        startAutoLockTimer();
        return imported;
      });
    },

    async listItems() {
      return exclusive(async () => {
        const items = await loadItems();
        startAutoLockTimer();
        return items;
      });
    },

    async searchItems(query) {
      return exclusive(async () => {
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        let encryptedIndex = await itemRepository?.readSearchIndex?.();
        if (encryptedIndex === null || encryptedIndex === undefined) {
          await loadItems();
          encryptedIndex = await itemRepository?.readSearchIndex?.();
        }
        if (encryptedIndex === null || encryptedIndex === undefined) return [];
        const matches = new Set(
          await searchEncryptedIndex(crypto, activeRoot, header.vaultId, encryptedIndex, query),
        );
        return (await loadItems()).filter((item) => matches.has(item.id));
      });
    },

    lock() {
      return lockInternal();
    },

    recordActivity() {
      if (state.status === "unlocked") startAutoLockTimer();
    },

    async replaceRecoveryKit(masterPassword) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const baseKey = await derivePersistedPasswordBase(
          masterPassword,
          header.masterPasswordSlot,
        ).catch(() => {
          throw invalidUnlock();
        });
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        const recoverySecret = crypto.randomBytes(KEY_BYTES);
        let keys: KeySetBytes | null = null;
        try {
          keys = await openAllWrappedKeys(
            baseKey,
            "master-password",
            header.masterPasswordSlot.wrappedKeys,
            header.vaultId,
            vaultIdBytes,
            header.masterPasswordSlot.id,
          );
          if (!bytesEqual(keys.root, rootKey)) throw invalidUnlock();
          const next: VaultHeaderV2 = {
            ...header,
            encryptedPayload: await sealPayload(keys.root, header.vaultId, vaultIdBytes, false),
            recoverySlot: await createRecoverySlot(
              recoverySecret,
              keys,
              header.vaultId,
              vaultIdBytes,
            ),
            revision: header.revision + 1,
          };
          const committed = await persistReplacement(header, next, keys.root);
          if (operationGeneration !== sessionGeneration) return snapshot();
          const recoveryKit = encodeRecoveryKit(recoverySecret);
          startAutoLockTimer();
          return publish(unlockedState(committed, false, recoveryKit));
        } finally {
          zeroBytes(baseKey);
          zeroBytes(vaultIdBytes);
          zeroBytes(recoverySecret);
          wipeKeySet(keys);
        }
      });
    },

    async resumeSession(material) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        clearSessionKeys();
        if (
          material.version !== 1 ||
          material.rootKey.length !== KEY_BYTES ||
          !Number.isSafeInteger(material.expiresAt) ||
          material.expiresAt <= Date.now()
        ) {
          zeroBytes(material.rootKey);
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        const header = await readHeader();
        await refreshCapability();
        publish({
          deviceUnlock: deviceSummary(header),
          status: "locked",
          vaultId: header.vaultId,
        });
        if (header.version !== 2 || header.vaultId !== material.vaultId) {
          zeroBytes(material.rootKey);
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        const openedRoot = material.rootKey.slice();
        zeroBytes(material.rootKey);
        return unlockV2WithRoot(header, openedRoot, operationGeneration);
      });
    },

    async restoreVault(request: RestoreVaultRequest) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        if ((await repository.read()) !== null) {
          throw new VaultError("VAULT_ALREADY_EXISTS", "A local vault already exists");
        }
        let source: VaultHeader;
        try {
          source = parseVaultHeader(request.encryptedVault);
        } catch (error) {
          if (
            error instanceof VaultError &&
            ["KDF_POLICY_VIOLATION", "UNSUPPORTED_VAULT_VERSION"].includes(error.code)
          ) {
            throw error;
          }
          throw invalidRecovery();
        }
        if (source.version !== 2) {
          throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Recovery requires a V2 vault");
        }
        let recoverySecret: Uint8Array | null = null;
        let keys: KeySetBytes | null = null;
        const vaultIdBytes = base64UrlToBytes(source.vaultId);
        try {
          try {
            recoverySecret = decodeRecoveryKit(request.recoveryKit);
            keys = await openAllWrappedKeys(
              recoverySecret,
              "recovery-kit",
              source.recoverySlot.wrappedKeys,
              source.vaultId,
              vaultIdBytes,
              source.recoverySlot.id,
            );
            if (!(await verifyHeaderSecurityTag(source, keys.root))) throw invalidRecovery();
            await openPayloadV2(source, keys.root);
          } catch (error) {
            if (isCryptoUnavailable(error)) throw error;
            throw invalidRecovery();
          }
          const next = await authenticateGeneratedHeader(
            {
              ...source,
              encryptedPayload: await sealPayload(keys.root, source.vaultId, vaultIdBytes, true),
              masterPasswordSlot: await createMasterSlot(
                request.newMasterPassword,
                keys,
                source.vaultId,
                vaultIdBytes,
              ),
              revision: source.revision + 1,
            },
            keys.root,
          );
          try {
            await repository.create(next);
          } catch (error) {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "VAULT_ALREADY_EXISTS"
            ) {
              throw new VaultError("VAULT_ALREADY_EXISTS", "A local vault already exists");
            }
            throw error;
          }
          await refreshCapability();
          const sessionRoot = keys.root;
          keys.root = new Uint8Array(0);
          return installRootSession(sessionRoot, next, true, undefined, operationGeneration);
        } finally {
          if (recoverySecret !== null) zeroBytes(recoverySecret);
          wipeKeySet(keys);
          zeroBytes(vaultIdBytes);
        }
      });
    },

    async restoreEncryptedArchive(request) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        if ((await repository.read()) !== null) {
          throw new VaultError("VAULT_ALREADY_EXISTS", "A local vault already exists");
        }
        if (repository.restoreArchive === undefined || itemRepository === undefined) {
          throw new VaultError("INVALID_VAULT_HEADER", "Encrypted archive restore is unavailable");
        }
        const outer =
          typeof request.archive === "object" &&
          request.archive !== null &&
          !Array.isArray(request.archive)
            ? (request.archive as Record<string, unknown>)
            : {};
        let source: VaultHeader;
        try {
          source = parseVaultHeader(outer.header);
        } catch {
          throw invalidRecovery();
        }
        if (source.version !== 2) {
          throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Recovery requires a V2 vault");
        }
        let recoverySecret: Uint8Array | null = null;
        let keys: KeySetBytes | null = null;
        const vaultIdBytes = base64UrlToBytes(source.vaultId);
        try {
          try {
            recoverySecret = decodeRecoveryKit(request.recoveryKit);
            keys = await openAllWrappedKeys(
              recoverySecret,
              "recovery-kit",
              source.recoverySlot.wrappedKeys,
              source.vaultId,
              vaultIdBytes,
              source.recoverySlot.id,
            );
            if (!(await verifyHeaderSecurityTag(source, keys.root))) throw invalidRecovery();
            await openPayloadV2(source, keys.root);
          } catch (error) {
            if (isCryptoUnavailable(error)) throw error;
            throw invalidRecovery();
          }
          const opened = await openEncryptedVaultArchive(crypto, keys.root, request.archive).catch(
            () => {
              throw invalidRecovery();
            },
          );
          for (const revision of opened.contents.revisions) {
            await openEncryptedItemRevision(crypto, keys.root, source.vaultId, revision).catch(
              () => {
                throw invalidRecovery();
              },
            );
          }
          const next = await authenticateGeneratedHeader(
            {
              ...source,
              encryptedPayload: await sealPayload(keys.root, source.vaultId, vaultIdBytes, true),
              masterPasswordSlot: await createMasterSlot(
                request.newMasterPassword,
                keys,
                source.vaultId,
                vaultIdBytes,
              ),
              revision: source.revision + 1,
            },
            keys.root,
          );
          await repository.restoreArchive(
            next,
            opened.contents.revisions,
            opened.contents.headRevisionIds,
          );
          await refreshCapability();
          const sessionRoot = keys.root;
          keys.root = new Uint8Array(0);
          return installRootSession(sessionRoot, next, true, undefined, operationGeneration);
        } finally {
          if (recoverySecret !== null) zeroBytes(recoverySecret);
          wipeKeySet(keys);
          zeroBytes(vaultIdBytes);
        }
      });
    },

    async revokeDevice(slotId) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        const index = header.deviceSlots.findIndex((slot) => slot.id === slotId);
        const current = header.deviceSlots[index];
        if (current === undefined) throw deviceUnlockFailed();
        if (current.status === "revoked") {
          throw new VaultError("DEVICE_SLOT_REVOKED", "This device slot has been revoked");
        }
        const replacement: DeviceSlotV1 = {
          id: current.id,
          status: "revoked",
          type: "webauthn-prf",
          version: 1,
        };
        const slots = [...header.deviceSlots];
        slots[index] = replacement;
        const next: VaultHeaderV2 = {
          ...header,
          deviceSlots: slots,
          revision: header.revision + 1,
        };
        const committed = await persistReplacement(header, next, activeRoot);
        if (operationGeneration !== sessionGeneration) return snapshot();
        startAutoLockTimer();
        const verified = state.status === "unlocked" && state.recovery.status === "verified";
        return publish(unlockedState(committed, verified));
      });
    },

    async stepUpCompartment(compartment: SensitiveCompartment, credential: StepUpCredential) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        let baseKey: Uint8Array | null = null;
        let authenticatedRoot: Uint8Array | null = null;
        let opened: Uint8Array | null = null;
        let slotKind: "master-password" | "recovery-kit" | "webauthn-prf";
        let wrappedKeys: WrappedKeySetV1;
        let slotId: string;
        try {
          if (credential.type === "master-password") {
            baseKey = await derivePersistedPasswordBase(
              credential.password,
              header.masterPasswordSlot,
            );
            slotKind = "master-password";
            wrappedKeys = header.masterPasswordSlot.wrappedKeys;
            slotId = header.masterPasswordSlot.id;
          } else if (credential.type === "recovery-kit") {
            baseKey = decodeRecoveryKit(credential.recoveryKit);
            slotKind = "recovery-kit";
            wrappedKeys = header.recoverySlot.wrappedKeys;
            slotId = header.recoverySlot.id;
          } else {
            const slot = activeDeviceSlot(header, credential.slotId);
            baseKey = await evaluateDeviceSlot(slot);
            slotKind = "webauthn-prf";
            wrappedKeys = slot.wrappedKeys;
            slotId = slot.id;
          }
          if (operationGeneration !== sessionGeneration || state.status !== "unlocked") {
            return snapshot();
          }
          authenticatedRoot = await openWrappedKey(
            baseKey,
            slotKind,
            wrappedKeys,
            "root",
            header.vaultId,
            vaultIdBytes,
            slotId,
          );
          if (operationGeneration !== sessionGeneration || state.status !== "unlocked") {
            return snapshot();
          }
          if (!bytesEqual(authenticatedRoot, activeRoot)) {
            throw new Error("Step-up slot is not bound to the active root session");
          }
          opened = await openWrappedKey(
            baseKey,
            slotKind,
            wrappedKeys,
            compartment,
            header.vaultId,
            vaultIdBytes,
            slotId,
          );
          if (operationGeneration !== sessionGeneration || state.status !== "unlocked") {
            zeroBytes(opened);
            opened = null;
            return snapshot();
          }
          clearCompartment(compartment);
          if (compartment === "document") documentKey = opened;
          else credentialKey = opened;
          opened = null;
          startCompartmentTimer(compartment);
          startAutoLockTimer();
          return publish({ ...state, unlockedCompartments: openCompartments() });
        } catch (error) {
          if (isCryptoUnavailable(error)) throw error;
          if (credential.type === "recovery-kit") throw invalidRecovery();
          if (credential.type === "device") {
            if (error instanceof VaultError && error.code === "DEVICE_SLOT_REVOKED") throw error;
            throw deviceUnlockFailed();
          }
          throw invalidUnlock();
        } finally {
          zeroBytes(vaultIdBytes);
          if (baseKey !== null) zeroBytes(baseKey);
          if (authenticatedRoot !== null) zeroBytes(authenticatedRoot);
          if (opened !== null) zeroBytes(opened);
        }
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async unlock(masterPassword) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        clearSessionKeys();
        let header: VaultHeader;
        try {
          header = await readHeader();
        } catch (error) {
          if (error instanceof VaultError && error.code === "INVALID_VAULT_HEADER") {
            throw invalidUnlock();
          }
          throw error;
        }
        await refreshCapability();
        publish({
          deviceUnlock: deviceSummary(header),
          status: "locked",
          vaultId: header.vaultId,
        });
        if (header.version === 1) {
          const openedRoot = await openV1Root(header, masterPassword);
          try {
            const migrated = await migrateV1(header, masterPassword, openedRoot);
            return installRootSession(
              openedRoot,
              migrated.header,
              false,
              migrated.recoveryKit,
              operationGeneration,
            );
          } catch (error) {
            zeroBytes(openedRoot);
            throw error;
          }
        }
        let openedRoot: Uint8Array | null = null;
        try {
          openedRoot = await openMasterRoot(header, masterPassword);
          const result = await unlockV2WithRoot(header, openedRoot, operationGeneration);
          openedRoot = null;
          return result;
        } catch (error) {
          if (openedRoot !== null) zeroBytes(openedRoot);
          if (isCryptoUnavailable(error)) throw error;
          if (
            error instanceof VaultError &&
            ["KDF_POLICY_VIOLATION", "UNSUPPORTED_VAULT_VERSION"].includes(error.code)
          ) {
            throw error;
          }
          throw invalidUnlock();
        }
      });
    },

    async unlockWithDevice(slotId) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        clearSessionKeys();
        const header = await readHeader();
        if (header.version !== 2) throw deviceUnlockFailed();
        await refreshCapability();
        publish({
          deviceUnlock: deviceSummary(header),
          status: "locked",
          vaultId: header.vaultId,
        });
        const slot = activeDeviceSlot(header, slotId);
        const prfOutput = await evaluateDeviceSlot(slot);
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        let openedRoot: Uint8Array | null = null;
        try {
          openedRoot = await openWrappedKey(
            prfOutput,
            "webauthn-prf",
            slot.wrappedKeys,
            "root",
            header.vaultId,
            vaultIdBytes,
            slot.id,
          );
          const result = await unlockV2WithRoot(header, openedRoot, operationGeneration);
          openedRoot = null;
          return result;
        } catch (error) {
          if (isCryptoUnavailable(error)) throw error;
          if (error instanceof VaultError && error.code === "DEVICE_SLOT_REVOKED") throw error;
          throw deviceUnlockFailed();
        } finally {
          zeroBytes(prfOutput);
          zeroBytes(vaultIdBytes);
          if (openedRoot !== null) zeroBytes(openedRoot);
        }
      });
    },

    async unlockWithRecoveryKit(recoveryKit) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        clearSessionKeys();
        const header = await readHeader();
        if (header.version !== 2) throw invalidRecovery();
        await refreshCapability();
        publish({
          deviceUnlock: deviceSummary(header),
          status: "locked",
          vaultId: header.vaultId,
        });
        let openedRoot: Uint8Array | null = null;
        try {
          openedRoot = await openRecoveryRoot(header, recoveryKit);
          const result = await unlockV2WithRoot(header, openedRoot, operationGeneration);
          openedRoot = null;
          return result;
        } catch (error) {
          if (isCryptoUnavailable(error)) throw error;
          throw invalidRecovery();
        } finally {
          if (openedRoot !== null) zeroBytes(openedRoot);
        }
      });
    },

    async restoreItemRevision(itemId, historicalRevisionId, expectedHeadRevisionId) {
      return exclusive(async () => {
        const header = await requireUnlockedHeader();
        if (rootKey === null) throw new VaultError("VAULT_LOCKED", "The vault is locked");
        const activeRoot = rootKey;
        const history = await itemHistory(itemId);
        if (history[0]?.revisionId !== expectedHeadRevisionId) {
          throw new ItemError("ITEM_WRITE_CONFLICT", "The item changed concurrently");
        }
        const historical = history.find((entry) => entry.revisionId === historicalRevisionId);
        if (historical?.item === null || historical === undefined) {
          throw new ItemError("ITEM_NOT_FOUND", "The historical item revision does not exist");
        }
        const previous = { ...historical.item, revisionId: expectedHeadRevisionId } as VaultItem;
        const revision = await createEncryptedItemRevision(
          crypto,
          activeRoot,
          header.vaultId,
          itemRequest(historical.item),
          new Date(now()).toISOString(),
          previous,
        );
        try {
          await requireItemRepository().commit(expectedHeadRevisionId, revision);
        } catch {
          throw new ItemError("ITEM_WRITE_CONFLICT", "The item changed concurrently");
        }
        if (state.status !== "unlocked" || rootKey !== activeRoot) {
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        const opened = await openEncryptedItemRevision(
          crypto,
          activeRoot,
          header.vaultId,
          revision,
        );
        if (opened === null) throw new ItemError("ITEM_CORRUPT", "Encrypted item data is invalid");
        itemCount = (await loadItems()).length;
        startAutoLockTimer();
        return opened;
      });
    },

    async updateIdentityProfile(itemId, expectedRevisionId, input) {
      return exclusive(() =>
        writeItem({ input, type: "identity-profile" }, itemId, expectedRevisionId),
      );
    },

    async updateLogin(itemId, expectedRevisionId, input) {
      return exclusive(() => writeItem({ input, type: "login" }, itemId, expectedRevisionId));
    },

    async updatePaymentCard(itemId, expectedRevisionId, input) {
      return exclusive(() =>
        writeItem({ input, type: "payment-card" }, itemId, expectedRevisionId),
      );
    },

    async updateSecureNote(itemId, expectedRevisionId, input) {
      return exclusive(() => writeItem({ input, type: "secure-note" }, itemId, expectedRevisionId));
    },

    async verifyRecoveryKit(recoveryKit) {
      return exclusive(async () => {
        const operationGeneration = sessionGeneration;
        const header = await requireUnlockedHeader();
        if (rootKey === null || state.status !== "unlocked") {
          throw new VaultError("VAULT_LOCKED", "The vault is locked");
        }
        const activeRoot = rootKey;
        let secret: Uint8Array | null = null;
        let keys: KeySetBytes | null = null;
        const vaultIdBytes = base64UrlToBytes(header.vaultId);
        try {
          try {
            secret = decodeRecoveryKit(recoveryKit);
            keys = await openAllWrappedKeys(
              secret,
              "recovery-kit",
              header.recoverySlot.wrappedKeys,
              header.vaultId,
              vaultIdBytes,
              header.recoverySlot.id,
            );
            if (!bytesEqual(keys.root, activeRoot)) throw invalidRecovery();
            await openPayloadV2(header, keys.root);
          } catch (error) {
            if (isCryptoUnavailable(error)) throw error;
            throw invalidRecovery();
          }
          const next: VaultHeaderV2 = {
            ...header,
            encryptedPayload: await sealPayload(keys.root, header.vaultId, vaultIdBytes, true),
            revision: header.revision + 1,
          };
          const committed = await persistReplacement(header, next, keys.root);
          if (operationGeneration !== sessionGeneration) return snapshot();
          startAutoLockTimer();
          return publish(unlockedState(committed, true));
        } finally {
          if (secret !== null) zeroBytes(secret);
          wipeKeySet(keys);
          zeroBytes(vaultIdBytes);
        }
      });
    },
  };
}
