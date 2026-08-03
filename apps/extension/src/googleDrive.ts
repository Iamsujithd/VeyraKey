import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";
import { IndexedDbItemRevisionRepository, IndexedDbSyncRepository } from "@zk-wallet/persistence";
import {
  type DriveAccessTokenProvider,
  GOOGLE_DRIVE_APPDATA_SCOPE,
  GoogleDriveSyncProvider,
} from "@zk-wallet/provider-drive";
import { createEncryptedVaultSyncCodec, syncVaultItems } from "@zk-wallet/sync";
import type { VaultClient, VaultSyncResult } from "@zk-wallet/ui";
import type { VaultClient as CoreVaultClient } from "@zk-wallet/vault";

const DEVICE_ID_KEY = "zk-wallet-extension-device-id-v1";
const DRIVE_CONNECTED_KEY = "veyrakey-google-drive-connected-v1";
const DRIVE_NAMESPACE_BYTES = 16;
const MAX_TOKEN_LENGTH = 8_192;

interface OAuthToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

export function buildExtensionGoogleOAuthUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly selectAccount?: boolean;
  readonly state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: options.clientId.trim(),
    include_granted_scopes: "true",
    redirect_uri: options.redirectUri,
    response_type: "token",
    scope: GOOGLE_DRIVE_APPDATA_SCOPE,
    state: options.state,
  }).toString();
  if (options.selectAccount) url.searchParams.set("prompt", "select_account");
  return url.href;
}

