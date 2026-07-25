import { type CryptoProvider, zeroBytes } from "@zk-wallet/crypto";
import { IndexedDbItemRevisionRepository, IndexedDbSyncRepository } from "@zk-wallet/persistence";
import {
  ONEDRIVE_APP_FOLDER_SCOPE,
  type OneDriveAccessTokenProvider,
  OneDriveSyncProvider,
} from "@zk-wallet/provider-onedrive";
import { createEncryptedVaultSyncCodec, syncVaultItems } from "@zk-wallet/sync";
import type { VaultClient, VaultSyncResult } from "@zk-wallet/ui";
import type { VaultClient as CoreVaultClient } from "@zk-wallet/vault";

const TIMEOUT = 120_000;
const DEVICE_ID_KEY = "zk-wallet-device-id-v1";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function buildOneDriveOAuthUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  if (
    options.clientId.trim().length < 8 ||
    options.clientId.length > 512 ||
    /[\r\n]/u.test(options.clientId)
  ) {
    throw new TypeError("Microsoft OAuth client ID is invalid");
  }
  const redirect = new URL(options.redirectUri);
  if (
    redirect.protocol !== "https:" &&
    !(redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname))
  ) {
    throw new TypeError("Microsoft OAuth redirect URI must be HTTPS or localhost");
  }
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({
    client_id: options.clientId.trim(),
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: redirect.href,
    response_mode: "query",
    response_type: "code",
    scope: `${ONEDRIVE_APP_FOLDER_SCOPE} offline_access`,
    state: options.state,
  }).toString();
  return url.href;
}

class BrowserMicrosoftTokenProvider implements OneDriveAccessTokenProvider {
  #token: { accessToken: string; expiresAt: number } | null = null;
  constructor(
    readonly clientId: string,
    readonly redirectUri: string,
  ) {}
  invalidateAccessToken(): void {
    this.#token = null;
  }
  disconnect(): void {
    this.#token = null;
  }
  async getAccessToken(): Promise<string> {
    if (this.#token !== null && this.#token.expiresAt - Date.now() > 30_000)
      return this.#token.accessToken;
    const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
    const verifier = base64Url(verifierBytes);
    verifierBytes.fill(0);
    const challenge = base64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const popup = window.open(
      buildOneDriveOAuthUrl({
        clientId: this.clientId,
        redirectUri: this.redirectUri,
        state,
        codeChallenge: challenge,
      }),
      "zk-wallet-onedrive-oauth",
      "popup,width=520,height=720",
    );
    if (popup === null) throw new Error("Microsoft OAuth popup was blocked");
    const code = await new Promise<string>((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (popup.closed || Date.now() - started > TIMEOUT) {
          window.clearInterval(timer);
          popup.close();
          reject(new Error("Microsoft authorization was canceled or timed out"));
          return;
        }
        try {
          if (
            popup.location.origin !== window.location.origin ||
            popup.location.pathname !== new URL(this.redirectUri).pathname
          )
            return;
          const query = new URL(popup.location.href).searchParams;
          if (query.get("state") !== state) throw new Error("Microsoft OAuth state mismatch");
          const value = query.get("code");
          if (value === null || value.length < 8 || value.length > 4096 || /[\r\n]/u.test(value))
            throw new Error("Microsoft OAuth response is invalid");
          window.clearInterval(timer);
          popup.close();
          resolve(value);
        } catch (error) {
          if (error instanceof DOMException) return;
          window.clearInterval(timer);
          popup.close();
          reject(error);
        }
      }, 250);
    });
    const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      body: new URLSearchParams({
        client_id: this.clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
        scope: `${ONEDRIVE_APP_FOLDER_SCOPE} offline_access`,
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const value: unknown = await response.json();
    if (
      !response.ok ||
      typeof value !== "object" ||
      value === null ||
      !("access_token" in value) ||
      typeof value.access_token !== "string" ||
      value.access_token.length < 16
    ) {
      throw new Error("Microsoft token exchange failed");
    }
    const expires =
      "expires_in" in value && typeof value.expires_in === "number" ? value.expires_in : 3600;
    this.#token = {
      accessToken: value.access_token,
      expiresAt: Date.now() + Math.min(Math.max(expires, 60), 86_400) * 1000,
    };
    return this.#token.accessToken;
  }
}

function deviceId(): string {
  const current = localStorage.getItem(DEVICE_ID_KEY);
  if (current !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(current)) return current;
  const created = `web-${crypto.randomUUID().replaceAll("-", "")}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function withOneDriveSync(
  service: CoreVaultClient & VaultClient,
  cryptoProvider: CryptoProvider,
): VaultClient {
  let tokens: BrowserMicrosoftTokenProvider | null = null;
  let configured = "";
  const provider = (clientId: string) => {
    if (tokens === null || configured !== clientId) {
      tokens?.disconnect();
      tokens = new BrowserMicrosoftTokenProvider(
        clientId,
        `${window.location.origin}/oauth/microsoft/callback`,
      );
      configured = clientId;
    }
    return new OneDriveSyncProvider({ tokenProvider: tokens });
  };
  return Object.assign(service, {
    disconnectOneDrive() {
      tokens?.disconnect();
      tokens = null;
      configured = "";
    },
    async restoreFromOneDrive(request: {
      clientId: string;
      newMasterPassword: string;
      recoveryKit: string;
    }) {
      if (service.restoreEncryptedArchive === undefined)
        throw new Error("Encrypted archive restore is unavailable");
      const archive = await provider(request.clientId.trim()).readEncryptedRecoveryArchive();
      if (archive === null) throw new Error("OneDrive recovery archive was not found");
      return await service.restoreEncryptedArchive({
        archive,
        newMasterPassword: request.newMasterPassword,
        recoveryKit: request.recoveryKit,
      });
    },
    async syncOneDrive(request: { clientId: string }): Promise<VaultSyncResult> {
      if (service.exportSessionMaterial === undefined) throw new Error("Vault session unavailable");
      const material = service.exportSessionMaterial();
      try {
        const drive = provider(request.clientId.trim());
        const result = await syncVaultItems({
          codec: createEncryptedVaultSyncCodec(cryptoProvider, material.rootKey, material.vaultId),
          deviceId: deviceId(),
          now: () => Date.now(),
          provider: drive,
          revisionStore: new IndexedDbItemRevisionRepository(),
          syncRepository: new IndexedDbSyncRepository(),
        });
        if (service.exportEncryptedArchive === undefined)
          throw new Error("Encrypted recovery archive export is unavailable");
        await drive.writeEncryptedRecoveryArchive(await service.exportEncryptedArchive());
        return result;
      } finally {
        zeroBytes(material.rootKey);
      }
    },
  });
}
