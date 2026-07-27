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
  generatePassword,
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

export interface VaultClient {
  changeMasterPassword(request: {
    readonly currentPassword: string;
    readonly newPassword: string;
  }): Promise<VaultViewState>;
  createVault(masterPassword: string): Promise<VaultViewState>;
  createLogin?(input: {
    readonly favorite?: boolean;
    readonly folder?: string;
    readonly notes: string;
    readonly password: string;
    readonly tags?: readonly string[];
    readonly title: string;
    readonly totpUri?: string;
    readonly uris: readonly string[];
    readonly username: string;
  }): Promise<VaultItemView>;
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
  importItems?(
    items: readonly (
      | {
          readonly input: Parameters<NonNullable<VaultClient["createLogin"]>>[0];
          readonly type: "login";
        }
      | {
          readonly input: Parameters<NonNullable<VaultClient["createSecureNote"]>>[0];
          readonly type: "secure-note";
        }
    )[],
  ): Promise<readonly VaultItemView[]>;
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
  restoreFromGoogleDrive?(request: {
    readonly clientId: string;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  restoreFromOneDrive?(request: {
    readonly clientId: string;
    readonly newMasterPassword: string;
    readonly recoveryKit: string;
  }): Promise<VaultViewState>;
  revokeDevice(slotId: string): Promise<VaultViewState>;
  searchItems?(query: string): Promise<readonly VaultItemView[]>;
  stepUpCompartment(
    compartment: SensitiveCompartment,
    credential: StepUpCredential,
  ): Promise<VaultViewState>;
  subscribe(listener: (state: VaultViewState) => void): () => void;
  syncGoogleDrive?(request: { readonly clientId: string }): Promise<VaultSyncResult>;
  syncOneDrive?(request: { readonly clientId: string }): Promise<VaultSyncResult>;
  unlock(masterPassword: string): Promise<VaultViewState>;
  unlockWithDevice(slotId: string): Promise<VaultViewState>;
  unlockWithRecoveryKit(recoveryKit: string): Promise<VaultViewState>;
  updateLogin?(
    itemId: string,
    expectedRevisionId: string,
    input: {
      readonly favorite?: boolean;
      readonly folder?: string;
      readonly notes: string;
      readonly password: string;
      readonly tags?: readonly string[];
      readonly title: string;
      readonly totpUri?: string;
      readonly uris: readonly string[];
      readonly username: string;
    },
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
  | {
      readonly createdAt: string;
      readonly favorite?: boolean;
      readonly folder?: string;
      readonly id: string;
      readonly notes: string;
      readonly password: string;
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

function Header({ surface, state }: { readonly state: ScreenState; readonly surface: string }) {
  const status =
    state.status === "unlocked"
      ? "Unlocked locally"
      : state.status === "preparing"
        ? "Checking local vault"
        : state.status === "load-failed"
          ? "Local vault unavailable"
          : "Client-side protection";

  return (
    <header className="vault-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          ZK
        </span>
        <span className="brand-copy">
          <strong>Zero-Knowledge Wallet</strong>
          <span>{surface}</span>
        </span>
      </div>
      <span className="foundation-status">
        <span className="status-dot" aria-hidden="true" />
        {status}
      </span>
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

export function VaultScreen({ client, providerConfiguration, surface }: VaultScreenProps) {
  const [screenState, setScreenState] = useState<ScreenState>({ status: "preparing" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [operation, setOperation] = useState<Operation>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKitInput, setRecoveryKitInput] = useState("");
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [encryptedByosState, setEncryptedByosState] = useState("");
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
  const [itemType, setItemType] = useState<"login" | "secure-note">("login");
  const [editingItem, setEditingItem] = useState<VaultItemView | null>(null);
  const [itemTitle, setItemTitle] = useState("");
  const [itemUsername, setItemUsername] = useState("");
  const [itemPassword, setItemPassword] = useState("");
  const [itemUris, setItemUris] = useState("");
  const [itemBody, setItemBody] = useState("");
  const [itemTotpUri, setItemTotpUri] = useState("");
  const [itemFolder, setItemFolder] = useState("");
  const [itemTags, setItemTags] = useState("");
  const [itemFavorite, setItemFavorite] = useState(false);
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
  const googleClientId = providerConfiguration?.googleClientId?.trim() ?? "";
  const microsoftClientId = providerConfiguration?.microsoftClientId?.trim() ?? "";
  const [driveStatus, setDriveStatus] = useState("");
  const [oneDriveStatus, setOneDriveStatus] = useState("");
  const [activeView, setActiveView] = useState<"settings" | "tools" | "vault">("vault");
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
        operationError(
          error,
          "Device enrollment failed. Password and Recovery Kit fallback remain available.",
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

  function clearItemForm() {
    setEditingItem(null);
    setItemTitle("");
    setItemUsername("");
    setItemPassword("");
    setItemUris("");
    setItemBody("");
    setItemTotpUri("");
    setItemFolder("");
    setItemTags("");
    setItemFavorite(false);
    setTotpImportStatus("");
  }

  function editItem(item: VaultItemView) {
    setEditingItem(item);
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
    } else {
      setItemUsername("");
      setItemPassword("");
      setItemUris("");
      setItemBody(item.note);
      setItemTotpUri("");
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOperation("item");
    try {
      if (itemType === "login") {
        if (itemTotpUri !== "") parseOtpAuthUri(itemTotpUri);
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
          notes: itemBody,
          password: itemPassword,
          title: itemTitle,
          totpUri: itemTotpUri.trim(),
          uris: itemUris
            .split(/\r?\n/u)
            .map((uri) => uri.trim())
            .filter(Boolean),
          username: itemUsername,
        };
        if (editingItem?.type === "login") {
          if (client.updateLogin === undefined) throw new Error();
          await client.updateLogin(editingItem.id, editingItem.revisionId, input);
        } else {
          if (client.createLogin === undefined) throw new Error();
          await client.createLogin(input);
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
      setItems((await client.listItems?.()) ?? []);
    } catch {
      setError("Unable to delete the item. It may have changed in another view.");
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
  const visibleItems =
    normalizedSearch === ""
      ? items
      : items.filter((item) =>
          [
            item.title,
            item.folder ?? "",
            ...(item.tags ?? []),
            item.type === "login" ? item.username : "",
          ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
        );

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
      const requests = selectedImportRequests(importPreview, [...selectedImportRows]);
      if (requests.length === 0) throw new Error();
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
      link.download = "zk-wallet-encrypted-backup.json";
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
    setHealthStatus(
      `Analyzed ${findings.length} login(s) locally. “Old” uses the last item update as the password-age estimate.`,
    );
  }

  async function checkPasswordExposure(item: Extract<VaultItemView, { type: "login" }>) {
    setHealthStatus("Checking a five-character hash prefix with padded responses…");
    const result = await checkPwnedPassword(item.password);
    setPwnedResults((current) => ({ ...current, [item.id]: result }));
    setHealthStatus(
      result.status === "unavailable"
        ? "Breach checking is unavailable or the response was invalid. Local analysis still works offline."
        : "Breach check complete. The password itself was not sent.",
    );
  }

  async function syncGoogleDrive() {
    if (client.syncGoogleDrive === undefined || googleClientId.trim().length === 0) {
      setError("Google Drive is not configured in this app build.");
      return;
    }
    setOperation("item");
    setError(null);
    setDriveStatus("Waiting for Google Drive authorization…");
    try {
      const result = await client.syncGoogleDrive({ clientId: googleClientId });
      setItems((await client.listItems?.()) ?? []);
      setDriveStatus(
        `Sync complete: ${result.revisionCount} encrypted revision(s), ${result.uploaded} uploaded, ${result.conflicts.length} conflict(s), ${result.quarantined} quarantined.`,
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
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
    setDriveStatus("Google Drive disconnected. No OAuth token was persisted.");
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
      <section className="vault-card" aria-labelledby="vault-status-title">
        <Header state={screenState} surface={surface} />

        <div
          className={`lock-illustration${screenState.status === "unlocked" ? " is-unlocked" : ""}`}
          aria-hidden="true"
        >
          <span className="lock-shackle" />
          <span className="lock-body">
            <span className="lock-keyhole" />
          </span>
        </div>

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
              <p className="eyebrow">Create locally</p>
              <h1 id="vault-status-title">Create your local vault</h1>
              <p className="vault-description">
                Independent random root, document, and credential keys are wrapped locally. Creation
                finishes only after your Recovery Kit drill.
              </p>
            </div>
            <PrivacyNote state={screenState} />
            <form className="vault-form" onSubmit={createVault}>
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
                Losing every unlock method is intentionally unrecoverable. No server reset exists.
              </p>
              <ErrorMessage error={error} />
              {operation === "create" ? (
                <p className="operation-status" role="status" aria-live="polite">
                  Creating independent encrypted key slots locally…
                </p>
              ) : null}
              <button className="action-button" disabled={busy} type="submit">
                {operation === "create" ? "Creating encrypted vault…" : "Create encrypted vault"}
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
                Restore from encrypted BYOS state
              </button>
            </form>
          </>
        ) : null}

        {screenState.status === "needs-setup" && showRestore ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Clean-profile recovery</p>
              <h1 id="vault-status-title">Restore encrypted vault</h1>
              <p className="vault-description">
                Paste the strict encrypted bootstrap supplied by BYOS and use the Recovery Kit to
                authenticate every compartment before setting a new password.
              </p>
            </div>
            <form className="vault-form" onSubmit={restoreVault}>
              <label className="vault-field">
                <span>Encrypted BYOS vault state</span>
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
              <ErrorMessage error={error} />
              <button className="action-button" disabled={busy} type="submit">
                Restore and rewrap locally
              </button>
              {client.restoreFromGoogleDrive === undefined ? null : (
                <button
                  className="secondary-button"
                  disabled={busy || googleClientId.trim().length === 0}
                  onClick={() => void restoreGoogleDrive()}
                  type="button"
                >
                  Restore directly from Google Drive
                </button>
              )}
              {client.restoreFromOneDrive === undefined ? null : (
                <button
                  className="secondary-button"
                  disabled={busy || microsoftClientId.trim().length === 0}
                  onClick={() => void restoreOneDrive()}
                  type="button"
                >
                  Restore directly from OneDrive
                </button>
              )}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  clearSecrets();
                  setShowRestore(false);
                }}
                type="button"
              >
                Back to vault creation
              </button>
            </form>
          </>
        ) : null}

        {screenState.status === "locked" ? (
          <>
            <div className="vault-copy">
              <p className="eyebrow">Protected by design</p>
              <h1 id="vault-status-title">Vault locked</h1>
              <p className="vault-description">
                Ordinary unlock opens only the root session. Document and credential keys remain
                sealed.
              </p>
            </div>
            <PrivacyNote state={screenState} />
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
                  Unlock with Touch ID or biometrics
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
                  {operation === "unlock" ? "Unlocking locally…" : "Unlock vault"}
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
                  Use Recovery Kit instead
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
            <div className="vault-copy">
              <p className="eyebrow">Decrypted on this device</p>
              <h1 id="vault-status-title">Vault unlocked</h1>
              <p className="vault-description">
                The empty root compartment is open. Login and secure-note records are encrypted
                locally as immutable revisions with independent item keys.
              </p>
            </div>
            <PrivacyNote state={screenState} />
            <nav aria-label="Vault sections" className="app-navigation">
              {(["vault", "tools", "settings"] as const).map((view) => (
                <button
                  aria-current={activeView === view ? "page" : undefined}
                  className={activeView === view ? "nav-button nav-button-active" : "nav-button"}
                  key={view}
                  onClick={() => setActiveView(view)}
                  type="button"
                >
                  {view === "vault" ? "Vault" : view === "tools" ? "Tools" : "Settings"}
                </button>
              ))}
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

              <section className="security-section" aria-labelledby="items-title">
                <h2 id="items-title">Encrypted items ({items.length})</h2>
                <label className="vault-field">
                  <span>Search decrypted items on this device</span>
                  <input
                    className="vault-input"
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
                {items.length === 0 ? (
                  <p className="capability-note">No saved logins or secure notes yet.</p>
                ) : visibleItems.length === 0 ? (
                  <p className="capability-note">No encrypted items match this local search.</p>
                ) : (
                  visibleItems.map((item) => (
                    <div className="security-row" key={item.id}>
                      <p>
                        <strong>{item.title}</strong>
                        <span>
                          {item.type === "login" ? item.username || "Login" : "Secure note"}
                        </span>
                        {item.folder ? <span>Folder: {item.folder}</span> : null}
                        {item.tags?.length ? <span>Tags: {item.tags.join(", ")}</span> : null}
                        {item.favorite ? <span>Favorite</span> : null}
                        {item.type === "login" && totpCodes[item.id] !== undefined ? (
                          <span>Current code: {totpCodes[item.id]}</span>
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
                        <button
                          className="danger-button compact-button"
                          onClick={() => void deleteItem(item)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <form className="vault-form inset-form" onSubmit={saveItem}>
                  <label className="vault-field">
                    <span>Item type</span>
                    <select
                      className="vault-input"
                      disabled={editingItem !== null || busy}
                      onChange={(event) => {
                        clearItemForm();
                        setItemType(event.target.value as "login" | "secure-note");
                      }}
                      value={itemType}
                    >
                      <option value="login">Login</option>
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
                            generatePassword({
                              alphabet:
                                "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*",
                              length: 24,
                              random: {
                                randomBytes(length) {
                                  const output = new Uint8Array(length);
                                  crypto.getRandomValues(output);
                                  return output;
                                },
                              },
                            }),
                          )
                        }
                        type="button"
                      >
                        Generate strong password
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
                    </>
                  ) : null}
                  <label className="vault-field">
                    <span>Folder (optional)</span>
                    <input
                      className="vault-input"
                      disabled={busy}
                      onChange={(event) => setItemFolder(event.target.value)}
                      value={itemFolder}
                    />
                  </label>
                  <label className="vault-field">
                    <span>Tags, comma separated</span>
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
                  <label className="vault-field">
                    <span>{itemType === "login" ? "Notes" : "Secure note"}</span>
                    <textarea
                      className="vault-input vault-textarea"
                      disabled={busy}
                      onChange={(event) => setItemBody(event.target.value)}
                      value={itemBody}
                    />
                  </label>
                  <button className="action-button" disabled={busy} type="submit">
                    {editingItem === null ? "Save encrypted item" : "Save encrypted revision"}
                  </button>
                  {editingItem !== null ? (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={clearItemForm}
                      type="button"
                    >
                      Cancel edit
                    </button>
                  ) : null}
                </form>
              </section>
            </div>

            <div className="app-view" hidden={activeView !== "settings"}>
              {client.syncGoogleDrive === undefined ? null : (
                <section className="cloud-card" aria-labelledby="drive-title">
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
                    Connect your Google account. Only encrypted vault data is uploaded.
                  </p>
                  <button
                    className="action-button"
                    disabled={busy || googleClientId.trim().length === 0}
                    onClick={() => void syncGoogleDrive()}
                    type="button"
                  >
                    Connect Google Drive
                  </button>
                  {googleClientId === "" ? (
                    <p className="configuration-error" role="status">
                      Google Drive is unavailable because this app build has not been configured by
                      its owner.
                    </p>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={disconnectGoogleDrive}
                    type="button"
                  >
                    Disconnect Google Drive
                  </button>
                  {driveStatus ? (
                    <p aria-live="polite" className="form-guidance" role="status">
                      {driveStatus}
                    </p>
                  ) : null}
                </section>
              )}

              {client.syncOneDrive === undefined ? null : (
                <section className="cloud-card" aria-labelledby="onedrive-title">
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
                    Connect your Microsoft account. Authorization uses PKCE and app-folder-only
                    access.
                  </p>
                  <button
                    className="action-button"
                    disabled={busy || microsoftClientId.trim().length === 0}
                    onClick={() => void syncOneDrive()}
                    type="button"
                  >
                    Connect OneDrive
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
            </div>

            <div className="app-view" hidden={activeView !== "tools"}>
              <section className="security-section" aria-labelledby="health-title">
                <h2 id="health-title">Password health</h2>
                <p className="form-guidance">
                  Weakness, reuse, and age are calculated only in this unlocked client. Breach
                  checks are optional and send one SHA-1 hash prefix—not the password—to Pwned
                  Passwords.
                </p>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={analyzeLocalPasswords}
                  type="button"
                >
                  Analyze passwords locally
                </button>
                {items
                  .filter(
                    (item): item is Extract<VaultItemView, { type: "login" }> =>
                      item.type === "login",
                  )
                  .map((item) => {
                    const finding = healthFindings[item.id];
                    const pwned = pwnedResults[item.id];
                    return (
                      <div className="security-row" key={`health-${item.id}`}>
                        <p>
                          <strong>{item.title}</strong>
                          <span>
                            {finding === undefined
                              ? "Not analyzed"
                              : [
                                  finding.weak ? "weak" : "strength checks passed",
                                  finding.reused ? "reused" : "not reused",
                                  finding.ageDays === null
                                    ? "age unknown"
                                    : `${finding.ageDays} days since item update`,
                                ].join(" · ")}
                            {pwned?.status === "found"
                              ? ` · found ${pwned.count} time(s) in the breach corpus`
                              : pwned?.status === "not-found"
                                ? " · not found in the breach corpus"
                                : pwned?.status === "unavailable"
                                  ? " · breach check unavailable"
                                  : ""}
                          </span>
                        </p>
                        <button
                          className="secondary-button compact-button"
                          disabled={busy}
                          onClick={() => void checkPasswordExposure(item)}
                          type="button"
                        >
                          Check breach corpus
                        </button>
                      </div>
                    );
                  })}
                {healthStatus ? (
                  <p aria-live="polite" className="form-guidance" role="status">
                    {healthStatus}
                  </p>
                ) : null}
              </section>

              <section className="security-section" aria-labelledby="transfer-title">
                <h2 id="transfer-title">Import and encrypted backup</h2>
                <label className="vault-field">
                  <span>Import format</span>
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
                  <span>Import file contents</span>
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
                  className="secondary-button"
                  disabled={busy || importText.length === 0}
                  onClick={previewImport}
                  type="button"
                >
                  Preview import
                </button>
                {importPreview === null ? null : (
                  <section aria-label="Import preview">
                    <p>
                      {importPreview.validCount} valid row(s). Duplicate warnings are unchecked by
                      default.
                    </p>
                    {importPreview.rows.map((row) => (
                      <label className="vault-field" key={row.index}>
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
                      className="action-button"
                      disabled={busy || selectedImportRows.size === 0}
                      onClick={() => void commitImport()}
                      type="button"
                    >
                      Import selected rows atomically
                    </button>
                  </section>
                )}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void downloadEncryptedArchive()}
                  type="button"
                >
                  Download encrypted backup
                </button>
                <p className="form-guidance">
                  Backups contain only authenticated encrypted vault state. Restore them from the
                  clean-profile recovery screen with the Recovery Kit.
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
                {screenState.deviceUnlock.available ? (
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
                      Set up Touch ID or biometrics
                    </button>
                  </form>
                ) : (
                  <p className="capability-note">
                    WebAuthn PRF is unsupported on this surface. It is not emulated; password and
                    Recovery Kit unlock remain available.
                  </p>
                )}
                {screenState.deviceUnlock.slots.map((slot) => (
                  <div className="security-row" key={slot.id}>
                    <p>
                      <strong>Enrolled device slot</strong>
                      <span>
                        Revocation prevents future use after updated state is available; it cannot
                        erase keys already extracted from an unlocked device.
                      </span>
                    </p>
                    <button
                      className="danger-button compact-button"
                      disabled={busy}
                      onClick={() => void revokeDevice(slot.id)}
                      type="button"
                    >
                      Revoke enrolled device
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
            <div className="vault-actions">
              <button className="action-button" onClick={lockVault} type="button">
                Lock vault
              </button>
            </div>
          </>
        ) : null}

        <footer className="vault-footer">
          <span>Personal cloud source of truth</span>
          <span aria-hidden="true">•</span>
          <span>Client-side encryption</span>
        </footer>
      </section>
    </main>
  );
}
