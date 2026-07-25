import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";
import type { VaultItem } from "./items";

const ALGORITHM = "xchacha20-poly1305-ietf";
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

export interface EncryptedSearchIndexV1 {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly version: 1;
}

interface SearchIndexV1 {
  readonly entries: Readonly<Record<string, readonly string[]>>;
  readonly version: 1;
}

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}@._-]+/u)
        .filter((token) => token.length > 0 && token.length <= 128),
    ),
  ];
}

function build(items: readonly VaultItem[]): SearchIndexV1 {
  return {
    entries: Object.fromEntries(
      items.map((item) => [
        item.id,
        tokens(
          [
            item.title,
            item.folder ?? "",
            ...(item.tags ?? []),
            item.type === "login" ? item.username : "",
          ].join(" "),
        ),
      ]),
    ),
    version: 1,
  };
}

async function key(crypto: CryptoProvider, rootKey: Uint8Array, vaultId: string) {
  return crypto.hkdfSha256(
    rootKey,
    base64UrlToBytes(vaultId),
    utf8ToBytes("zk-wallet/v1/local-search-index"),
    KEY_BYTES,
  );
}

function aad(vaultId: string) {
  return encodeEnvelopeAad({
    algorithm: ALGORITHM,
    contentSchemaVersion: 1,
    envelopeVersion: 1,
    purpose: "local-search-index",
    subjectId: "current",
    vaultId,
  });
}

export async function encryptSearchIndex(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  items: readonly VaultItem[],
): Promise<EncryptedSearchIndexV1> {
  const searchKey = await key(crypto, rootKey, vaultId);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  try {
    const ciphertext = await crypto.sealXChaCha20Poly1305(
      searchKey,
      nonce,
      utf8ToBytes(JSON.stringify(build(items))),
      aad(vaultId),
    );
    return {
      algorithm: ALGORITHM,
      ciphertext: bytesToBase64Url(ciphertext),
      nonce: bytesToBase64Url(nonce),
      version: 1,
    };
  } finally {
    zeroBytes(searchKey);
    zeroBytes(nonce);
  }
}

export async function searchEncryptedIndex(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  untrusted: unknown,
  query: string,
): Promise<readonly string[]> {
  if (typeof untrusted !== "object" || untrusted === null || Array.isArray(untrusted)) {
    throw new Error("Encrypted search index is invalid");
  }
  const record = untrusted as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "algorithm,ciphertext,nonce,version" ||
    record.algorithm !== ALGORITHM ||
    record.version !== 1 ||
    typeof record.ciphertext !== "string" ||
    typeof record.nonce !== "string" ||
    base64UrlToBytes(record.nonce).length !== NONCE_BYTES
  ) {
    throw new Error("Encrypted search index is invalid");
  }
  const searchKey = await key(crypto, rootKey, vaultId);
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = await crypto.openXChaCha20Poly1305(
      searchKey,
      base64UrlToBytes(record.nonce),
      base64UrlToBytes(record.ciphertext),
      aad(vaultId),
    );
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).sort().join(",") !== "entries,version" ||
      parsed.version !== 1 ||
      typeof parsed.entries !== "object" ||
      parsed.entries === null ||
      Array.isArray(parsed.entries)
    ) {
      throw new Error("Encrypted search index is invalid");
    }
    const queryTokens = tokens(query);
    if (queryTokens.length === 0) return Object.keys(parsed.entries);
    return Object.entries(parsed.entries as Record<string, unknown>).flatMap(([itemId, value]) =>
      Array.isArray(value) &&
      value.every((token) => typeof token === "string") &&
      queryTokens.every((needle) => value.some((token) => token.startsWith(needle)))
        ? [itemId]
        : [],
    );
  } finally {
    zeroBytes(searchKey);
    if (plaintext !== null) zeroBytes(plaintext);
  }
}
