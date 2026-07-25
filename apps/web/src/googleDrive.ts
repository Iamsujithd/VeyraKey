import { type CryptoProvider, zeroBytes } from "@zk-wallet/crypto";
import { IndexedDbItemRevisionRepository, IndexedDbSyncRepository } from "@zk-wallet/persistence";
import {
  type DriveAccessTokenProvider,
  GOOGLE_DRIVE_APPDATA_SCOPE,
  GoogleDriveSyncProvider,
} from "@zk-wallet/provider-drive";
import { createEncryptedVaultSyncCodec, syncVaultItems } from "@zk-wallet/sync";
import type { VaultClient, VaultSyncResult } from "@zk-wallet/ui";
import type { VaultClient as CoreVaultClient } from "@zk-wallet/vault";

const DEVICE_ID_KEY = "zk-wallet-device-id-v1";
const MAX_TOKEN_LENGTH = 8_192;
const OAUTH_TIMEOUT_MILLISECONDS = 120_000;

interface OAuthToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

export function buildGoogleOAuthUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  if (
    options.clientId.trim().length < 8 ||
    options.clientId.length > 512 ||
    /[\r\n]/u.test(options.clientId)
  ) {
    throw new TypeError("Google OAuth client ID is invalid");
  }
  const redirect = new URL(options.redirectUri);
  if (
    !["http:", "https:"].includes(redirect.protocol) ||
    (redirect.protocol === "http:" && !["127.0.0.1", "localhost"].includes(redirect.hostname))
  ) {
    throw new TypeError("Google OAuth redirect URI must be HTTPS or localhost");
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: options.clientId.trim(),
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: redirect.href,
    response_type: "token",
    scope: GOOGLE_DRIVE_APPDATA_SCOPE,
    state: options.state,
  }).toString();
  return url.href;
}

export function parseGoogleOAuthFragment(
  fragment: string,
  expectedState: string,
  now = Date.now(),
): OAuthToken {
  const parameters = new URLSearchParams(fragment.replace(/^#/u, ""));
  if (parameters.get("state") !== expectedState) throw new Error("Google OAuth state mismatch");
  if (parameters.has("error")) throw new Error("Google Drive authorization was denied");
  const accessToken = parameters.get("access_token");
  const expiresIn = Number(parameters.get("expires_in"));
  if (
    accessToken === null ||
    accessToken.length < 16 ||
    accessToken.length > MAX_TOKEN_LENGTH ||
    /[\r\n]/u.test(accessToken) ||
    parameters.get("token_type")?.toLocaleLowerCase() !== "bearer" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 60 ||
    expiresIn > 86_400
  ) {
    throw new Error("Google OAuth response is invalid");
  }
  return { accessToken, expiresAt: now + expiresIn * 1_000 };
}

class BrowserGoogleTokenProvider implements DriveAccessTokenProvider {
  readonly #clientId: string;
  readonly #redirectUri: string;
  #token: OAuthToken | null = null;

  constructor(clientId: string, redirectUri: string) {
    this.#clientId = clientId;
    this.#redirectUri = redirectUri;
  }

  async getAccessToken(): Promise<string> {
    if (this.#token !== null && this.#token.expiresAt - Date.now() > 30_000) {
      return this.#token.accessToken;
    }
    this.#token = await this.#authorize();
    return this.#token.accessToken;
  }

  invalidateAccessToken(token: string): void {
    if (this.#token?.accessToken === token) this.#token = null;
  }

  disconnect(): void {
    this.#token = null;
  }

  async #authorize(): Promise<OAuthToken> {
    const stateBytes = crypto.getRandomValues(new Uint8Array(24));
    const state = [...stateBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    stateBytes.fill(0);
    const popup = window.open(
      buildGoogleOAuthUrl({
        clientId: this.#clientId,
        redirectUri: this.#redirectUri,
        state,
      }),
      "zk-wallet-google-drive-oauth",
      "popup,width=520,height=720",
    );
    if (popup === null) throw new Error("Google OAuth popup was blocked");
    return await new Promise<OAuthToken>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          reject(new Error("Google Drive authorization was canceled"));
          return;
        }
        if (Date.now() - startedAt > OAUTH_TIMEOUT_MILLISECONDS) {
          window.clearInterval(timer);
          popup.close();
          reject(new Error("Google Drive authorization timed out"));
          return;
        }
        let fragment: string;
        try {
          if (
            popup.location.origin !== window.location.origin ||
            popup.location.pathname !== new URL(this.#redirectUri).pathname
          ) {
            return;
          }
          fragment = popup.location.hash;
        } catch {
          return;
        }
        try {
          const token = parseGoogleOAuthFragment(fragment, state);
          window.clearInterval(timer);
          popup.close();
          resolve(token);
        } catch (error) {
          window.clearInterval(timer);
          popup.close();
          reject(error);
        }
      }, 250);
    });
  }
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(existing)) return existing;
  const generated = `web-${crypto.randomUUID().replaceAll("-", "")}`;
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

