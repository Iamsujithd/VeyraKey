import type { Argon2idParameters } from "@zk-wallet/crypto";
import type {
  EncryptedItemRevisionV1,
  IdentityProfileItemInput,
  LoginItemInput,
  PaymentCardItemInput,
  SecureNoteItemInput,
  VaultItem,
} from "./items";
import type { CreatedEncryptedItemShare } from "./share";

export const VAULT_HEADER_FORMAT = "zk-wallet-vault" as const;
export const VAULT_HEADER_VERSION_V1 = 1 as const;
export const VAULT_HEADER_VERSION = 2 as const;
export const VAULT_MINIMUM_CLIENT_VERSION_V1 = 1 as const;
export const VAULT_MINIMUM_CLIENT_VERSION = 2 as const;
export const ENVELOPE_VERSION = 1 as const;
export const EMPTY_VAULT_SCHEMA_VERSION = 1 as const;
export const TASK3_VAULT_SCHEMA_VERSION = 2 as const;

export type KeyKind = "credential" | "document" | "root";
export type SensitiveCompartment = Exclude<KeyKind, "root">;
export type EnvelopePurpose =
  | "credential-key-wrap"
  | "document-key-wrap"
  | "root-key-wrap"
  | "vault-payload";

export interface EncryptedEnvelope {
  readonly algorithm: "xchacha20-poly1305-ietf";
  readonly ciphertext: string;
  readonly contentSchemaVersion: 1 | 2;
  readonly nonce: string;
  readonly purpose: EnvelopePurpose;
  readonly version: 1;
}

export interface EncryptedEnvelopeV1 extends EncryptedEnvelope {
  readonly contentSchemaVersion: 1;
  readonly purpose: "root-key-wrap" | "vault-payload";
}

export interface PasswordKdfV1 extends Argon2idParameters {
  readonly salt: string;
}

export interface MasterPasswordSlotV1 {
  readonly id: string;
  readonly kdf: PasswordKdfV1;
  readonly type: "master-password";
  readonly version: 1;
  readonly wrappedRootKey: EncryptedEnvelopeV1;
}

export interface VaultHeaderV1 {
  readonly encryptedPayload: EncryptedEnvelopeV1;
  readonly format: typeof VAULT_HEADER_FORMAT;
  readonly masterPasswordSlot: MasterPasswordSlotV1;
  readonly minimumClientVersion: typeof VAULT_MINIMUM_CLIENT_VERSION_V1;
  readonly vaultId: string;
  readonly version: typeof VAULT_HEADER_VERSION_V1;
}

export interface WrappedKeySetV1 {
  readonly credential: EncryptedEnvelope;
  readonly document: EncryptedEnvelope;
  readonly root: EncryptedEnvelope;
}

export interface MasterPasswordSlotV2 {
  readonly id: string;
  readonly kdf: PasswordKdfV1;
  readonly type: "master-password";
  readonly version: 2;
  readonly wrappedKeys: WrappedKeySetV1;
}

export interface RecoveryKitSlotV1 {
  readonly id: string;
  readonly type: "recovery-kit";
  readonly version: 1;
  readonly wrappedKeys: WrappedKeySetV1;
}

export interface ActiveDeviceSlotV1 {
  readonly credentialId: string;
  readonly id: string;
  readonly prfInput: string;
  readonly status: "active";
  readonly type: "webauthn-prf";
  readonly version: 1;
  readonly wrappedKeys: WrappedKeySetV1;
}

export interface ActiveDeviceSlotV2 {
  readonly credentialId: string;
  readonly id: string;
  readonly prfInput: string;
  readonly scope: string;
  readonly status: "active";
  readonly type: "webauthn-prf";
  readonly version: 2;
  readonly wrappedKeys: WrappedKeySetV1;
}

export interface RevokedDeviceSlotV1 {
  readonly id: string;
  readonly status: "revoked";
  readonly type: "webauthn-prf";
  readonly version: 1;
}

