import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  utf8ToBytes,
  XCHACHA20_POLY1305_ALGORITHM,
  zeroBytes,
} from "@zk-wallet/crypto";
import {
  type IdentityProfileItem,
  type LoginItem,
  type PaymentCardItem,
  parseIdentityProfileInput,
  parseLoginInput,
  parsePaymentCardInput,
  parseSecureNoteInput,
  type SecureNoteItem,
  type VaultItem,
} from "./items";

const SHARE_FORMAT = "zk-wallet-item-share";
const SHARE_VERSION = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const SHARE_ID_BYTES = 16;
const MAX_SHARE_BYTES = 2_097_152;
const MAX_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export type ItemShareErrorCode = "EXPIRED_SHARE" | "INVALID_SHARE" | "INVALID_SHARE_POLICY";

export class ItemShareError extends Error {
  readonly code: ItemShareErrorCode;

  constructor(code: ItemShareErrorCode) {
    super(
      code === "EXPIRED_SHARE"
        ? "This encrypted share has expired"
        : code === "INVALID_SHARE_POLICY"
          ? "The encrypted share expiry is outside the accepted policy"
          : "The encrypted share is invalid or could not be authenticated",
    );
    this.name = "ItemShareError";
    this.code = code;
  }
}

export interface EncryptedItemShareV1 {
  readonly algorithm: typeof XCHACHA20_POLY1305_ALGORITHM;
  readonly ciphertext: string;
  readonly expiresAt: string;
  readonly format: typeof SHARE_FORMAT;
  readonly nonce: string;
  readonly shareId: string;
  readonly version: typeof SHARE_VERSION;
}

export interface CreatedEncryptedItemShare {
  readonly bundle: EncryptedItemShareV1;
  readonly secret: string;
}

interface ItemSharePayloadV1 {
  readonly issuedAt: string;
  readonly item: VaultItem;
  readonly schemaVersion: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function canonicalId(value: unknown, bytes: number): value is string {
  if (typeof value !== "string") return false;
  try {
    return base64UrlToBytes(value).length === bytes;
  } catch {
    return false;
  }
}

function aad(bundle: Omit<EncryptedItemShareV1, "ciphertext" | "nonce">): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      algorithm: bundle.algorithm,
      expiresAt: bundle.expiresAt,
      format: bundle.format,
      shareId: bundle.shareId,
      version: bundle.version,
    }),
  );
}

function parseBundle(value: unknown): EncryptedItemShareV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "algorithm",
      "ciphertext",
      "expiresAt",
      "format",
      "nonce",
      "shareId",
      "version",
    ]) ||
    value.algorithm !== XCHACHA20_POLY1305_ALGORITHM ||
    value.format !== SHARE_FORMAT ||
    value.version !== SHARE_VERSION ||
    typeof value.ciphertext !== "string" ||
    !canonicalTimestamp(value.expiresAt) ||
    !canonicalId(value.shareId, SHARE_ID_BYTES) ||
    typeof value.nonce !== "string"
  ) {
    throw new ItemShareError("INVALID_SHARE");
  }
  try {
    const nonce = base64UrlToBytes(value.nonce);
    const ciphertext = base64UrlToBytes(value.ciphertext);
    if (
      nonce.length !== NONCE_BYTES ||
      ciphertext.length < 16 ||
      ciphertext.length > MAX_SHARE_BYTES
    ) {
      throw new Error("invalid bounds");
    }
  } catch {
    throw new ItemShareError("INVALID_SHARE");
  }
  return value as unknown as EncryptedItemShareV1;
}