export function withGoogleDriveSync(
  service: CoreVaultClient,
  cryptoProvider: CryptoProvider,
): CoreVaultClient & VaultClient {
  let tokenProvider: BrowserGoogleTokenProvider | null = null;
  let configuredClientId = "";
  function drive(clientId: string): GoogleDriveSyncProvider {
    if (tokenProvider === null || configuredClientId !== clientId) {
      tokenProvider?.disconnect();
      tokenProvider = new BrowserGoogleTokenProvider(
        clientId,
        `${window.location.origin}/oauth/google/callback`,
      );
      configuredClientId = clientId;
    }
    return new GoogleDriveSyncProvider({ tokenProvider });
  }
  return Object.assign(service, {
    disconnectGoogleDrive() {
      tokenProvider?.disconnect();
      tokenProvider = null;
      configuredClientId = "";
    },
    async restoreFromGoogleDrive(request: {
      readonly clientId: string;
      readonly newMasterPassword: string;
      readonly recoveryKit: string;
    }) {
      if (service.restoreEncryptedArchive === undefined) {
        throw new Error("Encrypted archive restore is unavailable");
      }
      const provider = drive(request.clientId.trim());
      // Start OAuth while this method is still executing in the user's click event. Waiting for
      // an IndexedDB or provider operation first causes browsers to classify the popup as
      // unsolicited and block it.
      await tokenProvider?.getAccessToken();
      const archive = await provider.readEncryptedRecoveryArchive();
      if (archive === null) throw new Error("Google Drive recovery archive was not found");
      return await service.restoreEncryptedArchive({
        archive,
        newMasterPassword: request.newMasterPassword,
        recoveryKit: request.recoveryKit,
      });
    },
    async syncGoogleDrive(request: { readonly clientId: string }): Promise<VaultSyncResult> {
      if (service.exportSessionMaterial === undefined) throw new Error("Vault session unavailable");
      const material = service.exportSessionMaterial();
      try {
        const clientId = request.clientId.trim();
        const provider = drive(clientId);
        // Preserve transient user activation by opening OAuth before sync touches IndexedDB.
        await tokenProvider?.getAccessToken();
        const result = await syncVaultItems({
          codec: createEncryptedVaultSyncCodec(cryptoProvider, material.rootKey, material.vaultId),
          deviceId: deviceId(),
          now: () => Date.now(),
          provider,
          revisionStore: new IndexedDbItemRevisionRepository(),
          syncRepository: new IndexedDbSyncRepository(),
        });
        if (service.exportEncryptedArchive === undefined) {
          throw new Error("Encrypted recovery archive export is unavailable");
        }
        await provider.writeEncryptedRecoveryArchive(await service.exportEncryptedArchive());
        return result;
      } finally {
        zeroBytes(material.rootKey);
      }
    },
  });
}
