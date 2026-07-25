import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";
import { parseVaultHeader } from "./header";
import { type EncryptedItemRevisionV1, parseEncryptedItemRevision } from "./items";
import type { VaultHeaderV2 } from "./types";

const FORMAT = "zk-wallet-encrypted-archive";
const ALGORITHM = "xchacha20-poly1305-ietf";
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MAX_REVISIONS = 100_000;

export interface EncryptedVaultArchiveV1 {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly format: typeof FORMAT;
  readonly header: VaultHeaderV2;
  readonly nonce: string;
  readonly vaultId: string;
  readonly version: 1;
}

export interface VaultArchiveContentsV1 {
  readonly headRevisionIds: readonly string[];
  readonly revisions: readonly EncryptedItemRevisionV1[];
  readonly version: 1;
}

function aad(vaultId: string) {
  return encodeEnvelopeAad({
    algorithm: ALGORITHM,
    contentSchemaVersion: 1,
    envelopeVersion: 1,
    purpose: "encrypted-vault-archive",
    subjectId: "complete-history",
    vaultId,
  });
}

async function archiveKey(crypto: CryptoProvider, rootKey: Uint8Array, vaultId: string) {
  return crypto.hkdfSha256(
    rootKey,
    base64UrlToBytes(vaultId),
    utf8ToBytes("zk-wallet/v1/encrypted-archive"),
    KEY_BYTES,
  );
}

export async function createEncryptedVaultArchive(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  header: VaultHeaderV2,
  contents: VaultArchiveContentsV1,
): Promise<EncryptedVaultArchiveV1> {
  if (contents.revisions.length > MAX_REVISIONS) throw new Error("Archive is too large");
  const validated = contents.revisions.map(parseEncryptedItemRevision);
  const known = new Set(validated.map((revision) => revision.revisionId));
  if (
    new Set(contents.headRevisionIds).size !== contents.headRevisionIds.length ||
    contents.headRevisionIds.some((revisionId) => !known.has(revisionId))
  ) {
    throw new Error("Archive heads are invalid");
  }
  const key = await archiveKey(crypto, rootKey, header.vaultId);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  try {
    const ciphertext = await crypto.sealXChaCha20Poly1305(
      key,
      nonce,
      utf8ToBytes(
        JSON.stringify({
          headRevisionIds: [...contents.headRevisionIds],
          revisions: validated,
          version: 1,
        }),
      ),
      aad(header.vaultId),
    );
    return {
      algorithm: ALGORITHM,
      ciphertext: bytesToBase64Url(ciphertext),
      format: FORMAT,
      header,
      nonce: bytesToBase64Url(nonce),
      vaultId: header.vaultId,
      version: 1,
    };
  } finally {
    zeroBytes(key);
    zeroBytes(nonce);
  }
}

export async function openEncryptedVaultArchive(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  untrusted: unknown,
): Promise<{
  readonly archive: EncryptedVaultArchiveV1;
  readonly contents: VaultArchiveContentsV1;
}> {
  if (typeof untrusted !== "object" || untrusted === null || Array.isArray(untrusted)) {
    throw new Error("Archive is invalid");
  }
  const record = untrusted as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "algorithm,ciphertext,format,header,nonce,vaultId,version" ||
    record.algorithm !== ALGORITHM ||
    record.format !== FORMAT ||
    record.version !== 1 ||
    typeof record.vaultId !== "string" ||
    typeof record.nonce !== "string" ||
    typeof record.ciphertext !== "string" ||
    base64UrlToBytes(record.nonce).length !== NONCE_BYTES
  ) {
    throw new Error("Archive is invalid");
  }
  const header = parseVaultHeader(record.header);
  if (header.version !== 2 || header.vaultId !== record.vaultId)
    throw new Error("Archive is invalid");
  const key = await archiveKey(crypto, rootKey, header.vaultId);
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = await crypto.openXChaCha20Poly1305(
      key,
      base64UrlToBytes(record.nonce),
      base64UrlToBytes(record.ciphertext),
      aad(header.vaultId),
    );
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).sort().join(",") !== "headRevisionIds,revisions,version" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.revisions) ||
      parsed.revisions.length > MAX_REVISIONS ||
      !Array.isArray(parsed.headRevisionIds) ||
      !parsed.headRevisionIds.every((id: unknown) => typeof id === "string")
    ) {
      throw new Error("Archive is invalid");
    }
    const revisions: EncryptedItemRevisionV1[] = (parsed.revisions as unknown[]).map(
      parseEncryptedItemRevision,
    );
    const known = new Set(revisions.map((revision) => revision.revisionId));
    if (
      new Set(parsed.headRevisionIds).size !== parsed.headRevisionIds.length ||
      parsed.headRevisionIds.some((id: string) => !known.has(id))
    ) {
      throw new Error("Archive is invalid");
    }
    return {
      archive: {
        algorithm: ALGORITHM,
        ciphertext: record.ciphertext,
        format: FORMAT,
        header,
        nonce: record.nonce,
        vaultId: header.vaultId,
        version: 1,
      },
      contents: {
        headRevisionIds: [...parsed.headRevisionIds],
        revisions,
        version: 1,
      },
    };
  } finally {
    zeroBytes(key);
    if (plaintext !== null) zeroBytes(plaintext);
  }
}