export function parseExtensionGoogleOAuthResult(
  resultUrl: string,
  expectedState: string,
  now = Date.now(),
): OAuthToken {
  const parameters = new URL(resultUrl).hash;
  const values = new URLSearchParams(parameters.replace(/^#/u, ""));
  if (values.get("state") !== expectedState) throw new Error("Google OAuth state mismatch");
  if (values.has("error")) throw new Error("Google Drive authorization was denied");
  const accessToken = values.get("access_token");
  const expiresIn = Number(values.get("expires_in"));
  if (
    accessToken === null ||
    accessToken.length < 16 ||
    accessToken.length > MAX_TOKEN_LENGTH ||
    /[\r\n]/u.test(accessToken) ||
    values.get("token_type")?.toLocaleLowerCase() !== "bearer" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 60 ||
    expiresIn > 86_400
  ) {
    throw new Error("Google OAuth response is invalid");
  }
  return { accessToken, expiresAt: now + expiresIn * 1_000 };
}

class ExtensionGoogleTokenProvider implements DriveAccessTokenProvider {
  #token: OAuthToken | null = null;

  constructor(
    readonly clientId: string,
    readonly redirectUri: string,
    readonly selectAccount = false,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.#token !== null && this.#token.expiresAt - Date.now() > 30_000) {
      return this.#token.accessToken;
    }
    const stateBytes = crypto.getRandomValues(new Uint8Array(24));
    const state = bytesToBase64Url(stateBytes);
    zeroBytes(stateBytes);
    const resultUrl = await browser.identity.launchWebAuthFlow({
      interactive: true,
      url: buildExtensionGoogleOAuthUrl({
        clientId: this.clientId,
        redirectUri: this.redirectUri,
        selectAccount: this.selectAccount,
        state,
      }),
    });
    if (resultUrl === undefined) throw new Error("Google Drive authorization was canceled");
    this.#token = parseExtensionGoogleOAuthResult(resultUrl, state);
    return this.#token.accessToken;
  }

  invalidateAccessToken(token: string): void {
    if (this.#token?.accessToken === token) this.#token = null;
  }

  disconnect(): void {
    this.#token = null;
  }
}

function deviceId(): string {
  const current = localStorage.getItem(DEVICE_ID_KEY);
  if (current !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(current)) return current;
  const created = `extension-${crypto.randomUUID().replaceAll("-", "")}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function withExtensionGoogleDriveSync(
  service: CoreVaultClient,
  cryptoProvider: CryptoProvider,
): CoreVaultClient & VaultClient {
  let tokens: ExtensionGoogleTokenProvider | null = null;
  let configuredClientId = "";
  let accountEmail: string | null = null;
  const tokenProvider = (clientId: string, selectAccount = false) => {
    if (tokens === null || configuredClientId !== clientId || selectAccount) {
      tokens?.disconnect();
      tokens = new ExtensionGoogleTokenProvider(
        clientId,
        browser.identity.getRedirectURL("oauth/google"),
        selectAccount,
      );
      configuredClientId = clientId;
      if (selectAccount) accountEmail = null;
    }
    return tokens;
  };
  const provider = (clientId: string, namespace?: string) =>
    new GoogleDriveSyncProvider({
      fetch: globalThis.fetch.bind(globalThis),
      ...(namespace === undefined ? {} : { namespace }),
      tokenProvider: tokenProvider(clientId),
    });
  const readAccountEmail = async (accessToken: string): Promise<string | null> => {
    try {
      const response = await globalThis.fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) return null;
      const value = (await response.json()) as {
        readonly user?: { readonly emailAddress?: unknown };
      };
      const email = value.user?.emailAddress;
      return typeof email === "string" && email.length <= 320 ? email : null;
    } catch {
      return null;
    }
  };
  const authorize = async (clientId: string, selectAccount = false) => {
    const accessToken = await tokenProvider(clientId, selectAccount).getAccessToken();
    accountEmail = await readAccountEmail(accessToken);
    return accessToken;
  };
  const namespace = async (rootKey: Uint8Array, vaultId: string) => {
    const value = await cryptoProvider.hkdfSha256(
      rootKey,
      base64UrlToBytes(vaultId),
      utf8ToBytes("zk-wallet/v1/google-drive-namespace"),
      DRIVE_NAMESPACE_BYTES,
    );
    try {
      return bytesToBase64Url(value);
    } finally {
      zeroBytes(value);
    }
  };

  return Object.assign(service, {
    disconnectGoogleDrive() {
      tokens?.disconnect();
      tokens = null;
      configuredClientId = "";
      accountEmail = null;
      localStorage.removeItem(DRIVE_CONNECTED_KEY);
    },
    getGoogleDriveAccount() {
      return accountEmail;
    },
    isGoogleDriveConnected() {
      return localStorage.getItem(DRIVE_CONNECTED_KEY) === "true";
    },
    async restoreFromGoogleDrive(request: {
      readonly clientId: string;
      readonly newMasterPassword: string;
      readonly recoveryKit: string;
    }) {
      if (service.restoreEncryptedArchive === undefined) {
        throw new Error("Encrypted archive restore is unavailable");
      }
      const drive = provider(request.clientId.trim());
      await authorize(request.clientId.trim());
      const archive = await drive.readEncryptedRecoveryArchive();
      if (archive === null) throw new Error("Google Drive recovery archive was not found");
      localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
      return await service.restoreEncryptedArchive({
        archive,
        newMasterPassword: request.newMasterPassword,
        recoveryKit: request.recoveryKit,
      });
    },
    async restoreFromGoogleDriveWithMasterPassword(request: {
      readonly clientId: string;
      readonly masterPassword: string;
      readonly selectAccount?: boolean;
    }) {
      if (service.restoreEncryptedArchiveWithMasterPassword === undefined) {
        throw new Error("Master-password archive restore is unavailable");
      }
      const clientId = request.clientId.trim();
      await authorize(clientId, request.selectAccount);
      const archive = await provider(clientId).readEncryptedRecoveryArchive();
      if (archive === null) throw new Error("Google Drive vault was not found");
      const restored = await service.restoreEncryptedArchiveWithMasterPassword({
        archive,
        masterPassword: request.masterPassword,
      });
      localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
      return restored;
    },
    async syncGoogleDrive(request: {
      readonly clientId: string;
      readonly selectAccount?: boolean;
    }): Promise<VaultSyncResult> {
      if (service.exportSessionMaterial === undefined) throw new Error("Vault session unavailable");
      const material = service.exportSessionMaterial();
      try {
        const clientId = request.clientId.trim();
        await authorize(clientId, request.selectAccount);
        const drive = provider(clientId, await namespace(material.rootKey, material.vaultId));
        const result = await syncVaultItems({
          codec: createEncryptedVaultSyncCodec(cryptoProvider, material.rootKey, material.vaultId),
          deviceId: deviceId(),
          now: () => Date.now(),
          provider: drive,
          revisionStore: new IndexedDbItemRevisionRepository(),
          syncRepository: new IndexedDbSyncRepository(),
        });
        if (service.exportEncryptedArchive === undefined) {
          throw new Error("Encrypted recovery archive export is unavailable");
        }
        await drive.writeEncryptedRecoveryArchive(await service.exportEncryptedArchive());
        localStorage.setItem(DRIVE_CONNECTED_KEY, "true");
        return { ...result, ...(accountEmail === null ? {} : { accountEmail }) };
      } finally {
        zeroBytes(material.rootKey);
      }
    },
  });
}
