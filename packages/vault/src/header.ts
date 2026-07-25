import {
  ARGON2ID_ALGORITHM,
  ARGON2ID_PRODUCTION_FLOOR,
  assertProductionKdfParameters,
  base64UrlToBytes,
  CryptoError,
  XCHACHA20_POLY1305_ALGORITHM,
} from "@zk-wallet/crypto";
import {
  type ActiveDeviceSlotV1,
  type DeviceSlotV1,
  EMPTY_VAULT_SCHEMA_VERSION,
  ENVELOPE_VERSION,
  type EncryptedEnvelope,
  type EncryptedEnvelopeV1,
  type EnvelopePurpose,
  type MasterPasswordSlotV1,
  type MasterPasswordSlotV2,
  type PasswordKdfV1,
  type RecoveryKitSlotV1,
  TASK3_VAULT_SCHEMA_VERSION,
  VAULT_HEADER_FORMAT,
  VAULT_HEADER_VERSION,
  VAULT_HEADER_VERSION_V1,
  VAULT_MINIMUM_CLIENT_VERSION,
  VAULT_MINIMUM_CLIENT_VERSION_V1,
  VaultError,
  type VaultHeader,
  type VaultHeaderV1,
  type VaultHeaderV2,
  type WrappedKeySetV1,
} from "./types";