export type ActiveDeviceSlot = ActiveDeviceSlotV1 | ActiveDeviceSlotV2;
export type DeviceSlotV1 = ActiveDeviceSlot | RevokedDeviceSlotV1;

export interface VaultHeaderV2 {
  readonly deviceSlots: readonly DeviceSlotV1[];
  readonly encryptedPayload: EncryptedEnvelope;
  readonly format: typeof VAULT_HEADER_FORMAT;
  readonly masterPasswordSlot: MasterPasswordSlotV2;
  readonly minimumClientVersion: typeof VAULT_MINIMUM_CLIENT_VERSION;
  readonly recoverySlot: RecoveryKitSlotV1;
  readonly revision: number;
  readonly securityTag: string;
  readonly vaultId: string;
  readonly version: typeof VAULT_HEADER_VERSION;
}

export type VaultHeader = VaultHeaderV1 | VaultHeaderV2;

export interface EmptyVaultPayloadV1 {
  readonly format: "zk-wallet-empty-vault";
  readonly items: readonly [];
  readonly schemaVersion: 1;
}

export interface Task3VaultPayloadV2 {
  readonly format: "zk-wallet-empty-vault";
  readonly items: readonly [];
  readonly recoveryKitVerified: boolean;
  readonly schemaVersion: 2;
}

export interface DeviceSlotSummary {
  readonly id: string;
}

export interface DeviceUnlockSummary {
  readonly available: boolean;
  readonly slots: readonly DeviceSlotSummary[];
}

export type RecoveryPublicState =
  | { readonly recoveryKit: string; readonly status: "pending" }
  | { readonly status: "replacement-required" }
  | { readonly status: "verified" };

export type VaultPublicState =
  | { readonly status: "needs-setup" }
  | {
      readonly deviceUnlock: DeviceUnlockSummary;
      readonly status: "locked";
      readonly vaultId: string;
    }
  | {
      readonly deviceUnlock: DeviceUnlockSummary;
      readonly itemCount: number;
      readonly recovery: RecoveryPublicState;
      readonly syncConflicts?: readonly {
        readonly itemId: string;
        readonly revisionIds: readonly string[];
      }[];
      readonly status: "unlocked";
      readonly unlockedCompartments: readonly SensitiveCompartment[];
      readonly vaultId: string;
    };

export interface VaultHeaderWriteCondition {
  readonly revision: number | null;
  readonly vaultId: string;
  readonly version: number;
}

export interface VaultHeaderRepository {
  create(header: VaultHeader): Promise<void>;
  read(): Promise<unknown | null>;
  replace(condition: VaultHeaderWriteCondition, header: VaultHeader): Promise<void>;
  restoreArchive?(
    header: VaultHeader,
    revisions: readonly EncryptedItemRevisionV1[],
    headRevisionIds: readonly string[],
  ): Promise<void>;
}

export interface RestoreVaultRequest {
  readonly encryptedVault: unknown;
  readonly newMasterPassword: string;
  readonly recoveryKit: string;
}

export interface VaultSessionMaterialV1 {
  readonly expiresAt: number;
  readonly rootKey: Uint8Array;
  readonly vaultId: string;
  readonly version: 1;
}

export interface ChangeMasterPasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface VaultItemHistoryEntry {
  readonly item: VaultItem | null;
  readonly operation: EncryptedItemRevisionV1["operation"];
  readonly parentRevisionId: string | null;
  readonly revisionId: string;
}

export type StepUpCredential =
  | { readonly password: string; readonly type: "master-password" }
  | { readonly recoveryKit: string; readonly type: "recovery-kit" }
  | { readonly slotId: string; readonly type: "device" };

