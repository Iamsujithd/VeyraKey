import type { OpaqueSyncObject, SyncProvider } from "@zk-wallet/sync";

export const ONEDRIVE_APP_FOLDER_SCOPE = "Files.ReadWrite.AppFolder" as const;
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const PREFIX = "zkv1_";
const SUFFIX = ".sync";
const RECOVERY = "zk-wallet-recovery-v1.backup";
const LOCATOR = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_OBJECT_BYTES = 16_777_216;
const MAX_BACKUP_BYTES = 67_108_864;

export interface OneDriveAccessTokenProvider {
  getAccessToken(): Promise<string>;
  invalidateAccessToken?(token: string): Promise<void> | void;
}

export type OneDriveErrorCode =
  | "ONEDRIVE_AUTH"
  | "ONEDRIVE_COLLISION"
  | "ONEDRIVE_CORRUPT_RESPONSE"
  | "ONEDRIVE_INVALID_INPUT"
  | "ONEDRIVE_QUOTA"
  | "ONEDRIVE_RETRYABLE";

export class OneDriveProviderError extends Error {
  constructor(
    readonly code: OneDriveErrorCode,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OneDriveProviderError";
  }
}

interface DriveItem {
  readonly id: string;
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new OneDriveProviderError("ONEDRIVE_CORRUPT_RESPONSE", "OneDrive returned invalid JSON");
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function nameFor(locator: string): string {
  if (!LOCATOR.test(locator)) {
    throw new OneDriveProviderError("ONEDRIVE_INVALID_INPUT", "Sync locator is invalid");
  }
  return `${PREFIX}${locator}${SUFFIX}`;
}

function locatorFor(name: string): string | undefined {
  if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX)) return undefined;
  const locator = name.slice(PREFIX.length, -SUFFIX.length);
  return LOCATOR.test(locator) ? locator : undefined;
}

