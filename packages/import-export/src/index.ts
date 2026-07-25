import { type LoginItem, type LoginItemInput, parseLoginInput } from "@zk-wallet/vault";

const MAX_IMPORT_BYTES = 10_485_760;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_FIELD_LENGTH = 1_048_576;

export interface ImportPreviewRow {
  readonly index: number;
  readonly input?: LoginItemInput;
  readonly sourceLabel: string;
  readonly status: "invalid" | "valid";
  readonly warnings: readonly ("duplicate" | "missing-password" | "missing-username")[];
}

export interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[];
  readonly source: "bitwarden" | "csv";
  readonly validCount: number;
}

function parseCsvRows(text: string): string[][] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("CSV is too large");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
      if (rows.length > MAX_ROWS + 1) throw new Error("CSV has too many rows");
    } else field += character;
    if (field.length > MAX_FIELD_LENGTH) throw new Error("CSV field is too large");
  }
  if (quoted) throw new Error("CSV quote is incomplete");
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.some((value) => value.length > MAX_COLUMNS)) throw new Error("CSV has too many columns");
  return rows;
}

function duplicate(input: LoginItemInput, existing: readonly LoginItem[]): boolean {
  const normalizedUsername = input.username.trim().toLocaleLowerCase();
  const origins = new Set(
    input.uris.flatMap((uri) => {
      try {
        return [new URL(uri).origin];
      } catch {
        return [];
      }
    }),
  );
  return existing.some(
    (item) =>
      item.username.trim().toLocaleLowerCase() === normalizedUsername &&
      item.uris.some((uri) => {
        try {
          return origins.has(new URL(uri).origin);
        } catch {
          return false;
        }
      }),
  );
}

function previewRow(
  index: number,
  sourceLabel: string,
  candidate: unknown,
  existing: readonly LoginItem[],
): ImportPreviewRow {
  try {
    const input = parseLoginInput(candidate);
    const warnings: ImportPreviewRow["warnings"][number][] = [];
    if (input.password.length === 0) warnings.push("missing-password");
    if (input.username.length === 0) warnings.push("missing-username");
    if (duplicate(input, existing)) warnings.push("duplicate");
    return { index, input, sourceLabel, status: "valid", warnings };
  } catch {
    return { index, sourceLabel, status: "invalid", warnings: [] };
  }
}

export function previewGenericCsv(
  text: string,
  existing: readonly LoginItem[] = [],
): ImportPreview {
  const rows = parseCsvRows(text);
  const headers = rows.shift()?.map((header) => header.trim().toLocaleLowerCase());
  if (headers === undefined || new Set(headers).size !== headers.length) {
    throw new Error("CSV headers are invalid");
  }
  const supported = new Set([
    "favorite",
    "folder",
    "name",
    "notes",
    "password",
    "tags",
    "title",
    "totp",
    "url",
    "uris",
    "username",
  ]);
  if (
    headers.some((header) => !supported.has(header)) ||
    !headers.some((h) => ["name", "title"].includes(h))
  ) {
    throw new Error("CSV headers are unsupported");
  }
  const indexOf = (name: string) => headers.indexOf(name);
  const value = (row: readonly string[], ...names: string[]) => {
    const index = names.map(indexOf).find((candidate) => candidate >= 0);
    return index === undefined ? "" : (row[index] ?? "");
  };
  const preview = rows.map((row, index) => {
    const tags = value(row, "tags")
      .split(/[;,]/u)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const uriText = value(row, "uris", "url");
    return previewRow(
      index,
      value(row, "title", "name") || `Row ${index + 2}`,
      {
        favorite: /^(1|true|yes)$/iu.test(value(row, "favorite")),
        folder: value(row, "folder"),
        notes: value(row, "notes"),
        password: value(row, "password"),
        tags: [...new Set(tags)],
        title: value(row, "title", "name"),
        totpUri: value(row, "totp"),
        uris: uriText === "" ? [] : uriText.split(/\s*[;\n]\s*/u).filter(Boolean),
        username: value(row, "username"),
      },
      existing,
    );
  });
  return {
    rows: preview,
    source: "csv",
    validCount: preview.filter((row) => row.status === "valid").length,
  };
}

export function previewBitwardenJson(
  text: string,
  existing: readonly LoginItem[] = [],
): ImportPreview {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    throw new Error("Bitwarden export is too large");
  }
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).encrypted === true ||
    !Array.isArray((parsed as Record<string, unknown>).items) ||
    ((parsed as Record<string, unknown>).items as unknown[]).length > MAX_ROWS
  ) {
    throw new Error("Bitwarden export is invalid or encrypted");
  }
  const exportRecord = parsed as Record<string, unknown>;
  const folders = new Map<string, string>(
    Array.isArray(exportRecord.folders)
      ? exportRecord.folders.flatMap((folder: unknown) => {
          if (typeof folder !== "object" || folder === null) return [];
          const record = folder as Record<string, unknown>;
          return typeof record.id === "string" && typeof record.name === "string"
            ? [[record.id, record.name] as const]
            : [];
        })
      : [],
  );
  const rows: ImportPreviewRow[] = (exportRecord.items as unknown[]).flatMap(
    (item: unknown, sourceIndex: number) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const itemRecord = item as Record<string, unknown>;
      if (
        itemRecord.type !== 1 ||
        typeof itemRecord.name !== "string" ||
        typeof itemRecord.login !== "object" ||
        itemRecord.login === null
      ) {
        return [];
      }
      const login = itemRecord.login as Record<string, unknown>;
      const uris = Array.isArray(login.uris)
        ? login.uris.flatMap((entry) =>
            typeof entry === "object" && entry !== null && typeof entry.uri === "string"
              ? [entry.uri]
              : [],
          )
        : [];
      return [
        previewRow(
          sourceIndex,
          itemRecord.name,
          {
            favorite: itemRecord.favorite === true,
            folder:
              typeof itemRecord.folderId === "string"
                ? (folders.get(itemRecord.folderId) ?? "")
                : "",
            notes: typeof itemRecord.notes === "string" ? itemRecord.notes : "",
            password: typeof login.password === "string" ? login.password : "",
            tags: [],
            title: itemRecord.name,
            totpUri: typeof login.totp === "string" ? login.totp : "",
            uris,
            username: typeof login.username === "string" ? login.username : "",
          },
          existing,
        ),
      ];
    },
  );
  return {
    rows,
    source: "bitwarden",
    validCount: rows.filter((row) => row.status === "valid").length,
  };
}

export function selectedImportRequests(preview: ImportPreview, selectedIndexes: readonly number[]) {
  const selected = new Set(selectedIndexes);
  if (selected.size !== selectedIndexes.length) throw new Error("Import selection is invalid");
  return preview.rows.flatMap((row) =>
    row.status === "valid" && row.input !== undefined && selected.has(row.index)
      ? [{ input: row.input, type: "login" as const }]
      : [],
  );
}
