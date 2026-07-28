import type { LoginItem, VaultItem } from "@zk-wallet/vault";

export const AUTOFILL_METADATA_INDEX_KEY = "zk-wallet.autofill-metadata-index.v1";

export interface AutofillMetadataEntry {
  readonly id: string;
  readonly origins: readonly string[];
  readonly username: string;
}

interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function loginOrigins(login: LoginItem): readonly string[] {
  return [
    ...new Set(
      login.uris.flatMap((uri) => {
        try {
          const parsed = new URL(uri);
          return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
            ? [parsed.origin]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ].sort();
}

export function buildAutofillMetadataIndex(
  items: readonly VaultItem[],
): readonly AutofillMetadataEntry[] {
  return items.flatMap((item) => {
    if (item.type !== "login" || item.username.trim().length === 0) return [];
    const origins = loginOrigins(item);
    return origins.length === 0 ? [] : [{ id: item.id, origins, username: item.username }];
  });
}

export async function writeAutofillMetadataIndex(
  items: readonly VaultItem[],
  storage: LocalStorageArea,
): Promise<void> {
  await storage.set({ [AUTOFILL_METADATA_INDEX_KEY]: buildAutofillMetadataIndex(items) });
}

export async function readAutofillMetadataIndex(
  storage: LocalStorageArea,
): Promise<readonly AutofillMetadataEntry[]> {
  const value = (await storage.get(AUTOFILL_METADATA_INDEX_KEY))[AUTOFILL_METADATA_INDEX_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const candidate = entry as Partial<AutofillMetadataEntry>;
    if (
      typeof candidate.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(candidate.id) ||
      typeof candidate.username !== "string" ||
      candidate.username.trim().length === 0 ||
      candidate.username.length > 320 ||
      !Array.isArray(candidate.origins) ||
      candidate.origins.length === 0 ||
      candidate.origins.length > 32 ||
      !candidate.origins.every((origin) => {
        if (typeof origin !== "string") return false;
        try {
          const parsed = new URL(origin);
          return parsed.protocol === "https:" && parsed.origin === origin;
        } catch {
          return false;
        }
      })
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        origins: [...new Set(candidate.origins)].sort(),
        username: candidate.username,
      },
    ];
  });
}