export interface VaultClient {
  changeMasterPassword(request: ChangeMasterPasswordRequest): Promise<VaultPublicState>;
  createItemShare?(itemId: string, expiresAt: string): Promise<CreatedEncryptedItemShare>;
  createVault(masterPassword: string): Promise<VaultPublicState>;
  createIdentityProfile?(input: IdentityProfileItemInput): Promise<VaultItem>;
  createLogin(input: LoginItemInput): Promise<VaultItem>;
  createPaymentCard?(input: PaymentCardItemInput): Promise<VaultItem>;
  createSecureNote(input: SecureNoteItemInput): Promise<VaultItem>;
  deleteItem(itemId: string, expectedRevisionId: string): Promise<void>;
  enrollDevice(masterPassword: string): Promise<VaultPublicState>;
  exportSessionMaterial?(): VaultSessionMaterialV1;
  exportEncryptedArchive?(): Promise<unknown>;
  getState(): VaultPublicState;
  initialize(): Promise<VaultPublicState>;
  importItems?(
    items: readonly (
      | { readonly input: LoginItemInput; readonly type: "login" }
      | { readonly input: IdentityProfileItemInput; readonly type: "identity-profile" }
      | { readonly input: PaymentCardItemInput; readonly type: "payment-card" }
      | { readonly input: SecureNoteItemInput; readonly type: "secure-note" }
    )[],
  ): Promise<readonly VaultItem[]>;
  listItemHistory?(itemId: string): Promise<readonly VaultItemHistoryEntry[]>;
  listItems(): Promise<readonly VaultItem[]>;
  lock(): VaultPublicState;
  recordActivity(): void;
  replaceRecoveryKit(masterPassword: string): Promise<VaultPublicState>;
  resumeSession?(material: VaultSessionMaterialV1): Promise<VaultPublicState>;
  restoreVault(request: RestoreVaultRequest): Promise<VaultPublicState>;
  restoreEncryptedArchive?(request: {
    readonly archive: unknown;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultPublicState>;
  restoreItemRevision?(
    itemId: string,
    historicalRevisionId: string,
    expectedHeadRevisionId: string,
  ): Promise<VaultItem>;
  revokeDevice(slotId: string): Promise<VaultPublicState>;
  searchItems?(query: string): Promise<readonly VaultItem[]>;
  stepUpCompartment(
    compartment: SensitiveCompartment,
    credential: StepUpCredential,
  ): Promise<VaultPublicState>;
  subscribe(listener: (state: VaultPublicState) => void): () => void;
  unlock(masterPassword: string): Promise<VaultPublicState>;
  unlockWithDevice(slotId: string): Promise<VaultPublicState>;
  unlockWithRecoveryKit(recoveryKit: string): Promise<VaultPublicState>;
  updateLogin(
    itemId: string,
    expectedRevisionId: string,
    input: LoginItemInput,
  ): Promise<VaultItem>;
  updatePaymentCard?(
    itemId: string,
    expectedRevisionId: string,
    input: PaymentCardItemInput,
  ): Promise<VaultItem>;
  updateIdentityProfile?(
    itemId: string,
    expectedRevisionId: string,
    input: IdentityProfileItemInput,
  ): Promise<VaultItem>;
  updateSecureNote(
    itemId: string,
    expectedRevisionId: string,
    input: SecureNoteItemInput,
  ): Promise<VaultItem>;
  verifyRecoveryKit(recoveryKit: string): Promise<VaultPublicState>;
}

export type VaultErrorCode =
  | "DEVICE_SLOT_REVOKED"
  | "DEVICE_UNLOCK_FAILED"
  | "DEVICE_UNLOCK_UNAVAILABLE"
  | "INVALID_PASSWORD_OR_CORRUPT_DATA"
  | "INVALID_RECOVERY_KIT"
  | "INVALID_RECOVERY_KIT_OR_CORRUPT_DATA"
  | "INVALID_VAULT_HEADER"
  | "KDF_POLICY_VIOLATION"
  | "OPERATION_IN_PROGRESS"
  | "RECOVERY_VERIFICATION_REQUIRED"
  | "UNSUPPORTED_VAULT_VERSION"
  | "VAULT_ALREADY_EXISTS"
  | "VAULT_LOCKED"
  | "VAULT_NOT_FOUND"
  | "VAULT_WRITE_CONFLICT";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}
