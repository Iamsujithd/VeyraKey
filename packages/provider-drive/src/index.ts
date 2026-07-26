import type { OpaqueSyncObject, SyncProvider } from "@zk-wallet/sync";

export const GOOGLE_DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata" as const;

const API_ROOT = "https://www.googleapis.com/drive/v3";
const UPLOAD_ROOT = "https://www.googleapis.com/upload/drive/v3";
const FILE_PREFIX = "zkv1_";
const FILE_SUFFIX = ".sync";
const LOCATOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_OBJECT_BYTES = 16_777_216;
const MAX_BACKUP_BYTES = 67_108_864;
const RECOVERY_ARCHIVE_NAME = "zk-wallet-recovery-v1.backup";

export interface DriveAccessTokenProvider {
  getAccessToken(): Promise<string>;
  invalidateAccessToken?(token: string): Promise<void> | void;
}

export type DriveErrorCode =
  | "DRIVE_AUTH"
  | "DRIVE_COLLISION"
  | "DRIVE_CORRUPT_RESPONSE"
  | "DRIVE_INVALID_INPUT"
  | "DRIVE_QUOTA"
  | "DRIVE_RETRYABLE";

export class DriveProviderError extends Error {
  readonly code: DriveErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    code: DriveErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number } = {},
  ) {
    super(message);
    this.name = "DriveProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export interface DriveChange {
  readonly fileId: string;
  readonly locator: string | undefined;
  readonly removed: boolean;
}

export interface DriveChangePage {
  readonly changes: readonly DriveChange[];
  readonly cursor: string;
  readonly hasMore: boolean;
}

export interface GoogleDriveSyncProviderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly maximumAttempts?: number;
  readonly namespace?: string;
  readonly retryDelay?: (attempt: number) => Promise<void>;
  readonly tokenProvider: DriveAccessTokenProvider;
}

interface DriveFile {
  readonly id: string;
  readonly name: string;
}

function syncFilePrefix(namespace?: string): string {
  return namespace === undefined ? FILE_PREFIX : `${FILE_PREFIX}${namespace}_`;
}

function fileName(locator: string, namespace?: string): string {
  if (!LOCATOR_PATTERN.test(locator)) {
    throw new DriveProviderError("DRIVE_INVALID_INPUT", "Sync object locator is invalid");
  }
  return `${syncFilePrefix(namespace)}${locator}${FILE_SUFFIX}`;
}

function locatorFromName(name: string, namespace?: string): string | undefined {
  const prefix = syncFilePrefix(namespace);
  if (!name.startsWith(prefix) || !name.endsWith(FILE_SUFFIX)) return undefined;
  const locator = name.slice(prefix.length, -FILE_SUFFIX.length);
  return LOCATOR_PATTERN.test(locator) ? locator : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive returned invalid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorReasons(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.error) || !Array.isArray(value.error.errors)) return [];
  return value.error.errors.flatMap((entry) =>
    isRecord(entry) && typeof entry.reason === "string" ? [entry.reason] : [],
  );
}

function classifyResponse(status: number, body: string): DriveProviderError {
  const parsed = body.length === 0 ? undefined : parseJson(body);
  const reasons = errorReasons(parsed);
  if (
    status === 429 ||
    status >= 500 ||
    reasons.some((reason) =>
      ["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(reason),
    )
  ) {
    return new DriveProviderError("DRIVE_RETRYABLE", "Google Drive is temporarily unavailable", {
      retryable: true,
      status,
    });
  }
  if (
    reasons.some((reason) =>
      ["dailyLimitExceeded", "storageQuotaExceeded", "teamDriveFileLimitExceeded"].includes(reason),
    )
  ) {
    return new DriveProviderError("DRIVE_QUOTA", "Google Drive storage or API quota is exhausted", {
      status,
    });
  }
  if (status === 401 || status === 403) {
    return new DriveProviderError(
      "DRIVE_AUTH",
      "Google Drive authorization expired or was revoked",
      {
        status,
      },
    );
  }
  return new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive rejected the request", {
    status,
  });
}

function assertObjectSize(body: string): void {
  if (new TextEncoder().encode(body).byteLength > MAX_OBJECT_BYTES) {
    throw new DriveProviderError("DRIVE_INVALID_INPUT", "Sync object exceeds the size limit");
  }
}

export class GoogleDriveSyncProvider implements SyncProvider {
  readonly #fetch: typeof globalThis.fetch;
  readonly #maximumAttempts: number;
  readonly #namespace: string | undefined;
  readonly #retryDelay: (attempt: number) => Promise<void>;
  readonly #tokenProvider: DriveAccessTokenProvider;

  constructor(options: GoogleDriveSyncProviderOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maximumAttempts = options.maximumAttempts ?? 4;
    this.#namespace = options.namespace;
    this.#retryDelay =
      options.retryDelay ??
      ((attempt) =>
        new Promise((resolve) => {
          setTimeout(resolve, Math.min(250 * 2 ** (attempt - 1), 4_000));
        }));
    this.#tokenProvider = options.tokenProvider;
    if (!Number.isInteger(this.#maximumAttempts) || this.#maximumAttempts < 1) {
      throw new DriveProviderError("DRIVE_INVALID_INPUT", "Retry count is invalid");
    }
    if (this.#namespace !== undefined && !LOCATOR_PATTERN.test(this.#namespace)) {
      throw new DriveProviderError("DRIVE_INVALID_INPUT", "Drive namespace is invalid");
    }
  }

  async #request(url: string, init: RequestInit = {}): Promise<Response> {
    let attempt = 0;
    let refreshed = false;
    while (attempt < this.#maximumAttempts) {
      attempt += 1;
      const token = await this.#tokenProvider.getAccessToken();
      if (token.trim().length === 0 || /[\r\n]/u.test(token)) {
        throw new DriveProviderError("DRIVE_AUTH", "Google Drive access token is unavailable");
      }
      let response: Response;
      try {
        response = await this.#fetch(url, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch {
        if (attempt >= this.#maximumAttempts) {
          throw new DriveProviderError(
            "DRIVE_RETRYABLE",
            "Google Drive could not be reached after retrying",
            { retryable: true },
          );
        }
        await this.#retryDelay(attempt);
        continue;
      }
      if (response.ok) return response;
      const body = await response.text();
      const classified = classifyResponse(response.status, body);
      if (
        classified.code === "DRIVE_AUTH" &&
        !refreshed &&
        this.#tokenProvider.invalidateAccessToken !== undefined
      ) {
        refreshed = true;
        await this.#tokenProvider.invalidateAccessToken(token);
        continue;
      }
      if (!classified.retryable || attempt >= this.#maximumAttempts) throw classified;
      await this.#retryDelay(attempt);
    }
    throw new DriveProviderError("DRIVE_RETRYABLE", "Google Drive retry budget was exhausted", {
      retryable: true,
    });
  }

  async #listFiles(name?: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const parameters = new URLSearchParams({
        fields: "nextPageToken,files(id,name)",
        pageSize: "1000",
        spaces: "appDataFolder",
      });
      if (name !== undefined) {
        parameters.set("q", `name = '${name.replaceAll("'", "\\'")}' and trashed = false`);
      }
      if (pageToken !== undefined) parameters.set("pageToken", pageToken);
      const response = await this.#request(`${API_ROOT}/files?${parameters}`);
      const value = parseJson(await response.text());
      if (!isRecord(value) || !Array.isArray(value.files)) {
        throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive file list is invalid");
      }
      for (const entry of value.files) {
        if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") {
          throw new DriveProviderError(
            "DRIVE_CORRUPT_RESPONSE",
            "Google Drive file entry is invalid",
          );
        }
        files.push({ id: entry.id, name: entry.name });
      }
      if (value.nextPageToken !== undefined && typeof value.nextPageToken !== "string") {
        throw new DriveProviderError(
          "DRIVE_CORRUPT_RESPONSE",
          "Google Drive page token is invalid",
        );
      }
      pageToken = value.nextPageToken;
    } while (pageToken !== undefined);
    return files;
  }

  async #download(file: DriveFile): Promise<OpaqueSyncObject | undefined> {
    const locator = locatorFromName(file.name, this.#namespace);
    if (locator === undefined) return undefined;
    const response = await this.#request(
      `${API_ROOT}/files/${encodeURIComponent(file.id)}?alt=media`,
    );
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) > MAX_OBJECT_BYTES) {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive object is too large");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_OBJECT_BYTES) {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive object is too large");
    }
    return { body, locator };
  }

  async list(): Promise<readonly OpaqueSyncObject[]> {
    const files = await this.#listFiles();
    const objects = await Promise.all(files.map((file) => this.#download(file)));
    return objects.filter((object): object is OpaqueSyncObject => object !== undefined);
  }

  async putIfAbsent(object: OpaqueSyncObject): Promise<"created" | "exists"> {
    const name = fileName(object.locator, this.#namespace);
    assertObjectSize(object.body);
    if ((await this.#listFiles(name)).length > 0) return "exists";

    const boundary = `zk_wallet_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = JSON.stringify({
      appProperties: { schema: "zk-wallet-sync-v1" },
      name,
      parents: ["appDataFolder"],
    });
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${object.body}`,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    await this.#request(`${UPLOAD_ROOT}/files?uploadType=multipart&fields=id`, {
      body,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      method: "POST",
    });
    return "created";
  }

  async readEncryptedRecoveryArchive(): Promise<unknown | null> {
    const files = await this.#listFiles(RECOVERY_ARCHIVE_NAME);
    if (files.length === 0) return null;
    if (files.length !== 1) {
      throw new DriveProviderError(
        "DRIVE_COLLISION",
        "Google Drive contains multiple recovery archives",
      );
    }
    const response = await this.#request(
      `${API_ROOT}/files/${encodeURIComponent(files[0]?.id ?? "")}?alt=media`,
    );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BACKUP_BYTES) {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Recovery archive is too large");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BACKUP_BYTES) {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Recovery archive is too large");
    }
    return parseJson(body);
  }

  async writeEncryptedRecoveryArchive(archive: unknown): Promise<void> {
    const body = JSON.stringify(archive);
    if (new TextEncoder().encode(body).byteLength > MAX_BACKUP_BYTES) {
      throw new DriveProviderError("DRIVE_INVALID_INPUT", "Recovery archive is too large");
    }
    const files = await this.#listFiles(RECOVERY_ARCHIVE_NAME);
    if (files.length > 1) {
      throw new DriveProviderError(
        "DRIVE_COLLISION",
        "Google Drive contains multiple recovery archives",
      );
    }
    const existing = files[0];
    if (existing !== undefined) {
      await this.#request(
        `${UPLOAD_ROOT}/files/${encodeURIComponent(existing.id)}?uploadType=media`,
        {
          body,
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      return;
    }
    const boundary = `zk_wallet_backup_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = JSON.stringify({
      appProperties: { schema: "zk-wallet-recovery-v1" },
      name: RECOVERY_ARCHIVE_NAME,
      parents: ["appDataFolder"],
    });
    const multipart = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}`,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    await this.#request(`${UPLOAD_ROOT}/files?uploadType=multipart&fields=id`, {
      body: multipart,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      method: "POST",
    });
  }

  async getStartCursor(): Promise<string> {
    const parameters = new URLSearchParams({ fields: "startPageToken", spaces: "appDataFolder" });
    const response = await this.#request(`${API_ROOT}/changes/startPageToken?${parameters}`);
    const value = parseJson(await response.text());
    if (!isRecord(value) || typeof value.startPageToken !== "string") {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive cursor is invalid");
    }
    return value.startPageToken;
  }

  async listChanges(cursor: string): Promise<DriveChangePage> {
    if (cursor.length === 0 || cursor.length > 2048 || /[\r\n]/u.test(cursor)) {
      throw new DriveProviderError("DRIVE_INVALID_INPUT", "Google Drive cursor is invalid");
    }
    const parameters = new URLSearchParams({
      fields: "changes(fileId,removed,file(id,name)),newStartPageToken,nextPageToken",
      includeRemoved: "true",
      pageToken: cursor,
      pageSize: "1000",
      spaces: "appDataFolder",
    });
    const response = await this.#request(`${API_ROOT}/changes?${parameters}`);
    const value = parseJson(await response.text());
    if (!isRecord(value) || !Array.isArray(value.changes)) {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive change page is invalid");
    }
    const changes = value.changes.map((entry): DriveChange => {
      if (!isRecord(entry) || typeof entry.fileId !== "string") {
        throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive change is invalid");
      }
      const file = isRecord(entry.file) ? entry.file : undefined;
      return {
        fileId: entry.fileId,
        locator:
          file !== undefined && typeof file.name === "string"
            ? locatorFromName(file.name, this.#namespace)
            : undefined,
        removed: entry.removed === true,
      };
    });
    const next = value.nextPageToken;
    const fresh = value.newStartPageToken;
    if (next !== undefined && typeof next !== "string") {
      throw new DriveProviderError("DRIVE_CORRUPT_RESPONSE", "Google Drive next cursor is invalid");
    }
    if (fresh !== undefined && typeof fresh !== "string") {
      throw new DriveProviderError(
        "DRIVE_CORRUPT_RESPONSE",
        "Google Drive start cursor is invalid",
      );
    }
    const resolvedCursor = next ?? fresh;
    if (resolvedCursor === undefined) {
      throw new DriveProviderError(
        "DRIVE_CORRUPT_RESPONSE",
        "Google Drive omitted a change cursor",
      );
    }
    return { changes, cursor: resolvedCursor, hasMore: next !== undefined };
  }
}