function classify(status: number): OneDriveProviderError {
  if (status === 401 || status === 403) {
    return new OneDriveProviderError(
      "ONEDRIVE_AUTH",
      "OneDrive authorization expired or was revoked",
      false,
      status,
    );
  }
  if (status === 507) {
    return new OneDriveProviderError(
      "ONEDRIVE_QUOTA",
      "OneDrive storage quota is exhausted",
      false,
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new OneDriveProviderError(
      "ONEDRIVE_RETRYABLE",
      "OneDrive is temporarily unavailable",
      true,
      status,
    );
  }
  return new OneDriveProviderError(
    "ONEDRIVE_CORRUPT_RESPONSE",
    "OneDrive rejected the request",
    false,
    status,
  );
}

export class OneDriveSyncProvider implements SyncProvider {
  readonly #fetch: typeof globalThis.fetch;
  readonly #tokens: OneDriveAccessTokenProvider;
  readonly #maximumAttempts: number;
  readonly #retryDelay: (attempt: number) => Promise<void>;

  constructor(options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly maximumAttempts?: number;
    readonly retryDelay?: (attempt: number) => Promise<void>;
    readonly tokenProvider: OneDriveAccessTokenProvider;
  }) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#tokens = options.tokenProvider;
    this.#maximumAttempts = options.maximumAttempts ?? 4;
    this.#retryDelay =
      options.retryDelay ??
      ((attempt) =>
        new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 4_000))));
    if (!Number.isInteger(this.#maximumAttempts) || this.#maximumAttempts < 1) {
      throw new OneDriveProviderError("ONEDRIVE_INVALID_INPUT", "Retry count is invalid");
    }
  }

  async #request(url: string, init: RequestInit = {}): Promise<Response> {
    let refreshed = false;
    for (let attempt = 1; attempt <= this.#maximumAttempts; attempt += 1) {
      const token = await this.#tokens.getAccessToken();
      if (token.trim().length < 16 || token.length > 8_192 || /[\r\n]/u.test(token)) {
        throw new OneDriveProviderError("ONEDRIVE_AUTH", "OneDrive access token is unavailable");
      }
      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch {
        if (attempt === this.#maximumAttempts) {
          throw new OneDriveProviderError(
            "ONEDRIVE_RETRYABLE",
            "OneDrive could not be reached after retrying",
            true,
          );
        }
        await this.#retryDelay(attempt);
        continue;
      }
      if (response.ok) return response;
      const error = classify(response.status);
      if (
        error.code === "ONEDRIVE_AUTH" &&
        !refreshed &&
        this.#tokens.invalidateAccessToken !== undefined
      ) {
        refreshed = true;
        await this.#tokens.invalidateAccessToken(token);
        continue;
      }
      if (!error.retryable || attempt === this.#maximumAttempts) throw error;
      await this.#retryDelay(attempt);
    }
    throw new OneDriveProviderError("ONEDRIVE_RETRYABLE", "OneDrive retry budget exhausted", true);
  }

  async #items(): Promise<DriveItem[]> {
    const items: DriveItem[] = [];
    let next: string | undefined = `${GRAPH_ROOT}/children?$select=id,name&$top=1000`;
    while (next !== undefined) {
      const response = await this.#request(next);
      const value = parseJson(await response.text());
      if (!isRecord(value) || !Array.isArray(value.value)) {
        throw new OneDriveProviderError(
          "ONEDRIVE_CORRUPT_RESPONSE",
          "OneDrive file list is invalid",
        );
      }
      for (const entry of value.value) {
        if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") {
          throw new OneDriveProviderError(
            "ONEDRIVE_CORRUPT_RESPONSE",
            "OneDrive file entry is invalid",
          );
        }
        items.push({ id: entry.id, name: entry.name });
      }
      const candidate = value["@odata.nextLink"];
      if (
        candidate !== undefined &&
        (typeof candidate !== "string" || !candidate.startsWith("https://graph.microsoft.com/"))
      ) {
        throw new OneDriveProviderError(
          "ONEDRIVE_CORRUPT_RESPONSE",
          "OneDrive pagination link is invalid",
        );
      }
      next = candidate;
    }
    return items;
  }

  async #read(item: DriveItem, limit: number): Promise<string> {
    const response = await this.#request(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(item.id)}/content`,
    );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      throw new OneDriveProviderError("ONEDRIVE_CORRUPT_RESPONSE", "OneDrive object is too large");
    }
    const body = await response.text();
    if (byteLength(body) > limit) {
      throw new OneDriveProviderError("ONEDRIVE_CORRUPT_RESPONSE", "OneDrive object is too large");
    }
    return body;
  }

  async #matches(name: string): Promise<DriveItem[]> {
    return (await this.#items()).filter((item) => item.name === name);
  }

  async list(): Promise<readonly OpaqueSyncObject[]> {
    const output: OpaqueSyncObject[] = [];
    for (const item of await this.#items()) {
      const locator = locatorFor(item.name);
      if (locator !== undefined)
        output.push({ locator, body: await this.#read(item, MAX_OBJECT_BYTES) });
    }
    return output;
  }

  async putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists"> {
    const name = nameFor(object.locator);
    if (byteLength(object.body) > MAX_OBJECT_BYTES) {
      throw new OneDriveProviderError("ONEDRIVE_INVALID_INPUT", "Sync object is too large");
    }
    if ((await this.#matches(name)).length > 0) return "exists";
    await this.#request(`${GRAPH_ROOT}:/${encodeURIComponent(name)}:/content`, {
      body: object.body,
      headers: { "Content-Type": "application/octet-stream" },
      method: "PUT",
    });
    return "created";
  }

  async readEncryptedRecoveryArchive(): Promise<unknown | null> {
    const matches = await this.#matches(RECOVERY);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new OneDriveProviderError(
        "ONEDRIVE_COLLISION",
        "OneDrive contains multiple recovery archives",
      );
    }
    return parseJson(await this.#read(matches[0] as DriveItem, MAX_BACKUP_BYTES));
  }

  async writeEncryptedRecoveryArchive(archive: unknown): Promise<void> {
    const body = JSON.stringify(archive);
    if (byteLength(body) > MAX_BACKUP_BYTES) {
      throw new OneDriveProviderError("ONEDRIVE_INVALID_INPUT", "Recovery archive is too large");
    }
    const matches = await this.#matches(RECOVERY);
    if (matches.length > 1) {
      throw new OneDriveProviderError(
        "ONEDRIVE_COLLISION",
        "OneDrive contains multiple recovery archives",
      );
    }
    await this.#request(`${GRAPH_ROOT}:/${encodeURIComponent(RECOVERY)}:/content`, {
      body,
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  }
}