function parseSharedItem(value: unknown): VaultItem {
  if (!isRecord(value)) throw new ItemShareError("INVALID_SHARE");
  const { createdAt, id, revisionId, type, updatedAt, ...input } = value;
  if (
    !canonicalTimestamp(createdAt) ||
    !canonicalTimestamp(updatedAt) ||
    !canonicalId(id, SHARE_ID_BYTES) ||
    !canonicalId(revisionId, SHARE_ID_BYTES)
  ) {
    throw new ItemShareError("INVALID_SHARE");
  }
  try {
    if (type === "login") {
      return {
        ...parseLoginInput(input),
        createdAt,
        id,
        revisionId,
        type,
        updatedAt,
      } satisfies LoginItem;
    }
    if (type === "secure-note") {
      return {
        ...parseSecureNoteInput(input),
        createdAt,
        id,
        revisionId,
        type,
        updatedAt,
      } satisfies SecureNoteItem;
    }
    if (type === "identity-profile") {
      return {
        ...parseIdentityProfileInput(input),
        createdAt,
        id,
        revisionId,
        type,
        updatedAt,
      } satisfies IdentityProfileItem;
    }
    if (type === "payment-card") {
      return {
        ...parsePaymentCardInput(input),
        createdAt,
        id,
        revisionId,
        type,
        updatedAt,
      } satisfies PaymentCardItem;
    }
  } catch {
    throw new ItemShareError("INVALID_SHARE");
  }
  throw new ItemShareError("INVALID_SHARE");
}

function parsePayload(value: unknown): ItemSharePayloadV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["issuedAt", "item", "schemaVersion"]) ||
    value.schemaVersion !== 1 ||
    !canonicalTimestamp(value.issuedAt)
  ) {
    throw new ItemShareError("INVALID_SHARE");
  }
  return { issuedAt: value.issuedAt, item: parseSharedItem(value.item), schemaVersion: 1 };
}

function policyTimes(
  expiresAt: string,
  now: string,
): { readonly expires: number; readonly issued: number } {
  if (!canonicalTimestamp(expiresAt) || !canonicalTimestamp(now)) {
    throw new ItemShareError("INVALID_SHARE_POLICY");
  }
  const expires = Date.parse(expiresAt);
  const issued = Date.parse(now);
  if (expires <= issued || expires - issued > MAX_LIFETIME_MILLISECONDS) {
    throw new ItemShareError("INVALID_SHARE_POLICY");
  }
  return { expires, issued };
}

export async function createEncryptedItemShare(
  crypto: CryptoProvider,
  item: VaultItem,
  expiresAt: string,
  now = new Date().toISOString(),
): Promise<CreatedEncryptedItemShare> {
  policyTimes(expiresAt, now);
  const key = crypto.randomBytes(KEY_BYTES);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const shareId = bytesToBase64Url(crypto.randomBytes(SHARE_ID_BYTES));
  const metadata = {
    algorithm: XCHACHA20_POLY1305_ALGORITHM,
    expiresAt,
    format: SHARE_FORMAT,
    shareId,
    version: SHARE_VERSION,
  } as const;
  const plaintext = utf8ToBytes(JSON.stringify({ issuedAt: now, item, schemaVersion: 1 }));
  if (plaintext.length > MAX_SHARE_BYTES - 16) {
    zeroBytes(key);
    zeroBytes(plaintext);
    throw new ItemShareError("INVALID_SHARE");
  }
  try {
    const ciphertext = await crypto.sealXChaCha20Poly1305(key, nonce, plaintext, aad(metadata));
    return {
      bundle: {
        ...metadata,
        ciphertext: bytesToBase64Url(ciphertext),
        nonce: bytesToBase64Url(nonce),
      },
      secret: bytesToBase64Url(key),
    };
  } finally {
    zeroBytes(key);
    zeroBytes(plaintext);
  }
}

export async function openEncryptedItemShare(
  crypto: CryptoProvider,
  value: unknown,
  secret: string,
  now = new Date().toISOString(),
): Promise<VaultItem> {
  const bundle = parseBundle(value);
  let key: Uint8Array;
  try {
    key = base64UrlToBytes(secret);
    if (key.length !== KEY_BYTES) throw new Error("invalid key");
  } catch {
    throw new ItemShareError("INVALID_SHARE");
  }
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = await crypto.openXChaCha20Poly1305(
      key,
      base64UrlToBytes(bundle.nonce),
      base64UrlToBytes(bundle.ciphertext),
      aad(bundle),
    );
    const payload = parsePayload(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
    if (!canonicalTimestamp(now)) throw new ItemShareError("INVALID_SHARE_POLICY");
    if (Date.parse(now) >= Date.parse(bundle.expiresAt)) throw new ItemShareError("EXPIRED_SHARE");
    return payload.item;
  } catch (error) {
    if (error instanceof ItemShareError) throw error;
    throw new ItemShareError("INVALID_SHARE");
  } finally {
    zeroBytes(key);
    if (plaintext !== undefined) zeroBytes(plaintext);
  }
}
