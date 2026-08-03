import {
  type ImportPreview,
  previewBitwardenJson,
  previewGenericCsv,
  selectedImportRequests,
} from "@zk-wallet/import-export";
import {
  analyzePasswordHealth,
  BUILT_IN_PASSPHRASE_WORDS,
  checkPwnedPassword,
  copyWithBestEffortClear,
  generatePassphrase,
  generateReadableStrongPassword,
  generateTotp,
  type PasswordHealthFinding,
  type PwnedPasswordResult,
  parseOtpAuthQr,
  parseOtpAuthUri,
} from "@zk-wallet/security";
import { type FormEvent, useEffect, useLayoutEffect, useState } from "react";

export type SensitiveCompartment = "credential" | "document";

export type VaultViewState =
  | { readonly status: "needs-setup" }
  | {
      readonly deviceUnlock: {
        readonly available: boolean;
        readonly slots: readonly { readonly id: string }[];
      };
      readonly status: "locked";
      readonly vaultId: string;
    }
  | {
      readonly deviceUnlock: {
        readonly available: boolean;
        readonly slots: readonly { readonly id: string }[];
      };
      readonly itemCount: number;
      readonly recovery:
        | { readonly recoveryKit: string; readonly status: "pending" }
        | { readonly status: "replacement-required" }
        | { readonly status: "verified" };
      readonly status: "unlocked";
      readonly syncConflicts?: readonly {
        readonly itemId: string;
        readonly revisionIds: readonly string[];
      }[];
      readonly unlockedCompartments: readonly SensitiveCompartment[];
      readonly vaultId: string;
    };

export type StepUpCredential =
  | { readonly password: string; readonly type: "master-password" }
  | { readonly recoveryKit: string; readonly type: "recovery-kit" }
  | { readonly slotId: string; readonly type: "device" };

export interface IdentityProfileInputView {
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly age: string;
  readonly city: string;
  readonly country: string;
  readonly dateOfBirth: string;
  readonly email: string;
  readonly favorite?: boolean;
  readonly firstName: string;
  readonly folder?: string;
  readonly lastName: string;
  readonly middleName: string;
  readonly nickname: string;
  readonly organization: string;
  readonly phone: string;
  readonly postalCode: string;
  readonly region: string;
  readonly tags?: readonly string[];
  readonly title: string;
}

export interface PaymentCardInputView {
  readonly billingAddress: string;
  readonly cardNumber: string;
  readonly cardholderName: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
  readonly favorite?: boolean;
  readonly folder?: string;
  readonly notes: string;
  readonly securityCode: string;
  readonly tags?: readonly string[];
  readonly title: string;
}

export interface LoginEmailAliasView {
  readonly address: string;
  readonly createdAt: string;
  readonly createdForOrigin: string;
  readonly provider: "addy" | "plus" | "simplelogin";
  readonly providerAliasId?: string;
  readonly sourceEmail?: string;
}

export interface PasskeyReferenceView {
  readonly createdAt: string;
  readonly credentialId?: string;
  readonly discoverable?: boolean;
  readonly displayName: string;
  readonly provider: "external" | "platform" | "security-key";
  readonly rpId: string;
  readonly userName: string;
}

export interface VaultItemHistoryEntryView {
  readonly item: VaultItemView | null;
  readonly operation: "create" | "delete" | "update";
  readonly parentRevisionId?: string | null;
  readonly revisionId: string;
}

interface CreatedItemShareView {
  readonly bundle: {
    readonly expiresAt: string;
    readonly shareId: string;
  };
  readonly secret: string;
}