const MAXIMUM_V1_KDF_MEMORY_KIB = 65_536;
const ROOT_KEY_CIPHERTEXT_BYTES = 48;
const EMPTY_PAYLOAD_CIPHERTEXT_BYTES = 79;
const MAXIMUM_DEVICE_SLOTS = 16;
const MAXIMUM_CREDENTIAL_ID_BYTES = 1024;
const TASK3_PAYLOAD_CIPHERTEXT_BYTES = [
  new TextEncoder().encode(
    JSON.stringify({
      format: "zk-wallet-empty-vault",
      items: [],
      recoveryKitVerified: false,
      schemaVersion: TASK3_VAULT_SCHEMA_VERSION,
    }),
  ).length + 16,
  new TextEncoder().encode(
    JSON.stringify({
      format: "zk-wallet-empty-vault",
      items: [],
      recoveryKitVerified: true,
      schemaVersion: TASK3_VAULT_SCHEMA_VERSION,
    }),
  ).length + 16,
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} contains unexpected fields`);
  }
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number") {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
  return value;
}

function base64UrlLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

function canonicalBytes(value: unknown, expectedLength: number, label: string): string {
  const encoded = string(value, label);
  if (encoded.length !== base64UrlLength(expectedLength)) {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
  try {
    const bytes = base64UrlToBytes(encoded);
    if (bytes.length !== expectedLength) throw new Error("length");
    return encoded;
  } catch {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
}

function canonicalVariableBytes(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  label: string,
): string {
  const encoded = string(value, label);
  if (encoded.length > base64UrlLength(maximumLength)) {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
  try {
    const bytes = base64UrlToBytes(encoded);
    if (bytes.length < minimumLength || bytes.length > maximumLength) throw new Error("length");
    return encoded;
  } catch {
    throw new VaultError("INVALID_VAULT_HEADER", `${label} is invalid`);
  }
}

function parseEnvelope(
  value: unknown,
  expectedPurpose: EnvelopePurpose,
  expectedSchemaVersion: 1 | 2,
  expectedCiphertextLengths: readonly number[],
): EncryptedEnvelope {
  const envelope = record(value, "Encrypted envelope");
  exactKeys(
    envelope,
    ["algorithm", "ciphertext", "contentSchemaVersion", "nonce", "purpose", "version"],
    "Encrypted envelope",
  );
  if (integer(envelope.version, "Envelope version") !== ENVELOPE_VERSION) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Envelope version is unsupported");
  }
  if (string(envelope.algorithm, "Envelope algorithm") !== XCHACHA20_POLY1305_ALGORITHM) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Envelope algorithm is unsupported");
  }
  if (string(envelope.purpose, "Envelope purpose") !== expectedPurpose) {
    throw new VaultError("INVALID_VAULT_HEADER", "Envelope purpose is invalid");
  }
  if (integer(envelope.contentSchemaVersion, "Content schema version") !== expectedSchemaVersion) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Content schema version is unsupported");
  }
  const ciphertext = string(envelope.ciphertext, "Envelope ciphertext");
  const acceptedLength = expectedCiphertextLengths.find(
    (byteLength) => ciphertext.length === base64UrlLength(byteLength),
  );
  if (acceptedLength === undefined) {
    throw new VaultError("INVALID_VAULT_HEADER", "Envelope ciphertext is invalid");
  }
  return {
    algorithm: XCHACHA20_POLY1305_ALGORITHM,
    ciphertext: canonicalBytes(ciphertext, acceptedLength, "Envelope ciphertext"),
    contentSchemaVersion: expectedSchemaVersion,
    nonce: canonicalBytes(envelope.nonce, 24, "Envelope nonce"),
    purpose: expectedPurpose,
    version: ENVELOPE_VERSION,
  };
}

function parseKdf(value: unknown): PasswordKdfV1 {
  const kdf = record(value, "Password KDF");
  exactKeys(
    kdf,
    ["algorithm", "memoryKiB", "operations", "outputLength", "parallelism", "salt"],
    "Password KDF",
  );
  const parameters = {
    algorithm: string(kdf.algorithm, "KDF algorithm"),
    memoryKiB: integer(kdf.memoryKiB, "KDF memory"),
    operations: integer(kdf.operations, "KDF operations"),
    outputLength: integer(kdf.outputLength, "KDF output length"),
    parallelism: integer(kdf.parallelism, "KDF parallelism"),
  };
  if (parameters.algorithm !== ARGON2ID_ALGORITHM) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "KDF algorithm is unsupported");
  }
  try {
    assertProductionKdfParameters({
      algorithm: ARGON2ID_ALGORITHM,
      memoryKiB: parameters.memoryKiB,
      operations: parameters.operations,
      outputLength: parameters.outputLength === 32 ? 32 : (parameters.outputLength as 32),
      parallelism: parameters.parallelism === 1 ? 1 : (parameters.parallelism as 1),
    });
  } catch (error) {
    if (error instanceof CryptoError && error.code === "KDF_POLICY_VIOLATION") {
      throw new VaultError("KDF_POLICY_VIOLATION", "Persisted KDF parameters violate policy");
    }
    throw error;
  }
  if (
    parameters.memoryKiB > MAXIMUM_V1_KDF_MEMORY_KIB ||
    parameters.operations !== ARGON2ID_PRODUCTION_FLOOR.operations
  ) {
    throw new VaultError("KDF_POLICY_VIOLATION", "Persisted KDF parameters violate policy");
  }
  return {
    algorithm: ARGON2ID_ALGORITHM,
    memoryKiB: parameters.memoryKiB,
    operations: parameters.operations,
    outputLength: 32,
    parallelism: 1,
    salt: canonicalBytes(kdf.salt, 16, "KDF salt"),
  };
}

function parseMasterPasswordSlotV1(value: unknown): MasterPasswordSlotV1 {
  const slot = record(value, "Master-password slot");
  exactKeys(slot, ["id", "kdf", "type", "version", "wrappedRootKey"], "Master-password slot");
  if (integer(slot.version, "Slot version") !== 1) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Key-slot version is unsupported");
  }
  if (string(slot.type, "Slot type") !== "master-password") {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Key-slot type is unsupported");
  }
  return {
    id: canonicalBytes(slot.id, 16, "Slot ID"),
    kdf: parseKdf(slot.kdf),
    type: "master-password",
    version: 1,
    wrappedRootKey: parseEnvelope(
      slot.wrappedRootKey,
      "root-key-wrap",
      EMPTY_VAULT_SCHEMA_VERSION,
      [ROOT_KEY_CIPHERTEXT_BYTES],
    ) as EncryptedEnvelopeV1,
  };
}

function parseWrappedKeys(value: unknown): WrappedKeySetV1 {
  const keys = record(value, "Wrapped keys");
  exactKeys(keys, ["credential", "document", "root"], "Wrapped keys");
  return {
    credential: parseEnvelope(keys.credential, "credential-key-wrap", EMPTY_VAULT_SCHEMA_VERSION, [
      ROOT_KEY_CIPHERTEXT_BYTES,
    ]),
    document: parseEnvelope(keys.document, "document-key-wrap", EMPTY_VAULT_SCHEMA_VERSION, [
      ROOT_KEY_CIPHERTEXT_BYTES,
    ]),
    root: parseEnvelope(keys.root, "root-key-wrap", EMPTY_VAULT_SCHEMA_VERSION, [
      ROOT_KEY_CIPHERTEXT_BYTES,
    ]),
  };
}

function parseMasterPasswordSlotV2(value: unknown): MasterPasswordSlotV2 {
  const slot = record(value, "Master-password slot");
  exactKeys(slot, ["id", "kdf", "type", "version", "wrappedKeys"], "Master-password slot");
  if (integer(slot.version, "Slot version") !== 2) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Key-slot version is unsupported");
  }
  if (string(slot.type, "Slot type") !== "master-password") {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Key-slot type is unsupported");
  }
  return {
    id: canonicalBytes(slot.id, 16, "Slot ID"),
    kdf: parseKdf(slot.kdf),
    type: "master-password",
    version: 2,
    wrappedKeys: parseWrappedKeys(slot.wrappedKeys),
  };
}

function parseRecoverySlot(value: unknown): RecoveryKitSlotV1 {
  const slot = record(value, "Recovery slot");
  exactKeys(slot, ["id", "type", "version", "wrappedKeys"], "Recovery slot");
  if (integer(slot.version, "Slot version") !== 1) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Recovery slot version is unsupported");
  }
  if (string(slot.type, "Slot type") !== "recovery-kit") {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Recovery slot type is unsupported");
  }
  return {
    id: canonicalBytes(slot.id, 16, "Recovery slot ID"),
    type: "recovery-kit",
    version: 1,
    wrappedKeys: parseWrappedKeys(slot.wrappedKeys),
  };
}

function parseDeviceSlot(value: unknown): DeviceSlotV1 {
  const slot = record(value, "Device slot");
  const status = string(slot.status, "Device slot status");
  if (status === "revoked") {
    exactKeys(slot, ["id", "status", "type", "version"], "Revoked device slot");
    if (integer(slot.version, "Device slot version") !== 1 || slot.type !== "webauthn-prf") {
      throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Device slot is unsupported");
    }
    return {
      id: canonicalBytes(slot.id, 16, "Device slot ID"),
      status: "revoked",
      type: "webauthn-prf",
      version: 1,
    };
  }
  if (status !== "active") {
    throw new VaultError("INVALID_VAULT_HEADER", "Device slot status is invalid");
  }
  exactKeys(
    slot,
    ["credentialId", "id", "prfInput", "status", "type", "version", "wrappedKeys"],
    "Active device slot",
  );
  if (integer(slot.version, "Device slot version") !== 1 || slot.type !== "webauthn-prf") {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Device slot is unsupported");
  }
  return {
    credentialId: canonicalVariableBytes(
      slot.credentialId,
      1,
      MAXIMUM_CREDENTIAL_ID_BYTES,
      "Credential ID",
    ),
    id: canonicalBytes(slot.id, 16, "Device slot ID"),
    prfInput: canonicalBytes(slot.prfInput, 32, "PRF input"),
    status: "active",
    type: "webauthn-prf",
    version: 1,
    wrappedKeys: parseWrappedKeys(slot.wrappedKeys),
  } satisfies ActiveDeviceSlotV1;
}

function parseV1(header: Record<string, unknown>): VaultHeaderV1 {
  exactKeys(
    header,
    [
      "encryptedPayload",
      "format",
      "masterPasswordSlot",
      "minimumClientVersion",
      "vaultId",
      "version",
    ],
    "Vault header",
  );
  if (
    integer(header.minimumClientVersion, "Minimum client version") !==
    VAULT_MINIMUM_CLIENT_VERSION_V1
  ) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Vault client version is unsupported");
  }
  return {
    encryptedPayload: parseEnvelope(
      header.encryptedPayload,
      "vault-payload",
      EMPTY_VAULT_SCHEMA_VERSION,
      [EMPTY_PAYLOAD_CIPHERTEXT_BYTES],
    ) as EncryptedEnvelopeV1,
    format: VAULT_HEADER_FORMAT,
    masterPasswordSlot: parseMasterPasswordSlotV1(header.masterPasswordSlot),
    minimumClientVersion: VAULT_MINIMUM_CLIENT_VERSION_V1,
    vaultId: canonicalBytes(header.vaultId, 16, "Vault ID"),
    version: VAULT_HEADER_VERSION_V1,
  };
}

function parseV2(header: Record<string, unknown>): VaultHeaderV2 {
  exactKeys(
    header,
    [
      "deviceSlots",
      "encryptedPayload",
      "format",
      "masterPasswordSlot",
      "minimumClientVersion",
      "recoverySlot",
      "revision",
      "securityTag",
      "vaultId",
      "version",
    ],
    "Vault header",
  );
  if (
    integer(header.minimumClientVersion, "Minimum client version") !== VAULT_MINIMUM_CLIENT_VERSION
  ) {
    throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Vault client version is unsupported");
  }
  const revision = integer(header.revision, "Header revision");
  if (revision < 1) throw new VaultError("INVALID_VAULT_HEADER", "Header revision is invalid");
  if (!Array.isArray(header.deviceSlots) || header.deviceSlots.length > MAXIMUM_DEVICE_SLOTS) {
    throw new VaultError("INVALID_VAULT_HEADER", "Device slots are invalid");
  }
  const deviceSlots = header.deviceSlots.map(parseDeviceSlot);
  const masterPasswordSlot = parseMasterPasswordSlotV2(header.masterPasswordSlot);
  const recoverySlot = parseRecoverySlot(header.recoverySlot);
  const slotIds = [masterPasswordSlot.id, recoverySlot.id, ...deviceSlots.map((slot) => slot.id)];
  if (new Set(slotIds).size !== slotIds.length) {
    throw new VaultError("INVALID_VAULT_HEADER", "Key-slot IDs are duplicated");
  }
  const credentialIds = deviceSlots
    .filter((slot): slot is ActiveDeviceSlotV1 => slot.status === "active")
    .map((slot) => slot.credentialId);
  if (new Set(credentialIds).size !== credentialIds.length) {
    throw new VaultError("INVALID_VAULT_HEADER", "Credential IDs are duplicated");
  }
  return {
    deviceSlots,
    encryptedPayload: parseEnvelope(
      header.encryptedPayload,
      "vault-payload",
      TASK3_VAULT_SCHEMA_VERSION,
      TASK3_PAYLOAD_CIPHERTEXT_BYTES,
    ),
    format: VAULT_HEADER_FORMAT,
    masterPasswordSlot,
    minimumClientVersion: VAULT_MINIMUM_CLIENT_VERSION,
    recoverySlot,
    revision,
    securityTag: canonicalBytes(header.securityTag, 40, "Header security tag"),
    vaultId: canonicalBytes(header.vaultId, 16, "Vault ID"),
    version: VAULT_HEADER_VERSION,
  };
}

export function parseVaultHeader(value: unknown): VaultHeader {
  const header = record(value, "Vault header");
  if (header.format !== VAULT_HEADER_FORMAT) {
    throw new VaultError("INVALID_VAULT_HEADER", "Vault header format is invalid");
  }
  const version = integer(header.version, "Vault header version");
  if (version === VAULT_HEADER_VERSION_V1) return parseV1(header);
  if (version === VAULT_HEADER_VERSION) return parseV2(header);
  throw new VaultError("UNSUPPORTED_VAULT_VERSION", "Vault header version is unsupported");
}