export interface VaultClient {
  changeMasterPassword(request: {
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<VaultViewState>;
  createVault(masterPassword: string): Promise<VaultViewState>;
  createItemShare?(itemId: string, expiresAt: string): Promise<CreatedItemShareView>;
  createIdentityProfile?(input: IdentityProfileInputView): Promise<VaultItemView>;
  createLogin?(input: {
    readonly breachCheck?:
      | { readonly checkedAt: string; readonly count: number; readonly status: "found" }
      | { readonly checkedAt: string; readonly status: "not-found" | "unavailable" };
    readonly favorite?: boolean;
    readonly emailAlias?: LoginEmailAliasView;
    readonly folder?: string;
    readonly notes: string;
    readonly password: string;
    readonly passkeys?: readonly PasskeyReferenceView[];
    readonly tags?: readonly string[];
    readonly title: string;
    readonly totpUri?: string;
    readonly uris: readonly string[];
    readonly username: string;
  }): Promise<VaultItemView>;
  createPaymentCard?(input: PaymentCardInputView): Promise<VaultItemView>;
  createSecureNote?(input: {
    readonly favorite?: boolean;
    readonly folder?: string;
    readonly note: string;
    readonly tags?: readonly string[];
    readonly title: string;
  }): Promise<VaultItemView>;
  deleteItem?(itemId: string, expectedRevisionId: string): Promise<void>;
  disconnectGoogleDrive?(): void;
  disconnectOneDrive?(): void;
  enrollDevice(masterPassword: string): Promise<VaultViewState>;
  exportEncryptedArchive?(): Promise<unknown>;
  getState(): VaultViewState;
  initialize(): Promise<VaultViewState>;
  isGoogleDriveConnected?(): boolean;
  getGoogleDriveAccount?(): string | null;
  importItems?(
    items: readonly (
      | {
          readonly input: Parameters<NonNullable<VaultClient["createLogin"]>>[0];
          readonly type: "login";
        }
      | {
          readonly input: IdentityProfileInputView;
          readonly type: "identity-profile";
        }
      | {
          readonly input: Parameters<NonNullable<VaultClient["createSecureNote"]>>[0];
          readonly type: "secure-note";
        }
      | {
          readonly input: PaymentCardInputView;
          readonly type: "payment-card";
        }
    )[],
  ): Promise<readonly VaultItemView[]>;
  listItemHistory?(itemId: string): Promise<readonly VaultItemHistoryEntryView[]>;
  listItems?(): Promise<readonly VaultItemView[]>;
  lock(): VaultViewState;
  recordActivity(): void;
  replaceRecoveryKit(masterPassword: string): Promise<VaultViewState>;
  restoreVault(request: {
    readonly encryptedVault: unknown;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  restoreEncryptedArchive?(request: {
    readonly archive: unknown;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  restoreEncryptedArchiveWithMasterPassword?(request: {
    readonly archive: unknown;
    readonly masterPassword: string;
  }): Promise<VaultViewState>;
  restoreFromGoogleDrive?(request: {
    readonly clientId: string;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  restoreFromGoogleDriveWithMasterPassword?(request: {
    readonly clientId: string;
    readonly masterPassword: string;
    readonly selectAccount?: boolean;
  }): Promise<VaultViewState>;
  restoreFromOneDrive?(request: {
    readonly clientId: string;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  restoreItemRevision?(
    itemId: string,
    historicalRevisionId: string,
    expectedHeadRevisionId: string,
  ): Promise<VaultItemView>;
  revokeDevice(slotId: string): Promise<VaultViewState>;
  searchItems?(query: string): Promise<readonly VaultItemView[]>;
  stepUpCompartment(
    compartment: SensitiveCompartment,
    credential: StepUpCredential,
  ): Promise<VaultViewState>;
  subscribe(listener: (state: VaultViewState) => void): () => void;
  syncGoogleDrive?(request: {
    readonly clientId: string;
    readonly selectAccount?: boolean;
  }): Promise<VaultSyncResult>;
  syncOneDrive?(request: { readonly clientId: string }): Promise<VaultSyncResult>;
  unlock(masterPassword: string): Promise<VaultViewState>;
  unlockWithDevice(slotId: string): Promise<VaultViewState>;
  unlockWithRecoveryKit(recoveryKit: string): Promise<VaultViewState>;
  updateLogin?(
    itemId: string,
    expectedRevisionId: string,
    input: {
      readonly breachCheck?:
        | { readonly checkedAt: string; readonly count: number; readonly status: "found" }
        | { readonly checkedAt: string; readonly status: "not-found" | "unavailable" };
      readonly favorite?: boolean;
      readonly emailAlias?: LoginEmailAliasView;
      readonly folder?: string;
      readonly notes: string;
      readonly password: string;
      readonly passkeys?: readonly PasskeyReferenceView[];
      readonly tags?: readonly string[];
      readonly title: string;
      readonly totpUri?: string;
      readonly uris: readonly string[];
      readonly username: string;
    },
  ): Promise<VaultItemView>;
  updateIdentityProfile?(
    itemId: string,
    expectedRevisionId: string,
    input: IdentityProfileInputView,
  ): Promise<VaultItemView>;
  updatePaymentCard?(
    itemId: string,
    expectedRevisionId: string,
    input: PaymentCardInputView,
  ): Promise<VaultItemView>;
  updateSecureNote?(
    itemId: string,
    expectedRevisionId: string,
    input: {
      readonly favorite?: boolean;
      readonly folder?: string;
      readonly note: string;
      readonly tags?: readonly string[];
      readonly title: string;
    },
  ): Promise<VaultItemView>;
  verifyRecoveryKit(recoveryKit: string): Promise<VaultViewState>;
}

export interface VaultSyncResult {
  readonly accountEmail?: string;
  readonly conflicts: readonly {
    readonly itemId: string;
    readonly revisionIds: readonly string[];
  }[];
  readonly itemCount: number;
  readonly quarantined: number;
  readonly revisionCount: number;
  readonly uploaded: number;
}

export type VaultItemView =
  | (IdentityProfileInputView & {
      readonly createdAt: string;
      readonly id: string;
      readonly revisionId: string;
      readonly type: "identity-profile";
      readonly updatedAt: string;
    })
  | (PaymentCardInputView & {
      readonly createdAt: string;
      readonly id: string;
      readonly revisionId: string;
      readonly type: "payment-card";
      readonly updatedAt: string;
    })
  | {
      readonly breachCheck?:
        | { readonly checkedAt: string; readonly count: number; readonly status: "found" }
        | { readonly checkedAt: string; readonly status: "not-found" | "unavailable" };
      readonly createdAt: string;
      readonly emailAlias?: LoginEmailAliasView;
      readonly favorite?: boolean;
      readonly folder?: string;
      readonly id: string;
      readonly notes: string;
      readonly password: string;
      readonly passkeys?: readonly PasskeyReferenceView[];
      readonly revisionId: string;
      readonly tags?: readonly string[];
      readonly title: string;
      readonly totpUri?: string;
      readonly type: "login";
      readonly updatedAt: string;
      readonly uris: readonly string[];
      readonly username: string;
    }
  | {
      readonly createdAt: string;
      readonly favorite?: boolean;
      readonly folder?: string;
      readonly id: string;
      readonly note: string;
      readonly revisionId: string;
      readonly tags?: readonly string[];
      readonly title: string;
      readonly type: "secure-note";
      readonly updatedAt: string;
    };

type ProfileField = Exclude<
  keyof IdentityProfileInputView,
  "favorite" | "folder" | "tags" | "title"
>;

const EMPTY_PROFILE: Readonly<Record<ProfileField, string>> = {
  addressLine1: "",
  addressLine2: "",
  age: "",
  city: "",
  country: "",
  dateOfBirth: "",
  email: "",
  firstName: "",
  lastName: "",
  middleName: "",
  nickname: "",
  organization: "",
  phone: "",
  postalCode: "",
  region: "",
};

const EMPTY_PAYMENT_CARD: PaymentCardInputView = {
  billingAddress: "",
  cardNumber: "",
  cardholderName: "",
  expiryMonth: "",
  expiryYear: "",
  notes: "",
  securityCode: "",
  title: "",
};

const PROFILE_FIELDS: readonly {
  readonly autocomplete: string;
  readonly key: ProfileField;
  readonly label: string;
  readonly type?: string;
}[] = [
  { autocomplete: "given-name", key: "firstName", label: "First name" },
  { autocomplete: "additional-name", key: "middleName", label: "Middle name" },
  { autocomplete: "family-name", key: "lastName", label: "Last name" },
  { autocomplete: "nickname", key: "nickname", label: "Nickname" },
  { autocomplete: "email", key: "email", label: "Email", type: "email" },
  { autocomplete: "tel", key: "phone", label: "Phone", type: "tel" },
  { autocomplete: "organization", key: "organization", label: "Organization" },
  { autocomplete: "bday", key: "dateOfBirth", label: "Date of birth", type: "date" },
  { autocomplete: "off", key: "age", label: "Age", type: "number" },
  { autocomplete: "address-line1", key: "addressLine1", label: "Address line 1" },
  { autocomplete: "address-line2", key: "addressLine2", label: "Address line 2" },
  { autocomplete: "address-level2", key: "city", label: "City" },
  { autocomplete: "address-level1", key: "region", label: "State / region" },
  { autocomplete: "postal-code", key: "postalCode", label: "Postal code" },
  { autocomplete: "country-name", key: "country", label: "Country" },
] as const;

const PRIMARY_PROFILE_FIELD_KEYS = new Set<ProfileField>([
  "email",
  "firstName",
  "lastName",
  "phone",
]);

const PRIVATE_EMAIL_SETTINGS_TAG = "veyrakey:private-email-settings";
const PRIVATE_EMAIL_SETTINGS_TITLE = "VeyraKey Private Email Settings";
const PRIVATE_EMAIL_SETTINGS_FOLDER = "VeyraKey System";

type PrivateEmailProvider = "addy" | "plus" | "simplelogin";

function readPrivateEmailSettings(note: string): {
  readonly apiSecret: string;
  readonly autoFill: boolean;
  readonly baseEmail: string;
  readonly domain: string;
  readonly provider: PrivateEmailProvider;
} | null {
  try {
    const value = JSON.parse(note) as Record<string, unknown>;
    if (value.version !== 1 || typeof value.autoFill !== "boolean") return null;
    if (value.provider === "plus" && typeof value.baseEmail === "string") {
      return {
        apiSecret: "",
        autoFill: value.autoFill,
        baseEmail: value.baseEmail,
        domain: "",
        provider: "plus",
      };
    }
    if (value.provider === "simplelogin" && typeof value.apiCode === "string") {
      return {
        apiSecret: value.apiCode,
        autoFill: value.autoFill,
        baseEmail: "",
        domain: "",
        provider: "simplelogin",
      };
    }
    if (
      value.provider === "addy" &&
      typeof value.apiToken === "string" &&
      typeof value.domain === "string"
    ) {
      return {
        apiSecret: value.apiToken,
        autoFill: value.autoFill,
        baseEmail: "",
        domain: value.domain,
        provider: "addy",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface VaultScreenProps {
  readonly client: VaultClient;
  readonly providerConfiguration?: {
    readonly googleClientId?: string | undefined;
    readonly microsoftClientId?: string | undefined;
  };
  readonly surface: string;
}

type ScreenState =
  | VaultViewState
  | { readonly status: "load-failed" }
  | { readonly status: "preparing" };

type Operation =
  | "change-password"
  | "create"
  | "device-enroll"
  | "device-unlock"
  | "item"
  | "recovery-replace"
  | "recovery-unlock"
  | "recovery-verify"
  | "restore"
  | "revoke"
  | "step-up"
  | "unlock"
  | null;

function Header({ surface }: { readonly surface: string }) {
  return (
    <header className="vault-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          VK
        </span>
        <span className="brand-copy">
          <strong>VeyraKey</strong>
          <span>{surface}</span>
        </span>
      </div>
    </header>
  );
}

function PrivacyNote({ state }: { readonly state: ScreenState }) {
  const copy =
    state.status === "unlocked"
      ? {
          detail:
            "The root key is held only by this mounted client. Sensitive compartment keys require fresh step-up and expire separately.",
          title: "Decryption remains local.",
        }
      : {
          detail:
            "Master passwords, Recovery Kits, PRF outputs, and vault keys never go to the control plane.",
          title: "Local unlock only.",
        };

  return (
    <aside className="privacy-note" aria-label="Current privacy status">
      <span className="privacy-note-icon" aria-hidden="true">
        i
      </span>
      <p>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </p>
    </aside>
  );
}

function ErrorMessage({ error }: { readonly error: string | null }) {
  return error === null ? null : (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
}

function operationError(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "CRYPTO_UNAVAILABLE"
  ) {
    return "Local cryptography is temporarily unavailable. Retry without changing your credentials.";
  }
  return fallback;
}

function deviceEnrollmentError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.length > 0 &&
      message.length <= 180 &&
      !/[\r\n]/u.test(message) &&
      !/access[_ -]?token|authorization:\s*bearer/iu.test(message)
    ) {
      return message;
    }
  }
  return fallback;
}

function cloudOperationError(provider: string, error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.length > 0 &&
      message.length <= 240 &&
      !/[\r\n]/u.test(message) &&
      !/access[_ -]?token|authorization:\s*bearer/iu.test(message)
    ) {
      return `${provider}: ${message}`;
    }
  }
  return fallback;
}

function persistedBreachCheck(result: PwnedPasswordResult) {
  const checkedAt = new Date().toISOString();
  return result.status === "found"
    ? ({ checkedAt, count: result.count, status: "found" } as const)
    : ({ checkedAt, status: result.status } as const);
}

export function VaultScreen({ client, providerConfiguration, surface }: VaultScreenProps) {
  const defaultSetupDestination: "google" | "local" | "onedrive" =
    client.syncGoogleDrive !== undefined &&
    (providerConfiguration?.googleClientId?.trim().length ?? 0) > 0
      ? "google"
      : client.syncOneDrive !== undefined &&
          (providerConfiguration?.microsoftClientId?.trim().length ?? 0) > 0
        ? "onedrive"
        : "local";
  const [screenState, setScreenState] = useState<ScreenState>({ status: "preparing" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [operation, setOperation] = useState<Operation>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKitInput, setRecoveryKitInput] = useState("");
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [setupDestination, setSetupDestination] = useState<"google" | "local" | "onedrive">(
    defaultSetupDestination,
  );
  const [encryptedByosState, setEncryptedByosState] = useState("");
  const [googleRestorePassword, setGoogleRestorePassword] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [stepUpCompartment, setStepUpCompartment] = useState<SensitiveCompartment | null>(null);
  const [stepUpMethod, setStepUpMethod] = useState<"master-password" | "recovery-kit">(
    "master-password",
  );
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpRecoveryKit, setStepUpRecoveryKit] = useState("");
  const [deviceSlotId, setDeviceSlotId] = useState("");
  const [enrollmentPassword, setEnrollmentPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<readonly VaultItemView[]>([]);
  const [historyItemId, setHistoryItemId] = useState("");
  const [itemHistory, setItemHistory] = useState<readonly VaultItemHistoryEntryView[]>([]);
  const [createdShare, setCreatedShare] = useState<{
    readonly title: string;
    readonly value: CreatedItemShareView;
  } | null>(null);
  const [itemType, setItemType] = useState<
    "identity-profile" | "login" | "payment-card" | "secure-note"
  >("login");
  const [editingItem, setEditingItem] = useState<VaultItemView | null>(null);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [itemUsername, setItemUsername] = useState("");
  const [itemPassword, setItemPassword] = useState("");
  const [itemUris, setItemUris] = useState("");
  const [itemBody, setItemBody] = useState("");
  const [itemTotpUri, setItemTotpUri] = useState("");
  const [itemPasskeys, setItemPasskeys] = useState<readonly PasskeyReferenceView[]>([]);
  const [itemFolder, setItemFolder] = useState("");
  const [itemTags, setItemTags] = useState("");
  const [itemFavorite, setItemFavorite] = useState(false);
  const [profileFields, setProfileFields] =
    useState<Readonly<Record<ProfileField, string>>>(EMPTY_PROFILE);
  const [paymentCard, setPaymentCard] = useState<PaymentCardInputView>(EMPTY_PAYMENT_CARD);
  const [itemSearch, setItemSearch] = useState("");
  const [totpCodes, setTotpCodes] = useState<Readonly<Record<string, string>>>({});
  const [totpImportStatus, setTotpImportStatus] = useState("");
  const [importSource, setImportSource] = useState<"bitwarden" | "csv">("csv");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [selectedImportRows, setSelectedImportRows] = useState<ReadonlySet<number>>(new Set());
  const [healthFindings, setHealthFindings] = useState<
    Readonly<Record<string, PasswordHealthFinding>>
  >({});
  const [pwnedResults, setPwnedResults] = useState<Readonly<Record<string, PwnedPasswordResult>>>(
    {},
  );
  const [healthStatus, setHealthStatus] = useState("");
  const [selectedHealthItemId, setSelectedHealthItemId] = useState("");
  const googleClientId = providerConfiguration?.googleClientId?.trim() ?? "";
  const microsoftClientId = providerConfiguration?.microsoftClientId?.trim() ?? "";
  const [driveStatus, setDriveStatus] = useState("");
  const [googleDriveConnected, setGoogleDriveConnected] = useState(
    () => client.isGoogleDriveConnected?.() ?? false,
  );
  const [googleDriveAccount, setGoogleDriveAccount] = useState(
    () => client.getGoogleDriveAccount?.() ?? null,
  );
  const [oneDriveStatus, setOneDriveStatus] = useState("");
  const [privateEmailProvider, setPrivateEmailProvider] = useState<PrivateEmailProvider>("plus");
  const [privateEmailBase, setPrivateEmailBase] = useState("");
  const [privateEmailApiSecret, setPrivateEmailApiSecret] = useState("");
  const [privateEmailDomain, setPrivateEmailDomain] = useState("");
  const [privateEmailAutoFill, setPrivateEmailAutoFill] = useState(true);
  const [privateEmailStatus, setPrivateEmailStatus] = useState("");
  const [activeView, setActiveView] = useState<
    "authenticators" | "cloud" | "data" | "private-email" | "settings" | "tools" | "vault"
  >("vault");
  const recoveryContext = screenState.status === "unlocked" ? screenState.recovery.status : null;
  const itemRecoveryStatus = screenState.status === "unlocked" ? screenState.recovery.status : null;

  useEffect(() => {
    const attempt = loadAttempt;
    let active = true;
    const unsubscribe = client.subscribe((nextState) => {
      if (active) setScreenState(nextState);
    });
    setScreenState({ status: "preparing" });
    setError(null);
    void client
      .initialize()
      .then((nextState) => {
        if (active && attempt === loadAttempt) {
          setError(null);
          setScreenState(nextState);
        }
      })
      .catch(() => {
        if (active && attempt === loadAttempt) {
          setScreenState({ status: "load-failed" });
          setError(
            "Unable to read the encrypted local vault. Retry when local storage is available.",
          );
        }
      });
    return () => {
      active = false;
      unsubscribe();
      client.lock();
    };
  }, [client, loadAttempt]);

  function clearSecrets() {
    setMasterPassword("");
    setConfirmation("");
    setRecoveryKitInput("");
    setStepUpPassword("");
    setStepUpRecoveryKit("");
    setEnrollmentPassword("");
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setRestorePassword("");
    setRestoreConfirmation("");
  }

  useLayoutEffect(() => {
    if (screenState.status !== "unlocked" || recoveryContext !== "verified") {
      setMasterPassword("");
      setConfirmation("");
      setRecoveryKitInput("");
      setStepUpPassword("");
      setStepUpRecoveryKit("");
      setEnrollmentPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setRestorePassword("");
      setRestoreConfirmation("");
      setStepUpCompartment(null);
      setStepUpMethod("master-password");
    }
  }, [screenState.status, recoveryContext]);

  useEffect(() => {
    if (
      screenState.status !== "unlocked" ||
      itemRecoveryStatus !== "verified" ||
      client.listItems === undefined
    ) {
      setItems([]);
      setEditingItem(null);
      setHistoryItemId("");
      setItemHistory([]);
      return;
    }
    let active = true;
    void client
      .listItems()
      .then((nextItems) => {
        if (active) setItems(nextItems);
      })
      .catch(() => {
        if (active) setError("Unable to decrypt the local item list. The vault remains protected.");
      });
    return () => {
      active = false;
    };
  }, [client, screenState.status, itemRecoveryStatus]);

  useEffect(() => {
    const logins = items.filter(
      (item): item is Extract<VaultItemView, { type: "login" }> => item.type === "login",
    );
    const findings = analyzePasswordHealth(logins);
    setHealthFindings(Object.fromEntries(findings.map((finding) => [finding.id, finding])));
  }, [items]);

  useEffect(() => {
    const settingsItem = items.find(
      (item): item is Extract<VaultItemView, { type: "secure-note" }> =>
        item.type === "secure-note" && item.tags?.includes(PRIVATE_EMAIL_SETTINGS_TAG) === true,
    );
    if (settingsItem === undefined) return;
    const settings = readPrivateEmailSettings(settingsItem.note);
    if (settings === null) return;
    setPrivateEmailProvider(settings.provider);
    setPrivateEmailBase(settings.baseEmail);
    setPrivateEmailApiSecret(settings.apiSecret);
    setPrivateEmailDomain(settings.domain);
    setPrivateEmailAutoFill(settings.autoFill);
  }, [items]);

  async function createVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (masterPassword !== confirmation) {
      setMasterPassword("");
      setConfirmation("");
      setError("Passwords do not match.");
      return;
    }
    if (masterPassword.length === 0) {
      setMasterPassword("");
      setConfirmation("");
      setError("Enter a master password.");
      return;
    }
    const password = masterPassword;
    setMasterPassword("");
    setConfirmation("");
    setOperation("create");
    try {
      const nextState = await client.createVault(password);
      setScreenState(nextState);
    } catch (error) {
      const currentState = client.getState();
      setScreenState(currentState);
      setError(
        operationError(
          error,
          currentState.status === "locked"
            ? "A local vault already exists. Unlock it with its master password."
            : "Unable to create the encrypted local vault. Nothing was sent to a server.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function restoreVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (restorePassword.length === 0 || restorePassword !== restoreConfirmation) {
      setRestorePassword("");
      setRestoreConfirmation("");
      setRecoveryKitInput("");
      setError("Enter matching new master passwords for the restored vault.");
      return;
    }
    let encryptedVault: unknown;
    try {
      encryptedVault = JSON.parse(encryptedByosState);
    } catch {
      setRestorePassword("");
      setRestoreConfirmation("");
      setRecoveryKitInput("");
      setError("The encrypted BYOS state is not valid JSON.");
      return;
    }
    const newMasterPassword = restorePassword;
    const recoveryKit = recoveryKitInput;
    setRestorePassword("");
    setRestoreConfirmation("");
    setRecoveryKitInput("");
    setOperation("restore");
    try {
      const isArchive =
        typeof encryptedVault === "object" &&
        encryptedVault !== null &&
        "format" in encryptedVault &&
        encryptedVault.format === "zk-wallet-encrypted-archive";
      const nextState =
        isArchive && client.restoreEncryptedArchive !== undefined
          ? await client.restoreEncryptedArchive({
              archive: encryptedVault,
              newMasterPassword,
              recoveryKit,
            })
          : await client.restoreVault({
              encryptedVault,
              newMasterPassword,
              recoveryKit,
            });
      setEncryptedByosState("");
      setScreenState(nextState);
    } catch (error) {
      setError(
        operationError(
          error,
          "Unable to restore. Check the Recovery Kit and encrypted BYOS state.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function restoreGoogleDrive() {
    if (client.restoreFromGoogleDrive === undefined || googleClientId.trim().length === 0) {
      setError("Google Drive is not configured in this app build.");
      return;
    }
    if (restorePassword.length === 0 || restorePassword !== restoreConfirmation) {
      setError("Enter matching new master passwords for the restored vault.");
      return;
    }
    const request = {
      clientId: googleClientId.trim(),
      newMasterPassword: restorePassword,
      recoveryKit: recoveryKitInput,
    };
    setRestorePassword("");
    setRestoreConfirmation("");
    setRecoveryKitInput("");
    setOperation("restore");
    setError(null);
    try {
      setScreenState(await client.restoreFromGoogleDrive(request));
      setShowRestore(false);
    } catch {
      setError(
        "Unable to restore from Google Drive. Check authorization, the Recovery Kit, and the recovery archive.",
      );
    } finally {
      setOperation(null);
    }
  }

  async function restoreGoogleDriveWithMasterPassword() {
    if (
      client.restoreFromGoogleDriveWithMasterPassword === undefined ||
      googleClientId.trim().length === 0
    ) {
      setError("Google Drive restore is not configured in this app build.");
      return;
    }
    if (googleRestorePassword.length === 0) {
      setError("Enter the existing master password for this vault.");
      return;
    }
    setOperation("restore");
    setError(null);
    try {
      const next = await client.restoreFromGoogleDriveWithMasterPassword({
        clientId: googleClientId.trim(),
        masterPassword: googleRestorePassword,
        selectAccount: true,
      });
      setGoogleRestorePassword("");
      setScreenState(next);
      setGoogleDriveConnected(true);
      setGoogleDriveAccount(client.getGoogleDriveAccount?.() ?? null);
      setShowRestore(false);
    } catch (error) {
      setError(
        operationError(
          error,
          "Unable to open the Google Drive vault. Check the selected Google account and master password.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function restoreOneDrive() {
    if (client.restoreFromOneDrive === undefined || microsoftClientId.trim().length === 0) {
      setError("OneDrive is not configured in this app build.");
      return;
    }
    if (restorePassword.length === 0 || restorePassword !== restoreConfirmation) {
      setError("Enter matching new master passwords for the restored vault.");
      return;
    }
    const request = {
      clientId: microsoftClientId.trim(),
      newMasterPassword: restorePassword,
      recoveryKit: recoveryKitInput,
    };
    setRestorePassword("");
    setRestoreConfirmation("");
    setRecoveryKitInput("");
    setOperation("restore");
    setError(null);
    try {
      setScreenState(await client.restoreFromOneDrive(request));
      setShowRestore(false);
    } catch {
      setError(
        "Unable to restore from OneDrive. Check authorization, the Recovery Kit, and the encrypted recovery archive.",
      );
    } finally {
      setOperation(null);
    }
  }

  async function verifyRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const recoveryKit = recoveryKitInput;
    setRecoveryKitInput("");
    setOperation("recovery-verify");
    try {
      const nextState = await client.verifyRecoveryKit(recoveryKit);
      setScreenState(nextState);
      if (nextState.status === "unlocked" && nextState.recovery.status === "verified") {
        if (
          setupDestination === "google" &&
          client.syncGoogleDrive !== undefined &&
          googleClientId !== ""
        ) {
          setDriveStatus("Connecting the new encrypted vault to Google Drive…");
          try {
            const result = await client.syncGoogleDrive({ clientId: googleClientId });
            setGoogleDriveConnected(true);
            setGoogleDriveAccount(result.accountEmail ?? client.getGoogleDriveAccount?.() ?? null);
            setDriveStatus(
              `Cloud vault ready: ${result.revisionCount} encrypted revision(s), ${result.uploaded} uploaded.`,
            );
            setActiveView("settings");
          } catch (cloudError) {
            setDriveStatus(
              cloudOperationError(
                "Google Drive",
                cloudError,
                "The vault is safe locally, but its first cloud sync did not complete. Retry from Settings.",
              ),
            );
          }
        } else if (
          setupDestination === "onedrive" &&
          client.syncOneDrive !== undefined &&
          microsoftClientId !== ""
        ) {
          setOneDriveStatus("Connecting the new encrypted vault to OneDrive…");
          try {
            const result = await client.syncOneDrive({ clientId: microsoftClientId });
            setOneDriveStatus(
              `Cloud vault ready: ${result.revisionCount} encrypted revision(s), ${result.uploaded} uploaded.`,
            );
            setActiveView("settings");
          } catch {
            setOneDriveStatus(
              "The vault is safe locally, but its first OneDrive sync did not complete. Retry from Settings.",
            );
          }
        }
      }
    } catch (error) {
      setError(
        operationError(
          error,
          "Recovery Kit verification failed. Re-enter the complete kit exactly.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function replaceRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = masterPassword;
    setMasterPassword("");
    setOperation("recovery-replace");
    try {
      const nextState = await client.replaceRecoveryKit(password);
      setScreenState(nextState);
    } catch (error) {
      setError(operationError(error, "Unable to create a replacement Recovery Kit."));
    } finally {
      setOperation(null);
    }
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (masterPassword.length === 0) {
      setMasterPassword("");
      setError("Enter your master password.");
      return;
    }
    const password = masterPassword;
    setMasterPassword("");
    setOperation("unlock");
    try {
      const nextState = await client.unlock(password);
      setScreenState(nextState);
    } catch (error) {
      setError(operationError(error, "Unable to unlock. Check the password or local vault data."));
    } finally {
      setOperation(null);
    }
  }

  async function unlockRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const recoveryKit = recoveryKitInput;
    setRecoveryKitInput("");
    setOperation("recovery-unlock");
    try {
      const nextState = await client.unlockWithRecoveryKit(recoveryKit);
      setScreenState(nextState);
    } catch (error) {
      setError(
        operationError(error, "Unable to unlock. Check the Recovery Kit or local vault data."),
      );
    } finally {
      setOperation(null);
    }
  }

  async function unlockDevice(slotId: string) {
    setError(null);
    setMasterPassword("");
    setRecoveryKitInput("");
    setOperation("device-unlock");
    try {
      setScreenState(await client.unlockWithDevice(slotId));
    } catch (error) {
      setError(
        operationError(
          error,
          "Device unlock failed or is unavailable. Use your password or Recovery Kit.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function confirmStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepUpCompartment === null) return;
    const compartment = stepUpCompartment;
    const credential: StepUpCredential =
      stepUpMethod === "recovery-kit"
        ? { recoveryKit: stepUpRecoveryKit, type: "recovery-kit" }
        : { password: stepUpPassword, type: "master-password" };
    setError(null);
    setStepUpPassword("");
    setStepUpRecoveryKit("");
    setOperation("step-up");
    try {
      const nextState = await client.stepUpCompartment(compartment, credential);
      setStepUpCompartment(null);
      setScreenState(nextState);
    } catch (error) {
      setError(operationError(error, "Step-up failed. The sensitive compartment remains sealed."));
    } finally {
      setOperation(null);
    }
  }

  async function deviceStepUp(compartment: SensitiveCompartment, slotId: string) {
    setError(null);
    setStepUpPassword("");
    setStepUpRecoveryKit("");
    setOperation("step-up");
    try {
      setScreenState(await client.stepUpCompartment(compartment, { slotId, type: "device" }));
      setStepUpCompartment(null);
    } catch (error) {
      setError(
        operationError(error, "Device step-up failed. The sensitive compartment remains sealed."),
      );
    } finally {
      setOperation(null);
    }
  }

  async function enrollDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = enrollmentPassword;
    setEnrollmentPassword("");
    setOperation("device-enroll");
    try {
      setScreenState(await client.enrollDevice(password));
    } catch (error) {
      setError(
        deviceEnrollmentError(
          error,
          "Touch ID is unavailable on this device. You can still use your master password or Recovery Kit.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword.length === 0 || newPassword !== newPasswordConfirmation) {
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setError("New master passwords do not match.");
      return;
    }
    const request = { currentPassword, newPassword };
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setOperation("change-password");
    try {
      setScreenState(await client.changeMasterPassword(request));
    } catch (error) {
      setError(
        operationError(
          error,
          "Unable to change the master password. Existing encrypted data was not rewritten.",
        ),
      );
    } finally {
      setOperation(null);
    }
  }

  async function revokeDevice(slotId: string) {
    setError(null);
    setOperation("revoke");
    try {
      setScreenState(await client.revokeDevice(slotId));
    } catch (error) {
      setError(
        operationError(error, "Unable to revoke the device slot. No partial change was saved."),
      );
    } finally {
      setOperation(null);
    }
  }

  function lockVault() {
    setError(null);
    clearSecrets();
    setStepUpCompartment(null);
    setScreenState(client.lock());
  }

  function clearItemForm(options: { readonly keepOpen?: boolean } = {}) {
    setEditingItem(null);
    setItemEditorOpen(options.keepOpen === true);
    setItemTitle("");
    setItemUsername("");
    setItemPassword("");
    setItemUris("");
    setItemBody("");
    setItemTotpUri("");
    setItemPasskeys([]);
    setItemFolder("");
    setItemTags("");
    setItemFavorite(false);
    setProfileFields(EMPTY_PROFILE);
    setPaymentCard(EMPTY_PAYMENT_CARD);
    setTotpImportStatus("");
  }

  function editItem(item: VaultItemView) {
    setEditingItem(item);
    setItemEditorOpen(true);
    setItemType(item.type);
    setItemTitle(item.title);
    setItemFolder(item.folder ?? "");
    setItemTags(item.tags?.join(", ") ?? "");
    setItemFavorite(item.favorite ?? false);
    if (item.type === "login") {
      setItemUsername(item.username);
      setItemPassword(item.password);
      setItemUris(item.uris.join("\n"));
      setItemBody(item.notes);
      setItemTotpUri(item.totpUri ?? "");
      setItemPasskeys(item.passkeys ?? []);
      setProfileFields(EMPTY_PROFILE);
      setPaymentCard(EMPTY_PAYMENT_CARD);
    } else if (item.type === "identity-profile") {
      setItemUsername("");
      setItemPassword("");
      setItemUris("");
      setItemBody("");
      setItemTotpUri("");
      setItemPasskeys([]);
      setProfileFields(
        Object.fromEntries(
          PROFILE_FIELDS.map(({ key }) => [key, item[key]]),
        ) as unknown as Readonly<Record<ProfileField, string>>,
      );
      setPaymentCard(EMPTY_PAYMENT_CARD);
    } else if (item.type === "payment-card") {
      setItemUsername("");
      setItemPassword("");
      setItemUris("");
      setItemBody("");
      setItemTotpUri("");
      setItemPasskeys([]);
      setProfileFields(EMPTY_PROFILE);
      setPaymentCard({
        billingAddress: item.billingAddress,
        cardNumber: item.cardNumber,
        cardholderName: item.cardholderName,
        expiryMonth: item.expiryMonth,
        expiryYear: item.expiryYear,
        notes: item.notes,
        securityCode: item.securityCode,
        title: item.title,
      });
    } else {
      setItemUsername("");
      setItemPassword("");
      setItemUris("");
      setItemBody(item.note);
      setItemTotpUri("");
      setItemPasskeys([]);
      setProfileFields(EMPTY_PROFILE);
      setPaymentCard(EMPTY_PAYMENT_CARD);
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOperation("item");
    try {
      if (itemType === "login") {
        if (itemTotpUri !== "") parseOtpAuthUri(itemTotpUri);
        const exposure =
          itemPassword.length === 0
            ? ({ reason: "network", status: "unavailable" } as const)
            : await checkPwnedPassword(itemPassword);
        setHealthStatus(
          exposure.status === "unavailable"
            ? "The encrypted login was saved, but automatic breach checking was unavailable."
            : "Automatic breach check complete. Only a five-character hash prefix was sent.",
        );
        const organization = {
          favorite: itemFavorite,
          folder: itemFolder.trim(),
          tags: [
            ...new Set(
              itemTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
        };
        const input = {
          ...organization,
          breachCheck: persistedBreachCheck(exposure),
          notes: itemBody,
          password: itemPassword,
          ...(itemPasskeys.length === 0 ? {} : { passkeys: itemPasskeys }),
          title: itemTitle,
          totpUri: itemTotpUri.trim(),
          uris: itemUris
            .split(/\r?\n/u)
            .map((uri) => uri.trim())
            .filter(Boolean),
          username: itemUsername,
          ...(editingItem?.type === "login" && editingItem.emailAlias !== undefined
            ? { emailAlias: editingItem.emailAlias }
            : {}),
        };
        let saved: VaultItemView;
        if (editingItem?.type === "login") {
          if (client.updateLogin === undefined) throw new Error();
          saved = await client.updateLogin(editingItem.id, editingItem.revisionId, input);
        } else {
          if (client.createLogin === undefined) throw new Error();
          saved = await client.createLogin(input);
        }
        if (saved.type === "login") {
          setPwnedResults((current) => ({ ...current, [saved.id]: exposure }));
        }
      } else if (itemType === "identity-profile") {
        const input: IdentityProfileInputView = {
          ...profileFields,
          favorite: itemFavorite,
          folder: itemFolder.trim(),
          tags: [
            ...new Set(
              itemTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
          title: itemTitle,
        };
        if (editingItem?.type === "identity-profile") {
          if (client.updateIdentityProfile === undefined) throw new Error();
          await client.updateIdentityProfile(editingItem.id, editingItem.revisionId, input);
        } else {
          if (client.createIdentityProfile === undefined) throw new Error();
          await client.createIdentityProfile(input);
        }
      } else if (itemType === "payment-card") {
        const input: PaymentCardInputView = {
          ...paymentCard,
          favorite: itemFavorite,
          folder: itemFolder.trim(),
          tags: [
            ...new Set(
              itemTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
          title: itemTitle,
        };
        if (editingItem?.type === "payment-card") {
          if (client.updatePaymentCard === undefined) throw new Error();
          await client.updatePaymentCard(editingItem.id, editingItem.revisionId, input);
        } else {
          if (client.createPaymentCard === undefined) throw new Error();
          await client.createPaymentCard(input);
        }
      } else {
        const input = {
          favorite: itemFavorite,
          folder: itemFolder.trim(),
          note: itemBody,
          tags: [
            ...new Set(
              itemTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
          title: itemTitle,
        };
        if (editingItem?.type === "secure-note") {
          if (client.updateSecureNote === undefined) throw new Error();
          await client.updateSecureNote(editingItem.id, editingItem.revisionId, input);
        } else {
          if (client.createSecureNote === undefined) throw new Error();
          await client.createSecureNote(input);
        }
      }
      clearItemForm();
      setItems((await client.listItems?.()) ?? []);
    } catch {
      setItemPassword("");
      setError(
        "Unable to save the encrypted item. Check the fields or reload a concurrent change.",
      );
    } finally {
      setOperation(null);
    }
  }

  async function deleteItem(item: VaultItemView) {
    if (client.deleteItem === undefined || !globalThis.confirm?.(`Delete “${item.title}”?`)) return;
    setError(null);
    setOperation("item");
    try {
      await client.deleteItem(item.id, item.revisionId);
      clearItemForm();
      if (historyItemId === item.id) {
        setHistoryItemId("");
        setItemHistory([]);
      }
      setItems((await client.listItems?.()) ?? []);
    } catch {
      setError("Unable to delete the item. It may have changed in another view.");
    } finally {
      setOperation(null);
    }
  }

  async function showItemHistory(item: VaultItemView) {
    if (historyItemId === item.id) {
      setHistoryItemId("");
      setItemHistory([]);
      return;
    }
    if (client.listItemHistory === undefined) return;
    setError(null);
    setOperation("item");
    try {
      setItemHistory(await client.listItemHistory(item.id));
      setHistoryItemId(item.id);
    } catch {
      setError("Unable to open this item's encrypted revision history.");
    } finally {
      setOperation(null);
    }
  }

  async function restoreItemHistoryEntry(item: VaultItemView, entry: VaultItemHistoryEntryView) {
    if (entry.item === null || client.restoreItemRevision === undefined) return;
    setError(null);
    setOperation("item");
    try {
      await client.restoreItemRevision(item.id, entry.revisionId, item.revisionId);
      setItems((await client.listItems?.()) ?? []);
      setItemHistory((await client.listItemHistory?.(item.id)) ?? []);
    } catch {
      setError("Unable to restore that version. Reload the item before resolving a newer change.");
    } finally {
      setOperation(null);
    }
  }

  async function createItemShare(item: VaultItemView) {
    if (client.createItemShare === undefined) return;
    setError(null);
    setOperation("item");
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const value = await client.createItemShare(item.id, expiresAt);
      setCreatedShare({ title: item.title, value });
    } catch {
      setError("Unable to create the encrypted share. The item remains private in your vault.");
    } finally {
      setOperation(null);
    }
  }

  function downloadItemShare() {
    if (createdShare === null) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(createdShare.value.bundle)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `veyrakey-share-${createdShare.value.bundle.shareId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function savePrivateEmailSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPrivateEmailStatus("");
    let settings: Record<string, unknown>;
    if (privateEmailProvider === "plus") {
      const baseEmail = privateEmailBase.trim();
      if (!/^[^\s@]+@[^\s@]+$/u.test(baseEmail)) {
        setPrivateEmailStatus("Enter the inbox that should receive plus-addressed mail.");
        return;
      }
      settings = { autoFill: privateEmailAutoFill, baseEmail, provider: "plus", version: 1 };
    } else if (privateEmailProvider === "simplelogin") {
      if (privateEmailApiSecret.trim().length === 0) {
        setPrivateEmailStatus("Enter your SimpleLogin API code.");
        return;
      }
      settings = {
        apiCode: privateEmailApiSecret.trim(),
        autoFill: privateEmailAutoFill,
        provider: "simplelogin",
        version: 1,
      };
    } else {
      if (
        privateEmailApiSecret.trim().length === 0 ||
        !/^[^\s/@]+(?:\.[^\s/@]+)+$/u.test(privateEmailDomain.trim())
      ) {
        setPrivateEmailStatus("Enter your Addy.io API token and alias domain.");
        return;
      }
      settings = {
        apiToken: privateEmailApiSecret.trim(),
        autoFill: privateEmailAutoFill,
        domain: privateEmailDomain.trim().toLocaleLowerCase(),
        provider: "addy",
        version: 1,
      };
    }
    setOperation("item");
    try {
      const input = {
        folder: PRIVATE_EMAIL_SETTINGS_FOLDER,
        note: JSON.stringify(settings),
        tags: [PRIVATE_EMAIL_SETTINGS_TAG],
        title: PRIVATE_EMAIL_SETTINGS_TITLE,
      };
      const existing = items.find(
        (item): item is Extract<VaultItemView, { type: "secure-note" }> =>
          item.type === "secure-note" && item.tags?.includes(PRIVATE_EMAIL_SETTINGS_TAG) === true,
      );
      if (existing === undefined) {
        if (client.createSecureNote === undefined) throw new Error("Secure notes unavailable");
        await client.createSecureNote(input);
      } else {
        if (client.updateSecureNote === undefined)
          throw new Error("Secure note updates unavailable");
        await client.updateSecureNote(existing.id, existing.revisionId, input);
      }
      setItems((await client.listItems?.()) ?? []);
      setPrivateEmailStatus("Private email settings saved in the encrypted vault.");
    } catch {
      setPrivateEmailStatus("Unable to save private email settings.");
    } finally {
      setOperation(null);
    }
  }

  const busy = operation !== null;
  const recoveryDrill =
    screenState.status === "unlocked" && screenState.recovery.status === "pending";
  const recoveryReplacement =
    screenState.status === "unlocked" && screenState.recovery.status === "replacement-required";
  const deviceSlots =
    screenState.status === "locked" || screenState.status === "unlocked"
      ? screenState.deviceUnlock.slots
      : [];
  const selectedDeviceSlotId = deviceSlots.some((slot) => slot.id === deviceSlotId)
    ? deviceSlotId
    : (deviceSlots[0]?.id ?? "");
  const normalizedSearch = itemSearch.trim().toLocaleLowerCase();
  const libraryItems = items.filter(
    (item) => !(item.type === "secure-note" && item.tags?.includes(PRIVATE_EMAIL_SETTINGS_TAG)),
  );
  const visibleItems =
    normalizedSearch === ""
      ? libraryItems
      : libraryItems.filter((item) =>
          [
            item.title,
            item.folder ?? "",
            ...(item.tags ?? []),
            item.type === "login"
              ? item.username
              : item.type === "identity-profile"
                ? `${item.firstName} ${item.lastName} ${item.email} ${item.city} ${item.country}`
                : "",
          ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
        );
  const loginItems = items.filter(
    (item): item is Extract<VaultItemView, { type: "login" }> => item.type === "login",
  );
  const authenticatorItems = loginItems.filter(
    (item) => item.totpUri !== undefined || (item.passkeys?.length ?? 0) > 0,
  );
  const authenticatorCount = authenticatorItems.reduce(
    (count, item) => count + (item.totpUri === undefined ? 0 : 1) + (item.passkeys?.length ?? 0),
    0,
  );
  const securityRecommendations = loginItems.flatMap((item) => {
    const finding = healthFindings[item.id];
    const breach =
      pwnedResults[item.id] ??
      (item.breachCheck?.status === "found"
        ? ({ count: item.breachCheck.count, status: "found" } as const)
        : item.breachCheck?.status === "not-found"
          ? ({ status: "not-found" } as const)
          : item.breachCheck?.status === "unavailable"
            ? ({ reason: "network", status: "unavailable" } as const)
            : undefined);
    const issue =
      breach?.status === "found"
        ? {
            detail: `Appeared ${breach.count.toLocaleString()} ${breach.count === 1 ? "time" : "times"} in known breach data`,
            kind: "compromised" as const,
            label: "Compromised password",
          }
        : finding?.reused
          ? {
              detail: "This password is also used by another saved login",
              kind: "reused" as const,
              label: "Reused password",
            }
          : finding?.weak
            ? {
                detail: "This password does not meet the local strength policy",
                kind: "weak" as const,
                label: "Weak password",
              }
            : null;
    return issue === null ? [] : [{ breach, finding, issue, item }];
  });
  const selectedSecurityRecommendation =
    securityRecommendations.find(({ item }) => item.id === selectedHealthItemId) ??
    securityRecommendations[0];

  async function revealTotp(item: Extract<VaultItemView, { type: "login" }>) {
    if (item.totpUri === undefined || item.totpUri === "") return;
    try {
      const result = await generateTotp(parseOtpAuthUri(item.totpUri), Date.now());
      setTotpCodes((current) => ({ ...current, [item.id]: result.code }));
    } catch {
      setError("The encrypted authenticator configuration is invalid.");
    }
  }

  async function copySecret(secret: string) {
    if (navigator.clipboard === undefined) {
      setError("Clipboard access is unavailable on this surface.");
      return;
    }
    try {
      await copyWithBestEffortClear({
        clearAfterMilliseconds: 30_000,
        clipboard: navigator.clipboard,
        secret,
      });
    } catch {
      setError("Copy failed. Clipboard clearing is best effort and unavailable here.");
    }
  }

  function previewImport() {
    setError(null);
    try {
      const existing = items.filter(
        (item): item is Extract<VaultItemView, { type: "login" }> => item.type === "login",
      );
      const preview =
        importSource === "csv"
          ? previewGenericCsv(importText, existing)
          : previewBitwardenJson(importText, existing);
      setImportPreview(preview);
      setSelectedImportRows(
        new Set(
          preview.rows
            .filter((row) => row.status === "valid" && !row.warnings.includes("duplicate"))
            .map((row) => row.index),
        ),
      );
    } catch {
      setImportPreview(null);
      setSelectedImportRows(new Set());
      setError("The import file is malformed, unsupported, or exceeds the safe limits.");
    }
  }

  async function commitImport() {
    if (importPreview === null || client.importItems === undefined) {
      setError("Atomic encrypted import is unavailable.");
      return;
    }
    setOperation("item");
    setError(null);
    try {
      const selected = selectedImportRequests(importPreview, [...selectedImportRows]);
      if (selected.length === 0) throw new Error();
      const requests = await Promise.all(
        selected.map(async (request) =>
          request.type === "login"
            ? {
                ...request,
                input: {
                  ...request.input,
                  breachCheck: persistedBreachCheck(
                    await checkPwnedPassword(request.input.password),
                  ),
                },
              }
            : request,
        ),
      );
      await client.importItems(requests);
      setItems((await client.listItems?.()) ?? []);
      setImportText("");
      setImportPreview(null);
      setSelectedImportRows(new Set());
    } catch {
      setError("Import was rolled back; no partial batch was committed.");
    } finally {
      setOperation(null);
    }
  }

  async function downloadEncryptedArchive() {
    if (client.exportEncryptedArchive === undefined) {
      setError("Encrypted archive export is unavailable.");
      return;
    }
    try {
      const archive = await client.exportEncryptedArchive();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(archive)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "veyrakey-encrypted-backup.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Encrypted archive export failed; no plaintext export was created.");
    }
  }

  function analyzeLocalPasswords() {
    const logins = items.filter(
      (item): item is Extract<VaultItemView, { type: "login" }> => item.type === "login",
    );
    const findings = analyzePasswordHealth(logins);
    setHealthFindings(Object.fromEntries(findings.map((finding) => [finding.id, finding])));
    setHealthStatus("Security recommendations updated on this device.");
  }

  async function checkPasswordExposure(item: Extract<VaultItemView, { type: "login" }>) {
    setHealthStatus("Checking a five-character hash prefix with padded responses…");
    const result = await checkPwnedPassword(item.password);
    setPwnedResults((current) => ({ ...current, [item.id]: result }));
    if (client.updateLogin !== undefined) {
      const updated = await client.updateLogin(item.id, item.revisionId, {
        ...(item.favorite === undefined ? {} : { favorite: item.favorite }),
        ...(item.folder === undefined ? {} : { folder: item.folder }),
        ...(item.emailAlias === undefined ? {} : { emailAlias: item.emailAlias }),
        ...(item.passkeys === undefined ? {} : { passkeys: item.passkeys }),
        ...(item.tags === undefined ? {} : { tags: item.tags }),
        breachCheck: persistedBreachCheck(result),
        notes: item.notes,
        password: item.password,
        title: item.title,
        ...(item.totpUri === undefined ? {} : { totpUri: item.totpUri }),
        uris: item.uris,
        username: item.username,
      });
      setItems((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    }
    setHealthStatus(
      result.status === "unavailable"
        ? "Breach checking is unavailable or the response was invalid. Local analysis still works offline."
        : "Breach check complete. The password itself was not sent.",
    );
  }

  async function syncGoogleDrive(selectAccount = false) {
    if (client.syncGoogleDrive === undefined || googleClientId.trim().length === 0) {
      setError("Google Drive is not configured in this app build.");
      return;
    }
    setOperation("item");
    setError(null);
    setDriveStatus("Waiting for Google Drive authorization…");
    try {
      const result = await client.syncGoogleDrive({
        clientId: googleClientId,
        selectAccount,
      });
      setGoogleDriveConnected(true);
      setGoogleDriveAccount(result.accountEmail ?? client.getGoogleDriveAccount?.() ?? null);
      setItems((await client.listItems?.()) ?? []);
      setDriveStatus(
        `Sync complete: ${result.revisionCount} encrypted revision(s), ${result.uploaded} uploaded, ${result.conflicts.length} conflict(s), ${result.quarantined} quarantined.`,
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "DRIVE_AUTH") setGoogleDriveConnected(false);
      setDriveStatus(
        code === "DRIVE_AUTH"
          ? "Google authorization expired or was revoked. Connect again to retry."
          : code === "DRIVE_QUOTA"
            ? "Google Drive quota is exhausted. Local encrypted data remains available."
            : operationError(
                error,
                cloudOperationError(
                  "Google Drive",
                  error,
                  "Drive sync did not complete. You can keep working locally and retry when online.",
                ),
              ),
      );
    } finally {
      setOperation(null);
    }
  }

  function disconnectGoogleDrive() {
    client.disconnectGoogleDrive?.();
    setGoogleDriveConnected(false);
    setGoogleDriveAccount(null);
    setDriveStatus("Signed out of Google Drive. The local encrypted vault remains available.");
  }

  async function syncOneDrive() {
    if (client.syncOneDrive === undefined || microsoftClientId.trim().length === 0) {
      setError("OneDrive is not configured in this app build.");
      return;
    }
    setOperation("item");
    setError(null);
    setOneDriveStatus("Waiting for Microsoft authorization…");
    try {
      const result = await client.syncOneDrive({ clientId: microsoftClientId.trim() });
      setItems((await client.listItems?.()) ?? []);
      setOneDriveStatus(
        `Sync complete: ${result.revisionCount} encrypted revision(s), ${result.uploaded} uploaded, ${result.conflicts.length} conflict(s), ${result.quarantined} quarantined.`,
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      setOneDriveStatus(
        code === "ONEDRIVE_AUTH"
          ? "Microsoft authorization expired or was revoked. Connect again to retry."
          : code === "ONEDRIVE_QUOTA"
            ? "OneDrive quota is exhausted. Local encrypted data remains available."
            : "OneDrive sync did not complete. You can keep working locally and retry.",
      );
    } finally {
      setOperation(null);
    }
  }

  function disconnectOneDrive() {
    client.disconnectOneDrive?.();
    setOneDriveStatus("OneDrive disconnected. No OAuth token was persisted.");
  }

  return (
    <main
      className="vault-shell"
      onKeyDown={() => client.recordActivity()}
      onPointerDown={() => client.recordActivity()}
    >
      <section
        className={
          screenState.status === "unlocked" && screenState.recovery.status === "verified"
            ? "vault-card vault-card-unlocked"
            : "vault-card"
        }
        aria-labelledby="vault-status-title"
      >
        <Header surface={surface} />

        {screenState.status === "preparing" ? (
          <div className="vault-copy" role="status" aria-live="polite">
            <p className="eyebrow">Encrypted local bootstrap</p>
            <h1 id="vault-status-title">Preparing vault</h1>
            <p className="vault-description">Checking this browser for encrypted vault data.</p>
          </div>
        ) : null}

        {screenState.status === "load-failed" ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Encrypted local bootstrap</p>
              <h1 id="vault-status-title">Vault unavailable</h1>
              <p className="vault-description">
                The client could not safely read encrypted vault data from this browser.
              </p>
            </div>
            <PrivacyNote state={screenState} />
            <div className="vault-actions">
              <ErrorMessage error={error} />
              <button
                className="action-button"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                type="button"
              >
                Retry vault loading
              </button>
            </div>
          </>
        ) : null}

        {screenState.status === "needs-setup" && !showRestore ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Choose how to use VeyraKey</p>
              <h1 id="vault-status-title">Set up your vault</h1>
              <p className="vault-description">
                Use a private local vault without an account, or connect your Google account for
                encrypted sync and access from your other devices.
              </p>
            </div>
            <PrivacyNote state={screenState} />
            <form className="vault-form" onSubmit={createVault}>
              <fieldset className="setup-options">
                <legend>Vault storage</legend>
                {client.syncGoogleDrive === undefined ? null : (
                  <label
                    className={`setup-option${setupDestination === "google" ? " setup-option-active" : ""}`}
                  >
                    <input
                      checked={setupDestination === "google"}
                      disabled={busy || googleClientId === ""}
                      name="setup-destination"
                      onChange={() => setSetupDestination("google")}
                      type="radio"
                    />
                    <span>
                      <strong>Continue with Google</strong>
                      <small>
                        Recommended · encrypted sync · use the same vault on other devices
                      </small>
                    </span>
                  </label>
                )}
                {client.syncOneDrive === undefined ? null : (
                  <label
                    className={`setup-option${setupDestination === "onedrive" ? " setup-option-active" : ""}`}
                  >
                    <input
                      checked={setupDestination === "onedrive"}
                      disabled={busy || microsoftClientId === ""}
                      name="setup-destination"
                      onChange={() => setSetupDestination("onedrive")}
                      type="radio"
                    />
                    <span>
                      <strong>Microsoft OneDrive</strong>
                      <small>Encrypted application folder · multi-device restore</small>
                    </span>
                  </label>
                )}
                <label
                  className={`setup-option${setupDestination === "local" ? " setup-option-active" : ""}`}
                >
                  <input
                    checked={setupDestination === "local"}
                    disabled={busy}
                    name="setup-destination"
                    onChange={() => setSetupDestination("local")}
                    type="radio"
                  />
                  <span>
                    <strong>Use without an account</strong>
                    <small>
                      Local vault on this device · connect to Google later if you choose
                    </small>
                  </span>
                </label>
              </fieldset>
              <label className="vault-field">
                <span>Master password</span>
                <input
                  autoComplete="new-password"
                  className="vault-input"
                  disabled={busy}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  spellCheck={false}
                  type="password"
                  value={masterPassword}
                />
              </label>
              <label className="vault-field">
                <span>Confirm master password</span>
                <input
                  autoComplete="new-password"
                  className="vault-input"
                  disabled={busy}
                  onChange={(event) => setConfirmation(event.target.value)}
                  spellCheck={false}
                  type="password"
                  value={confirmation}
                />
              </label>
              <p className="form-guidance">
                {setupDestination === "local"
                  ? "No registration or cloud connection. Your encrypted vault stays on this device."
                  : "Google sign-in stores only encrypted vault data. Your master password and keys never leave this device."}
              </p>
              <ErrorMessage error={error} />
              {operation === "create" ? (
                <p className="operation-status" role="status" aria-live="polite">
                  Creating independent encrypted key slots locally…
                </p>
              ) : null}
              <button
                aria-label="Create encrypted vault"
                className="action-button"
                disabled={busy}
                type="submit"
              >
                {operation === "create"
                  ? "Creating encrypted vault…"
                  : setupDestination === "local"
                    ? "Create local-only vault"
                    : "Create and connect encrypted vault"}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setMasterPassword("");
                  setConfirmation("");
                  setShowRestore(true);
                }}
                type="button"
              >
                I already have a vault
              </button>
            </form>
          </>
        ) : null}

        {screenState.status === "needs-setup" && showRestore ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Clean-profile recovery</p>
              <h1 id="vault-status-title">Open your existing vault</h1>
              <p className="vault-description">
                Sign in to the Google account that stores your encrypted vault, then unlock it
                locally with its existing master password.
              </p>
            </div>
            <form className="vault-form" onSubmit={restoreVault}>
              {client.restoreFromGoogleDriveWithMasterPassword === undefined ? null : (
                <>
                  <label className="vault-field">
                    <span>Existing master password</span>
                    <input
                      autoComplete="current-password"
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setGoogleRestorePassword(event.target.value)}
                      type="password"
                      value={googleRestorePassword}
                    />
                  </label>
                  <button
                    className="action-button"
                    disabled={busy || googleClientId.trim().length === 0}
                    onClick={() => void restoreGoogleDriveWithMasterPassword()}
                    type="button"
                  >
                    Sign in with Google and open vault
                  </button>
                  <p className="form-guidance">
                    Google authorizes access to encrypted app data. Decryption still happens only on
                    this device.
                  </p>
                </>
              )}
              <details className="transfer-disclosure">
                <summary>Use a Recovery Kit or encrypted backup</summary>
                <div className="transfer-fields">
                  <label className="vault-field">
                    <span>Encrypted backup contents</span>
                    <textarea
                      className="vault-input vault-textarea"
                      disabled={busy}
                      onChange={(event) => setEncryptedByosState(event.target.value)}
                      spellCheck={false}
                      value={encryptedByosState}
                    />
                  </label>
                  <label className="vault-field">
                    <span>Recovery Kit</span>
                    <textarea
                      className="vault-input vault-textarea"
                      disabled={busy}
                      onChange={(event) => setRecoveryKitInput(event.target.value)}
                      spellCheck={false}
                      value={recoveryKitInput}
                    />
                  </label>
                  <label className="vault-field">
                    <span>New master password</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setRestorePassword(event.target.value)}
                      type="password"
                      value={restorePassword}
                    />
                  </label>
                  <label className="vault-field">
                    <span>Confirm new master password</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setRestoreConfirmation(event.target.value)}
                      type="password"
                      value={restoreConfirmation}
                    />
                  </label>
                  <button className="secondary-button" disabled={busy} type="submit">
                    Restore encrypted backup
                  </button>
                  {client.restoreFromGoogleDrive === undefined ? null : (
                    <button
                      className="secondary-button"
                      disabled={busy || googleClientId.trim().length === 0}
                      onClick={() => void restoreGoogleDrive()}
                      type="button"
                    >
                      Recover Google vault with Recovery Kit
                    </button>
                  )}
                  {client.restoreFromOneDrive === undefined ? null : (
                    <button
                      className="secondary-button"
                      disabled={busy || microsoftClientId.trim().length === 0}
                      onClick={() => void restoreOneDrive()}
                      type="button"
                    >
                      Recover OneDrive vault with Recovery Kit
                    </button>
                  )}
                </div>
              </details>
              <ErrorMessage error={error} />
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  clearSecrets();
                  setGoogleRestorePassword("");
                  setShowRestore(false);
                }}
                type="button"
              >
                Back
              </button>
            </form>
          </>
        ) : null}

        {screenState.status === "locked" ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Passwords</p>
              <h1 id="vault-status-title">Unlock</h1>
              <p className="vault-description">Use biometrics or your master password.</p>
            </div>
            {screenState.deviceUnlock.available && selectedDeviceSlotId !== "" ? (
              <div className="vault-actions">
                {screenState.deviceUnlock.slots.length > 1 ? (
                  <label className="vault-field">
                    <span>Device unlock credential</span>
                    <select
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setDeviceSlotId(event.target.value)}
                      value={selectedDeviceSlotId}
                    >
                      {screenState.deviceUnlock.slots.map((slot, index) => (
                        <option key={slot.id} value={slot.id}>
                          Enrolled device {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  className="action-button"
                  disabled={busy}
                  onClick={() => void unlockDevice(selectedDeviceSlotId)}
                  type="button"
                >
                  Use biometrics
                </button>
              </div>
            ) : screenState.deviceUnlock.slots.length > 0 ? (
              <p className="capability-note">
                Device PRF unlock is unavailable on this surface. Password and Recovery Kit fallback
                remain available.
              </p>
            ) : null}
            {!showRecoveryUnlock ? (
              <form className="vault-form" onSubmit={unlockVault}>
                <label className="vault-field">
                  <span>Master password</span>
                  <input
                    autoComplete="current-password"
                    className="vault-input"
                    disabled={busy}
                    onChange={(event) => setMasterPassword(event.target.value)}
                    spellCheck={false}
                    type="password"
                    value={masterPassword}
                  />
                </label>
                <ErrorMessage error={error} />
                <button className="action-button" disabled={busy} type="submit">
                  {operation === "unlock" ? "Unlocking…" : "Unlock"}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setMasterPassword("");
                    setShowRecoveryUnlock(true);
                  }}
                  type="button"
                >
                  Recovery Kit
                </button>
              </form>
            ) : (
              <form className="vault-form" onSubmit={unlockRecovery}>
                <label className="vault-field">
                  <span>Recovery Kit</span>
                  <textarea
                    className="vault-input vault-textarea"
                    disabled={busy}
                    onChange={(event) => setRecoveryKitInput(event.target.value)}
                    spellCheck={false}
                    value={recoveryKitInput}
                  />
                </label>
                <ErrorMessage error={error} />
                <button className="action-button" disabled={busy} type="submit">
                  Unlock with Recovery Kit
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setRecoveryKitInput("");
                    setShowRecoveryUnlock(false);
                  }}
                  type="button"
                >
                  Use master password instead
                </button>
              </form>
            )}
          </>
        ) : null}

        {recoveryDrill &&
        screenState.status === "unlocked" &&
        screenState.recovery.status === "pending" ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">User-controlled recovery</p>
              <h1 id="vault-status-title">Save your Recovery Kit</h1>
              <p className="vault-description">
                This high-entropy kit restores every compartment. It is shown only for this
                verification drill and is never uploaded in plaintext.
              </p>
            </div>
            <section className="recovery-kit" aria-label="Recovery Kit">
              <code>{screenState.recovery.recoveryKit}</code>
            </section>
            <div className="vault-actions">
              <button
                className="secondary-button"
                onClick={() => globalThis.print?.()}
                type="button"
              >
                Print Recovery Kit
              </button>
            </div>
            <form className="vault-form" onSubmit={verifyRecovery}>
              <label className="vault-field">
                <span>Re-enter Recovery Kit</span>
                <textarea
                  className="vault-input vault-textarea"
                  disabled={busy}
                  onChange={(event) => setRecoveryKitInput(event.target.value)}
                  spellCheck={false}
                  value={recoveryKitInput}
                />
              </label>
              <ErrorMessage error={error} />
              <button className="action-button" disabled={busy} type="submit">
                Verify Recovery Kit
              </button>
            </form>
          </>
        ) : null}

        {recoveryReplacement && screenState.status === "unlocked" ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Recovery drill incomplete</p>
              <h1 id="vault-status-title">Replace your Recovery Kit</h1>
              <p className="vault-description">
                The previous one-time display cannot be recovered. Authenticate to replace its
                wrappers and complete a new drill.
              </p>
            </div>
            <form className="vault-form" onSubmit={replaceRecovery}>
              <label className="vault-field">
                <span>Master password</span>
                <input
                  className="vault-input"
                  disabled={busy}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  type="password"
                  value={masterPassword}
                />
              </label>
              <ErrorMessage error={error} />
              <button className="action-button" disabled={busy} type="submit">
                Generate replacement Recovery Kit
              </button>
            </form>
          </>
        ) : null}

        {screenState.status === "unlocked" && screenState.recovery.status === "verified" ? (
          <>
            <div className="vault-copy manager-titlebar">
              <div>
                <p className="eyebrow">Encrypted library</p>
                <h1 id="vault-status-title">Passwords</h1>
              </div>
              <button
                aria-label="Lock Passwords"
                className="manager-lock-button"
                onClick={lockVault}
                type="button"
              >
                Lock
              </button>
            </div>
            <nav aria-label="Vault sections" className="app-navigation">
              <p className="navigation-label">Library</p>
              <button
                aria-label="Passwords"
                aria-current={activeView === "vault" ? "page" : undefined}
                className={activeView === "vault" ? "nav-button nav-button-active" : "nav-button"}
                onClick={() => setActiveView("vault")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  •••
                </span>
                <span>Passwords</span>
                <strong>{libraryItems.length}</strong>
              </button>
              <button
                aria-label="Security"
                aria-current={activeView === "tools" ? "page" : undefined}
                className={activeView === "tools" ? "nav-button nav-button-active" : "nav-button"}
                onClick={() => setActiveView("tools")}
                type="button"
              >
                <span className="nav-symbol nav-symbol-security" aria-hidden="true">
                  !
                </span>
                <span>Security</span>
                <strong>{securityRecommendations.length}</strong>
              </button>
              <button
                aria-label="Passkeys & MFA"
                aria-current={activeView === "authenticators" ? "page" : undefined}
                className={
                  activeView === "authenticators" ? "nav-button nav-button-active" : "nav-button"
                }
                onClick={() => setActiveView("authenticators")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  ◎
                </span>
                <span>Passkeys & MFA</span>
                <strong>{authenticatorCount}</strong>
              </button>
              <p className="navigation-label">Settings</p>
              <button
                aria-label="Private Email"
                aria-current={activeView === "private-email" ? "page" : undefined}
                className={
                  activeView === "private-email" ? "nav-button nav-button-active" : "nav-button"
                }
                onClick={() => setActiveView("private-email")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  @
                </span>
                <span>Private Email</span>
              </button>
              <button
                aria-label="Cloud Sync"
                aria-current={activeView === "cloud" ? "page" : undefined}
                className={activeView === "cloud" ? "nav-button nav-button-active" : "nav-button"}
                onClick={() => setActiveView("cloud")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  ↑
                </span>
                <span>Cloud Sync</span>
              </button>
              <button
                aria-label="Import & Backup"
                aria-current={activeView === "data" ? "page" : undefined}
                className={activeView === "data" ? "nav-button nav-button-active" : "nav-button"}
                onClick={() => setActiveView("data")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  ↕
                </span>
                <span>Import & Backup</span>
              </button>
              <button
                aria-label="Vault Security"
                aria-current={activeView === "settings" ? "page" : undefined}
                className={
                  activeView === "settings" ? "nav-button nav-button-active" : "nav-button"
                }
                onClick={() => setActiveView("settings")}
                type="button"
              >
                <span className="nav-symbol" aria-hidden="true">
                  ⚙
                </span>
                <span>Vault Security</span>
              </button>
            </nav>

            <div className="app-view" hidden={activeView !== "vault"}>
              {screenState.syncConflicts !== undefined && screenState.syncConflicts.length > 0 ? (
                <section className="sync-conflicts" aria-labelledby="sync-conflicts-title">
                  <h2 id="sync-conflicts-title">Sync conflicts need review</h2>
                  <p>
                    Independent encrypted edits were preserved. The current deterministic version is
                    shown below; no conflicting revision was deleted.
                  </p>
                  <ul>
                    {screenState.syncConflicts.map((conflict) => (
                      <li key={conflict.itemId}>
                        Item {conflict.itemId.slice(0, 8)}… has {conflict.revisionIds.length}{" "}
                        preserved versions.
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="security-section vault-library" aria-labelledby="items-title">
                <header className="library-toolbar">
                  <div>
                    <p className="section-kicker">All items</p>
                    <h2 id="items-title">
                      {libraryItems.length === 0
                        ? "No saved items"
                        : `${libraryItems.length} ${libraryItems.length === 1 ? "item" : "items"}`}
                    </h2>
                  </div>
                  <button
                    className="action-button compact-button library-add-button"
                    disabled={busy}
                    onClick={() => {
                      clearItemForm();
                      setItemType("login");
                      setItemEditorOpen(true);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">＋</span>
                    Add item
                  </button>
                </header>
                <label className="vault-field library-search">
                  <span className="visually-hidden">Search decrypted items on this device</span>
                  <span className="search-symbol" aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    className="vault-input"
                    placeholder="Search this device"
                    onChange={(event) => {
                      const query = event.target.value;
                      setItemSearch(query);
                      if (client.searchItems !== undefined) {
                        void client
                          .searchItems(query)
                          .then(setItems)
                          .catch(() => setError("The encrypted local search index was rebuilt."));
                      }
                    }}
                    type="search"
                    value={itemSearch}
                  />
                </label>
                {libraryItems.length === 0 ? (
                  <div className="library-empty">
                    <span className="empty-symbol" aria-hidden="true">
                      •••
                    </span>
                    <strong>No saved items yet</strong>
                    <p>
                      Add a login here, or let the extension offer to save one after you sign in.
                    </p>
                  </div>
                ) : visibleItems.length === 0 ? (
                  <p className="capability-note">No encrypted items match this local search.</p>
                ) : (
                  visibleItems.map((item) => (
                    <div className="security-row" key={item.id}>
                      <p>
                        <strong>{item.title}</strong>
                        <span>
                          {item.type === "login"
                            ? item.username || "Login"
                            : item.type === "identity-profile"
                              ? [item.firstName, item.lastName].filter(Boolean).join(" ") ||
                                "Identity profile"
                              : item.type === "payment-card"
                                ? [
                                    item.cardholderName,
                                    item.cardNumber.replace(/\D/gu, "").slice(-4)
                                      ? `•••• ${item.cardNumber.replace(/\D/gu, "").slice(-4)}`
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "Payment card"
                                : "Secure note"}
                        </span>
                        {item.folder ? <span>Folder: {item.folder}</span> : null}
                        {item.tags?.length ? <span>Tags: {item.tags.join(", ")}</span> : null}
                        {item.favorite ? <span>Favorite</span> : null}
                        {item.type === "login" && totpCodes[item.id] !== undefined ? (
                          <span>Current code: {totpCodes[item.id]}</span>
                        ) : null}
                        {item.type === "login" && item.emailAlias !== undefined ? (
                          <span>
                            Private email: {item.emailAlias.address} · {item.emailAlias.provider}
                          </span>
                        ) : null}
                        {item.type === "login" && item.passkeys?.length ? (
                          <span>
                            {item.passkeys.length} passkey reference
                            {item.passkeys.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </p>
                      <div className="item-actions">
                        {item.type === "login" ? (
                          <button
                            className="secondary-button compact-button"
                            onClick={() => void copySecret(item.password)}
                            type="button"
                          >
                            Copy password
                          </button>
                        ) : null}
                        {item.type === "login" && item.totpUri ? (
                          <button
                            className="secondary-button compact-button"
                            onClick={() => void revealTotp(item)}
                            type="button"
                          >
                            Show current TOTP
                          </button>
                        ) : null}
                        <button
                          className="secondary-button compact-button"
                          onClick={() => editItem(item)}
                          type="button"
                        >
                          Edit
                        </button>
                        {client.listItemHistory !== undefined ? (
                          <button
                            aria-expanded={historyItemId === item.id}
                            className="secondary-button compact-button"
                            onClick={() => void showItemHistory(item)}
                            type="button"
                          >
                            History
                          </button>
                        ) : null}
                        {client.createItemShare !== undefined ? (
                          <button
                            className="secondary-button compact-button"
                            disabled={busy}
                            onClick={() => void createItemShare(item)}
                            type="button"
                          >
                            Share
                          </button>
                        ) : null}
                        <button
                          className="danger-button compact-button"
                          onClick={() => void deleteItem(item)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                      {historyItemId === item.id ? (
                        <section
                          className="item-history"
                          aria-label={`Version history for ${item.title}`}
                        >
                          <header>
                            <strong>Version history</strong>
                            <span>Restoring creates a new encrypted revision.</span>
                          </header>
                          <ol>
                            {itemHistory.map((entry, index) => (
                              <li key={entry.revisionId}>
                                <span>
                                  <strong>
                                    {index === 0
                                      ? "Current version"
                                      : entry.operation === "delete"
                                        ? "Deleted version"
                                        : "Earlier version"}
                                  </strong>
                                  <small>
                                    {entry.item === null
                                      ? "Encrypted deletion marker"
                                      : new Date(entry.item.updatedAt).toLocaleString()}
                                  </small>
                                </span>
                                {index > 0 && entry.item !== null ? (
                                  <button
                                    className="secondary-button compact-button"
                                    disabled={busy}
                                    onClick={() => void restoreItemHistoryEntry(item, entry)}
                                    type="button"
                                  >
                                    Restore
                                  </button>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </section>
                      ) : null}
                    </div>
                  ))
                )}
                {createdShare !== null ? (
                  <section
                    aria-labelledby="item-share-title"
                    aria-modal="true"
                    className="item-share-sheet"
                    role="dialog"
                  >
                    <header className="item-editor-header">
                      <div>
                        <p className="section-kicker">Encrypted item share</p>
                        <h3 id="item-share-title">Share {createdShare.title}</h3>
                      </div>
                      <button
                        aria-label="Close encrypted share"
                        className="icon-button"
                        onClick={() => setCreatedShare(null)}
                        type="button"
                      >
                        ×
                      </button>
                    </header>
                    <p className="capability-note">
                      Send the encrypted file and its secret through separate channels. This share
                      expires {new Date(createdShare.value.bundle.expiresAt).toLocaleString()}.
                    </p>
                    <label className="vault-field">
                      <span>Share secret</span>
                      <input
                        className="vault-input share-secret"
                        readOnly
                        spellCheck={false}
                        value={createdShare.value.secret}
                      />
                    </label>
                    <div className="share-actions">
                      <button className="action-button" onClick={downloadItemShare} type="button">
                        Download encrypted file
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => void copySecret(createdShare.value.secret)}
                        type="button"
                      >
                        Copy secret
                      </button>
                    </div>
                    <p className="share-warning">
                      Anyone with both parts can open this one item until expiry. The vault master
                      password and other vault items are never included.
                    </p>
                  </section>
                ) : null}
                {itemEditorOpen ? (
                  <section className="item-editor" aria-labelledby="item-editor-title">
                    <header className="item-editor-header">
                      <div>
                        <p className="section-kicker">
                          {editingItem === null ? "New encrypted item" : "Encrypted revision"}
                        </p>
                        <h3 id="item-editor-title">
                          {editingItem === null ? "Add to your vault" : `Edit ${editingItem.title}`}
                        </h3>
                      </div>
                      <button
                        aria-label="Close item editor"
                        className="icon-button"
                        disabled={busy}
                        onClick={() => clearItemForm()}
                        type="button"
                      >
                        ×
                      </button>
                    </header>
                    <form className="vault-form inset-form item-editor-form" onSubmit={saveItem}>
                      <label className="vault-field">
                        <span>Item type</span>
                        <select
                          className="vault-input"
                          disabled={editingItem !== null || busy}
                          onChange={(event) => {
                            clearItemForm({ keepOpen: true });
                            setItemType(
                              event.target.value as
                                | "identity-profile"
                                | "login"
                                | "payment-card"
                                | "secure-note",
                            );
                          }}
                          value={itemType}
                        >
                          <option value="login">Login</option>
                          <option value="identity-profile">Identity profile</option>
                          <option value="payment-card">Payment card</option>
                          <option value="secure-note">Secure note</option>
                        </select>
                      </label>
                      <label className="vault-field">
                        <span>Title</span>
                        <input
                          className="vault-input"
                          disabled={busy}
                          onChange={(event) => setItemTitle(event.target.value)}
                          value={itemTitle}
                        />
                      </label>
                      {itemType === "login" ? (
                        <>
                          <label className="vault-field">
                            <span>Username</span>
                            <input
                              autoComplete="off"
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setItemUsername(event.target.value)}
                              value={itemUsername}
                            />
                          </label>
                          <label className="vault-field">
                            <span>Password</span>
                            <input
                              autoComplete="new-password"
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setItemPassword(event.target.value)}
                              type="password"
                              value={itemPassword}
                            />
                          </label>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              setItemPassword(
                                generateReadableStrongPassword({
                                  randomBytes(length) {
                                    const output = new Uint8Array(length);
                                    crypto.getRandomValues(output);
                                    return output;
                                  },
                                }),
                              )
                            }
                            type="button"
                          >
                            Generate readable password
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              setItemPassword(
                                generatePassphrase({
                                  random: {
                                    randomBytes(length) {
                                      const output = new Uint8Array(length);
                                      crypto.getRandomValues(output);
                                      return output;
                                    },
                                  },
                                  wordCount: 6,
                                  words: BUILT_IN_PASSPHRASE_WORDS,
                                }),
                              )
                            }
                            type="button"
                          >
                            Generate passphrase
                          </button>
                          <label className="vault-field">
                            <span>Website addresses, one per line</span>
                            <textarea
                              className="vault-input vault-textarea"
                              disabled={busy}
                              onChange={(event) => setItemUris(event.target.value)}
                              value={itemUris}
                            />
                          </label>
                          <label className="vault-field">
                            <span>Authenticator otpauth URI (optional)</span>
                            <input
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setItemTotpUri(event.target.value)}
                              spellCheck={false}
                              value={itemTotpUri}
                            />
                          </label>
                          <label className="vault-field">
                            <span>Import authenticator QR image (optional)</span>
                            <input
                              accept="image/png,image/jpeg,image/webp"
                              disabled={busy}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file === undefined) return;
                                const Detector = (
                                  globalThis as unknown as {
                                    BarcodeDetector?: new (options: {
                                      formats: string[];
                                    }) => {
                                      detect(
                                        source: unknown,
                                      ): Promise<readonly { readonly rawValue?: string }[]>;
                                    };
                                  }
                                ).BarcodeDetector;
                                if (
                                  Detector === undefined ||
                                  globalThis.createImageBitmap === undefined
                                ) {
                                  setTotpImportStatus(
                                    "QR scanning is unavailable here; paste the otpauth URI instead.",
                                  );
                                  return;
                                }
                                setTotpImportStatus("Reading QR image locally…");
                                void createImageBitmap(file)
                                  .then(async (bitmap) => {
                                    try {
                                      const parsed = await parseOtpAuthQr(
                                        bitmap,
                                        new Detector({ formats: ["qr_code"] }),
                                      );
                                      setItemTotpUri(parsed.uri);
                                      setTotpImportStatus("Authenticator QR imported locally.");
                                    } finally {
                                      bitmap.close();
                                    }
                                  })
                                  .catch(() =>
                                    setTotpImportStatus(
                                      "No valid authenticator QR was found; no data was saved.",
                                    ),
                                  );
                              }}
                              type="file"
                            />
                          </label>
                          {totpImportStatus ? (
                            <p aria-live="polite" className="form-guidance">
                              {totpImportStatus}
                            </p>
                          ) : null}
                          {itemPasskeys.length === 0 ? null : (
                            <aside className="passkey-summary" aria-label="Linked passkeys">
                              <strong>
                                {itemPasskeys.length} linked passkey
                                {itemPasskeys.length === 1 ? "" : "s"}
                              </strong>
                              <span>
                                Created through the website&apos;s native Touch ID or security-key
                                flow; VeyraKey retains only the linked public reference.
                              </span>
                            </aside>
                          )}
                        </>
                      ) : itemType === "identity-profile" ? (
                        <>
                          <div className="profile-fields">
                            {PROFILE_FIELDS.filter((field) =>
                              PRIMARY_PROFILE_FIELD_KEYS.has(field.key),
                            ).map((field) => (
                              <label className="vault-field" key={field.key}>
                                <span>{field.label}</span>
                                <input
                                  autoComplete={field.autocomplete}
                                  className="vault-input"
                                  disabled={busy}
                                  onChange={(event) =>
                                    setProfileFields((current) => ({
                                      ...current,
                                      [field.key]: event.target.value,
                                    }))
                                  }
                                  type={field.type ?? "text"}
                                  value={profileFields[field.key]}
                                />
                              </label>
                            ))}
                          </div>
                          <details className="item-disclosure">
                            <summary>More personal details</summary>
                            <div className="profile-fields">
                              {PROFILE_FIELDS.filter(
                                (field) => !PRIMARY_PROFILE_FIELD_KEYS.has(field.key),
                              ).map((field) => (
                                <label className="vault-field" key={field.key}>
                                  <span>{field.label}</span>
                                  <input
                                    autoComplete={field.autocomplete}
                                    className="vault-input"
                                    disabled={busy}
                                    onChange={(event) =>
                                      setProfileFields((current) => ({
                                        ...current,
                                        [field.key]: event.target.value,
                                      }))
                                    }
                                    type={field.type ?? "text"}
                                    value={profileFields[field.key]}
                                  />
                                </label>
                              ))}
                            </div>
                          </details>
                        </>
                      ) : itemType === "payment-card" ? (
                        <>
                          <label className="vault-field">
                            <span>Name on card</span>
                            <input
                              autoComplete="cc-name"
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) =>
                                setPaymentCard((current) => ({
                                  ...current,
                                  cardholderName: event.target.value,
                                }))
                              }
                              value={paymentCard.cardholderName}
                            />
                          </label>
                          <label className="vault-field">
                            <span>Card number</span>
                            <input
                              autoComplete="cc-number"
                              className="vault-input"
                              disabled={busy}
                              inputMode="numeric"
                              onChange={(event) =>
                                setPaymentCard((current) => ({
                                  ...current,
                                  cardNumber: event.target.value,
                                }))
                              }
                              spellCheck={false}
                              value={paymentCard.cardNumber}
                            />
                          </label>
                          <div className="profile-fields">
                            <label className="vault-field">
                              <span>Expiry month</span>
                              <input
                                autoComplete="cc-exp-month"
                                className="vault-input"
                                disabled={busy}
                                inputMode="numeric"
                                maxLength={2}
                                onChange={(event) =>
                                  setPaymentCard((current) => ({
                                    ...current,
                                    expiryMonth: event.target.value,
                                  }))
                                }
                                placeholder="MM"
                                value={paymentCard.expiryMonth}
                              />
                            </label>
                            <label className="vault-field">
                              <span>Expiry year</span>
                              <input
                                autoComplete="cc-exp-year"
                                className="vault-input"
                                disabled={busy}
                                inputMode="numeric"
                                maxLength={4}
                                onChange={(event) =>
                                  setPaymentCard((current) => ({
                                    ...current,
                                    expiryYear: event.target.value,
                                  }))
                                }
                                placeholder="YYYY"
                                value={paymentCard.expiryYear}
                              />
                            </label>
                          </div>
                          <p className="field-hint">
                            Security codes are never stored. Enter the code directly on the merchant
                            page when required.
                          </p>
                          <details className="item-disclosure">
                            <summary>Billing details</summary>
                            <div className="item-disclosure-fields">
                              <label className="vault-field">
                                <span>Billing address</span>
                                <textarea
                                  autoComplete="street-address"
                                  className="vault-input vault-textarea"
                                  disabled={busy}
                                  onChange={(event) =>
                                    setPaymentCard((current) => ({
                                      ...current,
                                      billingAddress: event.target.value,
                                    }))
                                  }
                                  value={paymentCard.billingAddress}
                                />
                              </label>
                              <label className="vault-field">
                                <span>Notes</span>
                                <textarea
                                  className="vault-input vault-textarea"
                                  disabled={busy}
                                  onChange={(event) =>
                                    setPaymentCard((current) => ({
                                      ...current,
                                      notes: event.target.value,
                                    }))
                                  }
                                  value={paymentCard.notes}
                                />
                              </label>
                            </div>
                          </details>
                        </>
                      ) : null}
                      <details className="item-disclosure">
                        <summary>Organization</summary>
                        <div className="item-disclosure-fields">
                          <label className="vault-field">
                            <span>Folder</span>
                            <input
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setItemFolder(event.target.value)}
                              value={itemFolder}
                            />
                          </label>
                          <label className="vault-field">
                            <span>Tags</span>
                            <input
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setItemTags(event.target.value)}
                              value={itemTags}
                            />
                          </label>
                          <label className="vault-field">
                            <input
                              checked={itemFavorite}
                              disabled={busy}
                              onChange={(event) => setItemFavorite(event.target.checked)}
                              type="checkbox"
                            />
                            <span>Favorite</span>
                          </label>
                        </div>
                      </details>
                      {itemType === "identity-profile" || itemType === "payment-card" ? null : (
                        <label className="vault-field">
                          <span>{itemType === "login" ? "Notes" : "Secure note"}</span>
                          <textarea
                            className="vault-input vault-textarea"
                            disabled={busy}
                            onChange={(event) => setItemBody(event.target.value)}
                            value={itemBody}
                          />
                        </label>
                      )}
                      <button className="action-button" disabled={busy} type="submit">
                        {editingItem === null ? "Save encrypted item" : "Save encrypted revision"}
                      </button>
                      {editingItem !== null ? (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => clearItemForm()}
                          type="button"
                        >
                          Cancel edit
                        </button>
                      ) : null}
                    </form>
                  </section>
                ) : null}
              </section>
            </div>

            <div className="app-view" hidden={activeView !== "authenticators"}>
              <section
                className="security-section authenticator-section"
                aria-labelledby="authenticator-title"
              >
                <header className="settings-view-heading">
                  <div>
                    <p className="eyebrow">Account security</p>
                    <h2 id="authenticator-title">Passkeys & MFA</h2>
                    <p>
                      Keep passkey references and authenticator codes beside the matching encrypted
                      login. Passkey private keys remain protected by the platform or security key.
                    </p>
                  </div>
                  <button
                    className="action-button compact-button"
                    onClick={() => {
                      clearItemForm({ keepOpen: true });
                      setItemType("login");
                      setActiveView("vault");
                    }}
                    type="button"
                  >
                    Add login security
                  </button>
                </header>
                {authenticatorItems.length === 0 ? (
                  <div className="authenticator-empty">
                    <span className="cloud-provider-mark" aria-hidden="true">
                      ◎
                    </span>
                    <div>
                      <strong>No passkeys or authenticator codes saved</strong>
                      <p>Add them to a login to keep recovery metadata and codes organized.</p>
                    </div>
                  </div>
                ) : (
                  <div className="authenticator-list">
                    {authenticatorItems.map((item) => (
                      <article className="authenticator-row" key={item.id}>
                        <div className="authenticator-row-heading">
                          <div>
                            <strong>{item.title}</strong>
                            <span>{item.username || "Login"}</span>
                          </div>
                          <button
                            className="secondary-button compact-button"
                            onClick={() => {
                              editItem(item);
                              setActiveView("vault");
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                        {item.totpUri === undefined ? null : (
                          <div className="authenticator-detail">
                            <div>
                              <strong>Authenticator code</strong>
                              <span>{totpCodes[item.id] ?? "Encrypted and ready"}</span>
                            </div>
                            <button
                              className="secondary-button compact-button"
                              onClick={() => void revealTotp(item)}
                              type="button"
                            >
                              Show code
                            </button>
                          </div>
                        )}
                        {(item.passkeys ?? []).map((passkey) => (
                          <div
                            className="authenticator-detail"
                            key={
                              passkey.credentialId ??
                              `${passkey.rpId}-${passkey.userName}-${passkey.createdAt}`
                            }
                          >
                            <div>
                              <strong>{passkey.displayName || "Passkey"}</strong>
                              <span>{passkey.userName || "No username"}</span>
                            </div>
                            <span className="authenticator-provider">
                              {passkey.rpId} · {passkey.provider}
                            </span>
                          </div>
                        ))}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div
              className="app-view"
              hidden={
                activeView !== "cloud" && activeView !== "data" && activeView !== "private-email"
              }
            >
              {client.syncGoogleDrive === undefined ? null : (
                <section
                  className="cloud-card"
                  aria-labelledby="drive-title"
                  hidden={activeView !== "cloud"}
                >
                  <div className="cloud-card-heading">
                    <span className="cloud-provider-mark" aria-hidden="true">
                      G
                    </span>
                    <div>
                      <h2 id="drive-title">Google Drive</h2>
                      <p>Private app-data storage</p>
                    </div>
                  </div>
                  <p className="form-guidance">
                    Sync, restore, or migrate this encrypted vault through your Google account. Only
                    authenticated ciphertext is uploaded; this app never uploads plaintext keys.
                  </p>
                  {googleDriveConnected ? (
                    <div className="cloud-account-panel">
                      <p>
                        <strong>Connected</strong>
                        <span>{googleDriveAccount ?? "Google Drive private app data"}</span>
                      </p>
                      <button
                        className="action-button"
                        disabled={busy}
                        onClick={() => void syncGoogleDrive()}
                        type="button"
                      >
                        Sync now
                      </button>
                      <div className="button-row">
                        <button
                          className="secondary-button compact-button"
                          disabled={busy}
                          onClick={() => void syncGoogleDrive(true)}
                          type="button"
                        >
                          Use another Google account
                        </button>
                        <button
                          className="secondary-button compact-button"
                          disabled={busy}
                          onClick={disconnectGoogleDrive}
                          type="button"
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="action-button"
                      disabled={busy || googleClientId.trim().length === 0}
                      onClick={() => void syncGoogleDrive(true)}
                      type="button"
                    >
                      Continue with Google
                    </button>
                  )}
                  {googleClientId === "" ? (
                    <p className="configuration-error" role="status">
                      Google Drive is unavailable because this app build has not been configured by
                      its owner.
                    </p>
                  ) : null}
                  {driveStatus ? (
                    <p aria-live="polite" className="form-guidance" role="status">
                      {driveStatus}
                    </p>
                  ) : null}
                </section>
              )}

              {client.syncOneDrive === undefined ? null : (
                <section
                  className="cloud-card"
                  aria-labelledby="onedrive-title"
                  hidden={activeView !== "cloud"}
                >
                  <div className="cloud-card-heading">
                    <span className="cloud-provider-mark microsoft-mark" aria-hidden="true">
                      M
                    </span>
                    <div>
                      <h2 id="onedrive-title">Microsoft OneDrive</h2>
                      <p>Dedicated application folder</p>
                    </div>
                  </div>
                  <p className="form-guidance">
                    Sync, restore, or migrate this encrypted vault through your Microsoft account.
                    Authorization uses PKCE and app-folder-only access.
                  </p>
                  <button
                    className="action-button"
                    disabled={busy || microsoftClientId.trim().length === 0}
                    onClick={() => void syncOneDrive()}
                    type="button"
                  >
                    Sync or migrate to OneDrive
                  </button>
                  {microsoftClientId === "" ? (
                    <p className="configuration-error" role="status">
                      OneDrive is unavailable because this app build has not been configured by its
                      owner.
                    </p>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={disconnectOneDrive}
                    type="button"
                  >
                    Disconnect OneDrive
                  </button>
                  {oneDriveStatus ? (
                    <p aria-live="polite" className="form-guidance" role="status">
                      {oneDriveStatus}
                    </p>
                  ) : null}
                </section>
              )}

              <section
                className="cloud-card"
                aria-labelledby="private-email-title"
                hidden={activeView !== "private-email"}
              >
                <div className="cloud-card-heading">
                  <span className="cloud-provider-mark" aria-hidden="true">
                    @
                  </span>
                  <div>
                    <h2 id="private-email-title">Private Email</h2>
                    <p>Unique addresses for signup forms</p>
                  </div>
                </div>
                <p className="form-guidance">
                  Plus addressing works without a third party when your mail provider supports it.
                  SimpleLogin and Addy.io require your own account token. The configuration and
                  tokens are encrypted inside this vault and sync only as ciphertext.
                </p>
                <form className="vault-form inset-form" onSubmit={savePrivateEmailSettings}>
                  <label className="vault-field">
                    <span>Alias method</span>
                    <select
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => {
                        setPrivateEmailProvider(event.target.value as PrivateEmailProvider);
                        setPrivateEmailStatus("");
                      }}
                      value={privateEmailProvider}
                    >
                      <option value="plus">Plus addressing (no service)</option>
                      <option value="simplelogin">SimpleLogin</option>
                      <option value="addy">Addy.io</option>
                    </select>
                  </label>
                  {privateEmailProvider === "plus" ? (
                    <label className="vault-field">
                      <span>Delivery inbox</span>
                      <input
                        autoComplete="email"
                        className="vault-input"
                        disabled={busy}
                        onChange={(event) => setPrivateEmailBase(event.target.value)}
                        placeholder="you@example.com"
                        type="email"
                        value={privateEmailBase}
                      />
                    </label>
                  ) : (
                    <>
                      <label className="vault-field">
                        <span>
                          {privateEmailProvider === "simplelogin"
                            ? "SimpleLogin API code"
                            : "Addy.io API token"}
                        </span>
                        <input
                          autoComplete="off"
                          className="vault-input"
                          disabled={busy}
                          onChange={(event) => setPrivateEmailApiSecret(event.target.value)}
                          spellCheck={false}
                          type="password"
                          value={privateEmailApiSecret}
                        />
                      </label>
                      {privateEmailProvider === "addy" ? (
                        <label className="vault-field">
                          <span>Addy.io alias domain</span>
                          <input
                            className="vault-input"
                            disabled={busy}
                            onChange={(event) => setPrivateEmailDomain(event.target.value)}
                            placeholder="your-domain.anonaddy.com"
                            spellCheck={false}
                            value={privateEmailDomain}
                          />
                        </label>
                      ) : null}
                    </>
                  )}
                  <label className="vault-field">
                    <input
                      checked={privateEmailAutoFill}
                      disabled={busy}
                      onChange={(event) => setPrivateEmailAutoFill(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Generate and fill on recognized signup email fields</span>
                  </label>
                  <button className="action-button compact-button" disabled={busy} type="submit">
                    Save private email settings
                  </button>
                  {privateEmailStatus ? (
                    <p aria-live="polite" className="form-guidance" role="status">
                      {privateEmailStatus}
                    </p>
                  ) : null}
                </form>
              </section>

              <section
                className="cloud-card transfer-card"
                aria-labelledby="transfer-title"
                hidden={activeView !== "data"}
              >
                <div className="cloud-card-heading">
                  <span className="cloud-provider-mark transfer-mark" aria-hidden="true">
                    ↕
                  </span>
                  <div>
                    <h2 id="transfer-title">Import & Backup</h2>
                    <p>Move data without exposing plaintext to a server</p>
                  </div>
                </div>
                <details className="transfer-disclosure">
                  <summary>Import passwords</summary>
                  <div className="transfer-fields">
                    <label className="vault-field">
                      <span>Format</span>
                      <select
                        className="vault-input"
                        disabled={busy}
                        onChange={(event) => {
                          setImportSource(event.target.value as "bitwarden" | "csv");
                          setImportPreview(null);
                        }}
                        value={importSource}
                      >
                        <option value="csv">Generic CSV</option>
                        <option value="bitwarden">Bitwarden JSON</option>
                      </select>
                    </label>
                    <label className="vault-field">
                      <span>File contents</span>
                      <textarea
                        className="vault-input vault-textarea"
                        disabled={busy}
                        onChange={(event) => {
                          setImportText(event.target.value);
                          setImportPreview(null);
                        }}
                        value={importText}
                      />
                    </label>
                    <button
                      className="secondary-button compact-button"
                      disabled={busy || importText.length === 0}
                      onClick={previewImport}
                      type="button"
                    >
                      Preview
                    </button>
                    {importPreview === null ? null : (
                      <section aria-label="Import preview" className="import-preview">
                        <p>{importPreview.validCount} valid row(s)</p>
                        {importPreview.rows.map((row) => (
                          <label className="import-row" key={row.index}>
                            <input
                              checked={selectedImportRows.has(row.index)}
                              disabled={row.status !== "valid" || busy}
                              onChange={(event) => {
                                setSelectedImportRows((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(row.index);
                                  else next.delete(row.index);
                                  return next;
                                });
                              }}
                              type="checkbox"
                            />
                            <span>
                              {row.sourceLabel}: {row.status}
                              {row.warnings.length ? ` — ${row.warnings.join(", ")}` : ""}
                            </span>
                          </label>
                        ))}
                        <button
                          className="action-button compact-button"
                          disabled={busy || selectedImportRows.size === 0}
                          onClick={() => void commitImport()}
                          type="button"
                        >
                          Import selected
                        </button>
                      </section>
                    )}
                  </div>
                </details>
                <button
                  className="secondary-button compact-button transfer-download"
                  disabled={busy}
                  onClick={() => void downloadEncryptedArchive()}
                  type="button"
                >
                  Download encrypted backup
                </button>
              </section>
            </div>

            <div className="app-view" hidden={activeView !== "tools"}>
              <section className="security-recommendations" aria-labelledby="health-title">
                <header className="security-heading">
                  <div>
                    <h2 id="health-title">Security</h2>
                    <p>
                      {securityRecommendations.length}{" "}
                      {securityRecommendations.length === 1 ? "recommendation" : "recommendations"}
                    </p>
                  </div>
                  <button
                    aria-label="Refresh security recommendations"
                    className="icon-button"
                    disabled={busy}
                    onClick={analyzeLocalPasswords}
                    type="button"
                  >
                    ↻
                  </button>
                </header>

                {securityRecommendations.length === 0 ? (
                  <div className="security-empty">
                    <span aria-hidden="true">✓</span>
                    <strong>No security recommendations</strong>
                    <p>Saved passwords pass the available local and breach checks.</p>
                  </div>
                ) : (
                  <div className="security-browser">
                    <div className="security-list">
                      {securityRecommendations.map(({ issue, item }) => (
                        <button
                          aria-current={
                            selectedSecurityRecommendation?.item.id === item.id ? "true" : undefined
                          }
                          className={
                            selectedSecurityRecommendation?.item.id === item.id
                              ? "security-list-row security-list-row-selected"
                              : "security-list-row"
                          }
                          key={`health-${item.id}`}
                          onClick={() => setSelectedHealthItemId(item.id)}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={`security-issue-icon security-issue-${issue.kind}`}
                          >
                            !
                          </span>
                          <span className="security-list-copy">
                            <strong>{item.title}</strong>
                            <small>{issue.label}</small>
                          </span>
                          <span aria-hidden="true" className="row-chevron">
                            ›
                          </span>
                        </button>
                      ))}
                    </div>

                    {selectedSecurityRecommendation === undefined ? null : (
                      <article className="security-detail">
                        <span
                          aria-hidden="true"
                          className={`security-detail-icon security-issue-${selectedSecurityRecommendation.issue.kind}`}
                        >
                          !
                        </span>
                        <h3>{selectedSecurityRecommendation.issue.label}</h3>
                        <p>{selectedSecurityRecommendation.issue.detail}.</p>
                        <dl>
                          <div>
                            <dt>Account</dt>
                            <dd>{selectedSecurityRecommendation.item.username || "No username"}</dd>
                          </div>
                          <div>
                            <dt>Website</dt>
                            <dd>
                              {selectedSecurityRecommendation.item.uris[0] ?? "No website saved"}
                            </dd>
                          </div>
                        </dl>
                        <div className="security-detail-actions">
                          <button
                            className="secondary-button compact-button"
                            disabled={busy}
                            onClick={() =>
                              void checkPasswordExposure(selectedSecurityRecommendation.item)
                            }
                            type="button"
                          >
                            Check again
                          </button>
                          <button
                            className="action-button compact-button"
                            onClick={() => {
                              editItem(selectedSecurityRecommendation.item);
                              setActiveView("vault");
                            }}
                            type="button"
                          >
                            Change password
                          </button>
                        </div>
                      </article>
                    )}
                  </div>
                )}

                {healthStatus ? (
                  <p aria-live="polite" className="security-status" role="status">
                    {healthStatus}
                  </p>
                ) : null}
                <p className="security-privacy-note">
                  Breach checks use a five-character hash prefix; the password is never sent.
                </p>
              </section>
            </div>

            <div className="app-view" hidden={activeView !== "settings"}>
              <section className="security-section" aria-labelledby="compartment-title">
                <h2 id="compartment-title">Sensitive compartments</h2>
                {(["document", "credential"] as const).map((compartment) => {
                  const isOpen = screenState.unlockedCompartments.includes(compartment);
                  return (
                    <div className="security-row" key={compartment}>
                      <p>
                        <strong>
                          {compartment === "document" ? "Document" : "Credential"} compartment
                        </strong>
                        <span>
                          {isOpen
                            ? `${compartment} compartment is temporarily unlocked.`
                            : `${compartment} compartment is sealed.`}
                        </span>
                      </p>
                      {!isOpen ? (
                        <button
                          className="secondary-button compact-button"
                          disabled={busy}
                          onClick={() => {
                            setStepUpMethod("master-password");
                            setStepUpPassword("");
                            setStepUpRecoveryKit("");
                            setStepUpCompartment(compartment);
                          }}
                          type="button"
                        >
                          Unlock {compartment} compartment
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {stepUpCompartment !== null ? (
                  <form className="vault-form inset-form" onSubmit={confirmStepUp}>
                    <label className="vault-field">
                      <span>Step-up method</span>
                      <select
                        className="vault-input"
                        disabled={busy}
                        onChange={(event) => {
                          setStepUpPassword("");
                          setStepUpRecoveryKit("");
                          setStepUpMethod(event.target.value as "master-password" | "recovery-kit");
                        }}
                        value={stepUpMethod}
                      >
                        <option value="master-password">Master password</option>
                        <option value="recovery-kit">Recovery Kit</option>
                      </select>
                    </label>
                    {stepUpMethod === "master-password" ? (
                      <label className="vault-field">
                        <span>Step-up master password</span>
                        <input
                          className="vault-input"
                          disabled={busy}
                          onChange={(event) => setStepUpPassword(event.target.value)}
                          type="password"
                          value={stepUpPassword}
                        />
                      </label>
                    ) : (
                      <label className="vault-field">
                        <span>Step-up Recovery Kit</span>
                        <textarea
                          className="vault-input vault-textarea"
                          disabled={busy}
                          onChange={(event) => setStepUpRecoveryKit(event.target.value)}
                          spellCheck={false}
                          value={stepUpRecoveryKit}
                        />
                      </label>
                    )}
                    <button className="action-button" disabled={busy} type="submit">
                      Confirm {stepUpCompartment} step-up
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setStepUpPassword("");
                        setStepUpRecoveryKit("");
                        setStepUpCompartment(null);
                      }}
                      type="button"
                    >
                      Cancel step-up
                    </button>
                    {screenState.deviceUnlock.available && selectedDeviceSlotId !== "" ? (
                      <>
                        {screenState.deviceUnlock.slots.length > 1 ? (
                          <label className="vault-field">
                            <span>Device step-up credential</span>
                            <select
                              className="vault-input"
                              disabled={busy}
                              onChange={(event) => setDeviceSlotId(event.target.value)}
                              value={selectedDeviceSlotId}
                            >
                              {screenState.deviceUnlock.slots.map((slot, index) => (
                                <option key={slot.id} value={slot.id}>
                                  Enrolled device {index + 1}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void deviceStepUp(stepUpCompartment, selectedDeviceSlotId)}
                          type="button"
                        >
                          Use enrolled device for step-up
                        </button>
                      </>
                    ) : null}
                  </form>
                ) : null}
              </section>

              <section className="security-section" aria-labelledby="device-title">
                <h2 id="device-title">Device unlock</h2>
                <p className="form-guidance">
                  Touch ID enrollment belongs to this browser on this device. Other devices enroll
                  separately after opening the same encrypted vault.
                </p>
                {screenState.deviceUnlock.available &&
                screenState.deviceUnlock.slots.length === 0 ? (
                  <form className="vault-form inset-form" onSubmit={enrollDevice}>
                    <label className="vault-field">
                      <span>Master password for device enrollment</span>
                      <input
                        className="vault-input"
                        disabled={busy}
                        onChange={(event) => setEnrollmentPassword(event.target.value)}
                        type="password"
                        value={enrollmentPassword}
                      />
                    </label>
                    <button className="secondary-button" disabled={busy} type="submit">
                      Set up Touch ID
                    </button>
                  </form>
                ) : !screenState.deviceUnlock.available ? (
                  <p className="capability-note">
                    WebAuthn PRF is unsupported on this surface. It is not emulated; password and
                    Recovery Kit unlock remain available.
                  </p>
                ) : null}
                {screenState.deviceUnlock.slots.map((slot, index) => (
                  <div className="security-row" key={slot.id}>
                    <p>
                      <strong>Touch ID on this browser{index === 0 ? "" : ` ${index + 1}`}</strong>
                      <span>Active · available for local vault unlock and protected autofill</span>
                    </p>
                    <button
                      className="danger-button compact-button"
                      disabled={busy}
                      onClick={() => void revokeDevice(slot.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </section>

              <section className="security-section" aria-labelledby="password-title">
                <h2 id="password-title">Change master password</h2>
                <form className="vault-form inset-form" onSubmit={changePassword}>
                  <label className="vault-field">
                    <span>Current master password</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      type="password"
                      value={currentPassword}
                    />
                  </label>
                  <label className="vault-field">
                    <span>New master password</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setNewPassword(event.target.value)}
                      type="password"
                      value={newPassword}
                    />
                  </label>
                  <label className="vault-field">
                    <span>Confirm new master password</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                      type="password"
                      value={newPasswordConfirmation}
                    />
                  </label>
                  <button className="secondary-button" disabled={busy} type="submit">
                    Change master password
                  </button>
                </form>
              </section>
            </div>

            <ErrorMessage error={error} />
          </>
        ) : null}
      </section>
    </main>
  );
}
