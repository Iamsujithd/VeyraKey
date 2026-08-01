import {
  base64UrlToBytes,
  bytesToBase64Url,
  type CryptoProvider,
  encodeEnvelopeAad,
  utf8ToBytes,
  zeroBytes,
} from "@zk-wallet/crypto";

const ITEM_FORMAT = "zk-wallet-item-revision";
const ALGORITHM = "xchacha20-poly1305-ietf";
const ID_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MAX_TITLE_BYTES = 512;
const MAX_USERNAME_BYTES = 2_048;
const MAX_PASSWORD_BYTES = 8_192;
const MAX_URI_BYTES = 8_192;
const MAX_URIS = 32;
const MAX_LOGIN_NOTES_BYTES = 65_536;
const MAX_NOTE_BYTES = 1_048_576;
const MAX_TOTP_URI_BYTES = 4_096;
const MAX_FOLDER_BYTES = 512;
const MAX_TAG_BYTES = 256;
const MAX_TAGS = 32;
const MAX_PROFILE_FIELD_BYTES = 8_192;
const MAX_CARD_FIELD_BYTES = 8_192;

export interface OrganizationInput {
  readonly favorite?: boolean;
  readonly folder?: string;
  readonly tags?: readonly string[];
}

export type PasswordBreachCheck =
  | { readonly checkedAt: string; readonly count: number; readonly status: "found" }
  | { readonly checkedAt: string; readonly status: "not-found" | "unavailable" };

export interface LoginItemInput extends OrganizationInput {
  readonly breachCheck?: PasswordBreachCheck;
  readonly notes: string;
  readonly password: string;
  readonly title: string;
  readonly totpUri?: string;
  readonly uris: readonly string[];
  readonly username: string;
}

export interface SecureNoteItemInput extends OrganizationInput {
  readonly note: string;
  readonly title: string;
}

export interface IdentityProfileItemInput extends OrganizationInput {
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly age: string;
  readonly city: string;
  readonly country: string;
  readonly dateOfBirth: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly middleName: string;
  readonly nickname: string;
  readonly organization: string;
  readonly phone: string;
  readonly postalCode: string;
  readonly region: string;
  readonly title: string;
}

export interface PaymentCardItemInput extends OrganizationInput {
  readonly billingAddress: string;
  readonly cardNumber: string;
  readonly cardholderName: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
  readonly notes: string;
  readonly securityCode: string;
  readonly title: string;
}

export interface LoginItem extends LoginItemInput {
  readonly createdAt: string;
  readonly id: string;
  readonly revisionId: string;
  readonly type: "login";
  readonly updatedAt: string;
}

export interface SecureNoteItem extends SecureNoteItemInput {
  readonly createdAt: string;
  readonly id: string;
  readonly revisionId: string;
  readonly type: "secure-note";
  readonly updatedAt: string;
}

export interface IdentityProfileItem extends IdentityProfileItemInput {
  readonly createdAt: string;
  readonly id: string;
  readonly revisionId: string;
  readonly type: "identity-profile";
  readonly updatedAt: string;
}

export interface PaymentCardItem extends PaymentCardItemInput {
  readonly createdAt: string;
  readonly id: string;
  readonly revisionId: string;
  readonly type: "payment-card";
  readonly updatedAt: string;
}

export type VaultItem = IdentityProfileItem | LoginItem | PaymentCardItem | SecureNoteItem;

interface StoredItemPayload {
  readonly createdAt: string;
  readonly item:
    | (LoginItemInput & { readonly type: "login" })
    | (IdentityProfileItemInput & { readonly type: "identity-profile" })
    | (PaymentCardItemInput & { readonly type: "payment-card" })
    | (SecureNoteItemInput & { readonly type: "secure-note" });
  readonly schemaVersion: 1 | 2;
  readonly updatedAt: string;
}

interface StoredTombstone {
  readonly deletedAt: string;
  readonly schemaVersion: 1;
  readonly tombstone: true;
}

export interface EncryptedItemRevisionV1 {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly format: typeof ITEM_FORMAT;
  readonly itemId: string;
  readonly nonce: string;
  readonly operation: "create" | "delete" | "update";
  readonly parentRevisionId: string | null;
  readonly revisionId: string;
  readonly schemaVersion: 1;
  readonly version: 1;
  readonly wrappedItemKey: {
    readonly algorithm: typeof ALGORITHM;
    readonly ciphertext: string;
    readonly nonce: string;
    readonly version: 1;
  };
}

export interface ItemRevisionRepository {
  commitBatch?(revisions: readonly EncryptedItemRevisionV1[]): Promise<void>;
  commit(expectedRevisionId: string | null, revision: EncryptedItemRevisionV1): Promise<void>;
  listConflicts?(): Promise<
    readonly { readonly itemId: string; readonly revisionIds: readonly string[] }[]
  >;
  listHeads(): Promise<readonly unknown[]>;
  listRevisions?(): Promise<readonly unknown[]>;
  readSearchIndex?(): Promise<unknown | null>;
  writeSearchIndex?(index: unknown): Promise<void>;
}

export type ItemErrorCode =
  | "INVALID_ITEM"
  | "ITEM_CORRUPT"
  | "ITEM_NOT_FOUND"
  | "ITEM_WRITE_CONFLICT";

export class ItemError extends Error {
  readonly code: ItemErrorCode;
  constructor(code: ItemErrorCode, message: string) {
    super(message);
    this.name = "ItemError";
    this.code = code;
  }
}

function byteLength(value: string): number {
  return utf8ToBytes(value).length;
}

function bounded(value: unknown, maximum: number, allowEmpty = true): value is string {
  return (
    typeof value === "string" && (allowEmpty || value.length > 0) && byteLength(value) <= maximum
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function allowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function parseOrganization(input: Record<string, unknown>): OrganizationInput {
  if (
    (input.favorite !== undefined && typeof input.favorite !== "boolean") ||
    (input.folder !== undefined && !bounded(input.folder, MAX_FOLDER_BYTES)) ||
    (input.tags !== undefined &&
      (!Array.isArray(input.tags) ||
        input.tags.length > MAX_TAGS ||
        new Set(input.tags).size !== input.tags.length ||
        !input.tags.every((tag) => bounded(tag, MAX_TAG_BYTES, false))))
  ) {
    throw new ItemError("INVALID_ITEM", "Item organization data is invalid");
  }
  return {
    ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
    ...(input.folder === undefined ? {} : { folder: input.folder }),
    ...(input.tags === undefined ? {} : { tags: [...input.tags] as string[] }),
  };
}

export function parseLoginInput(value: unknown): LoginItemInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !allowedKeys(
      value as Record<string, unknown>,
      ["notes", "password", "title", "uris", "username"],
      ["breachCheck", "favorite", "folder", "tags", "totpUri"],
    )
  ) {
    throw new ItemError("INVALID_ITEM", "Login data is invalid");
  }
  const input = value as Record<string, unknown>;
  if (
    !bounded(input.title, MAX_TITLE_BYTES, false) ||
    !bounded(input.username, MAX_USERNAME_BYTES) ||
    !bounded(input.password, MAX_PASSWORD_BYTES) ||
    !bounded(input.notes, MAX_LOGIN_NOTES_BYTES) ||
    (input.breachCheck !== undefined && parsePasswordBreachCheck(input.breachCheck) === null) ||
    (input.totpUri !== undefined && !bounded(input.totpUri, MAX_TOTP_URI_BYTES)) ||
    !Array.isArray(input.uris) ||
    input.uris.length > MAX_URIS ||
    !input.uris.every((uri) => bounded(uri, MAX_URI_BYTES, false))
  ) {
    throw new ItemError("INVALID_ITEM", "Login data is invalid");
  }
  return {
    ...parseOrganization(input),
    ...(input.breachCheck === undefined
      ? {}
      : { breachCheck: parsePasswordBreachCheck(input.breachCheck) as PasswordBreachCheck }),
    notes: input.notes,
    password: input.password,
    title: input.title,
    ...(input.totpUri === undefined ? {} : { totpUri: input.totpUri }),
    uris: [...input.uris],
    username: input.username,
  };
}

function parsePasswordBreachCheck(value: unknown): PasswordBreachCheck | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const check = value as Record<string, unknown>;
  if (!bounded(check.checkedAt, 64, false)) return null;
  if (
    check.status === "found" &&
    exactKeys(check, ["checkedAt", "count", "status"]) &&
    typeof check.count === "number" &&
    Number.isSafeInteger(check.count) &&
    check.count > 0
  ) {
    return { checkedAt: check.checkedAt, count: check.count, status: "found" };
  }
  if (
    ["not-found", "unavailable"].includes(check.status as string) &&
    exactKeys(check, ["checkedAt", "status"])
  ) {
    return {
      checkedAt: check.checkedAt,
      status: check.status as "not-found" | "unavailable",
    };
  }
  return null;
}

export function parseSecureNoteInput(value: unknown): SecureNoteItemInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !allowedKeys(
      value as Record<string, unknown>,
      ["note", "title"],
      ["favorite", "folder", "tags"],
    )
  ) {
    throw new ItemError("INVALID_ITEM", "Secure note data is invalid");
  }
  const input = value as Record<string, unknown>;
  if (!bounded(input.title, MAX_TITLE_BYTES, false) || !bounded(input.note, MAX_NOTE_BYTES)) {
    throw new ItemError("INVALID_ITEM", "Secure note data is invalid");
  }
  return { ...parseOrganization(input), note: input.note, title: input.title };
}

export function parseIdentityProfileInput(value: unknown): IdentityProfileItemInput {
  const required = [
    "addressLine1",
    "addressLine2",
    "city",
    "country",
    "dateOfBirth",
    "email",
    "firstName",
    "lastName",
    "middleName",
    "nickname",
    "organization",
    "phone",
    "postalCode",
    "region",
    "title",
  ] as const;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !allowedKeys(value as Record<string, unknown>, required, ["age", "favorite", "folder", "tags"])
  ) {
    throw new ItemError("INVALID_ITEM", "Identity profile data is invalid");
  }
  const input = value as Record<string, unknown>;
  if (
    !bounded(input.title, MAX_TITLE_BYTES, false) ||
    required
      .filter((field) => field !== "title")
      .some((field) => !bounded(input[field], MAX_PROFILE_FIELD_BYTES)) ||
    (input.age !== undefined && !bounded(input.age, MAX_PROFILE_FIELD_BYTES))
  ) {
    throw new ItemError("INVALID_ITEM", "Identity profile data is invalid");
  }
  return {
    ...parseOrganization(input),
    addressLine1: input.addressLine1 as string,
    addressLine2: input.addressLine2 as string,
    age: (input.age as string | undefined) ?? "",
    city: input.city as string,
    country: input.country as string,
    dateOfBirth: input.dateOfBirth as string,
    email: input.email as string,
    firstName: input.firstName as string,
    lastName: input.lastName as string,
    middleName: input.middleName as string,
    nickname: input.nickname as string,
    organization: input.organization as string,
    phone: input.phone as string,
    postalCode: input.postalCode as string,
    region: input.region as string,
    title: input.title as string,
  };
}

export function parsePaymentCardInput(value: unknown): PaymentCardItemInput {
  const required = [
    "billingAddress",
    "cardNumber",
    "cardholderName",
    "expiryMonth",
    "expiryYear",
    "notes",
    "securityCode",
    "title",
  ] as const;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !allowedKeys(value as Record<string, unknown>, required, ["favorite", "folder", "tags"])
  ) {
    throw new ItemError("INVALID_ITEM", "Payment card data is invalid");
  }
  const input = value as Record<string, unknown>;
  if (
    !bounded(input.title, MAX_TITLE_BYTES, false) ||
    required
      .filter((field) => field !== "title")
      .some((field) => !bounded(input[field], MAX_CARD_FIELD_BYTES))
  ) {
    throw new ItemError("INVALID_ITEM", "Payment card data is invalid");
  }
  const cardNumber = (input.cardNumber as string).replace(/[\s-]/gu, "");
  if (cardNumber.length > 0 && !/^\d{12,19}$/u.test(cardNumber)) {
    throw new ItemError("INVALID_ITEM", "Payment card number is invalid");
  }
  const legacySecurityCode = input.securityCode as string;
  if (legacySecurityCode.length > 0 && !/^\d{3,8}$/u.test(legacySecurityCode)) {
    throw new ItemError("INVALID_ITEM", "Payment card security code is invalid");
  }
  return {
    ...parseOrganization(input),
    billingAddress: input.billingAddress as string,
    cardNumber: input.cardNumber as string,
    cardholderName: input.cardholderName as string,
    expiryMonth: input.expiryMonth as string,
    expiryYear: input.expiryYear as string,
    notes: input.notes as string,
    // Card verification values are deliberately non-persistent. Accepting the legacy
    // property lets old encrypted records migrate without releasing the value again.
    securityCode: "",
    title: input.title as string,
  };
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || base64UrlToBytes(value).length !== ID_BYTES) {
    throw new ItemError("ITEM_CORRUPT", "Encrypted item data is invalid");
  }
  return value;
}

export function parseEncryptedItemRevision(value: unknown): EncryptedItemRevisionV1 {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (
      !exactKeys(record, [
        "algorithm",
        "ciphertext",
        "format",
        "itemId",
        "nonce",
        "operation",
        "parentRevisionId",
        "revisionId",
        "schemaVersion",
        "version",
        "wrappedItemKey",
      ]) ||
      record.algorithm !== ALGORITHM ||
      record.format !== ITEM_FORMAT ||
      record.schemaVersion !== 1 ||
      record.version !== 1 ||
      !["create", "delete", "update"].includes(record.operation as string) ||
      (record.parentRevisionId !== null && typeof record.parentRevisionId !== "string") ||
      typeof record.ciphertext !== "string" ||
      typeof record.nonce !== "string"
    )
      throw new Error();
    const wrapped = record.wrappedItemKey;
    if (
      typeof wrapped !== "object" ||
      wrapped === null ||
      Array.isArray(wrapped) ||
      !exactKeys(wrapped as Record<string, unknown>, [
        "algorithm",
        "ciphertext",
        "nonce",
        "version",
      ])
    )
      throw new Error();
    const wrapper = wrapped as Record<string, unknown>;
    if (
      wrapper.algorithm !== ALGORITHM ||
      wrapper.version !== 1 ||
      typeof wrapper.ciphertext !== "string" ||
      typeof wrapper.nonce !== "string" ||
      base64UrlToBytes(wrapper.nonce).length !== NONCE_BYTES ||
      base64UrlToBytes(record.nonce).length !== NONCE_BYTES ||
      base64UrlToBytes(wrapper.ciphertext).length !== KEY_BYTES + 16 ||
      base64UrlToBytes(record.ciphertext).length < 16
    )
      throw new Error();
    const itemId = parseId(record.itemId);
    const revisionId = parseId(record.revisionId);
    const parentRevisionId =
      record.parentRevisionId === null ? null : parseId(record.parentRevisionId);
    if (
      (record.operation === "create" && parentRevisionId !== null) ||
      (record.operation !== "create" && parentRevisionId === null)
    )
      throw new Error();
    return {
      algorithm: ALGORITHM,
      ciphertext: record.ciphertext,
      format: ITEM_FORMAT,
      itemId,
      nonce: record.nonce,
      operation: record.operation as "create" | "delete" | "update",
      parentRevisionId,
      revisionId,
      schemaVersion: 1,
      version: 1,
      wrappedItemKey: {
        algorithm: ALGORITHM,
        ciphertext: wrapper.ciphertext as string,
        nonce: wrapper.nonce as string,
        version: 1,
      },
    };
  } catch {
    throw new ItemError("ITEM_CORRUPT", "Encrypted item data is invalid");
  }
}

function aad(vaultId: string, revision: EncryptedItemRevisionV1, purpose: string): Uint8Array {
  return encodeEnvelopeAad({
    algorithm: ALGORITHM,
    contentSchemaVersion: 1,
    envelopeVersion: 1,
    purpose,
    subjectId: JSON.stringify([
      revision.itemId,
      revision.revisionId,
      revision.parentRevisionId,
      revision.operation,
    ]),
    vaultId,
  });
}

async function wrappingKey(crypto: CryptoProvider, rootKey: Uint8Array, vaultId: string) {
  return crypto.hkdfSha256(
    rootKey,
    base64UrlToBytes(vaultId),
    utf8ToBytes("zk-wallet/v1/general-item-key-wrap"),
    KEY_BYTES,
  );
}

export async function createEncryptedItemRevision(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  request:
    | { readonly input: LoginItemInput; readonly type: "login" }
    | { readonly input: IdentityProfileItemInput; readonly type: "identity-profile" }
    | { readonly input: PaymentCardItemInput; readonly type: "payment-card" }
    | { readonly input: SecureNoteItemInput; readonly type: "secure-note" },
  now: string,
  previous?: VaultItem,
): Promise<EncryptedItemRevisionV1> {
  const itemId = previous?.id ?? bytesToBase64Url(crypto.randomBytes(ID_BYTES));
  const revisionId = bytesToBase64Url(crypto.randomBytes(ID_BYTES));
  const operation = previous === undefined ? "create" : "update";
  const input =
    request.type === "login"
      ? parseLoginInput(request.input)
      : request.type === "identity-profile"
        ? parseIdentityProfileInput(request.input)
        : request.type === "payment-card"
          ? parsePaymentCardInput(request.input)
          : parseSecureNoteInput(request.input);
  const payload: StoredItemPayload = {
    createdAt: previous?.createdAt ?? now,
    item: { ...input, type: request.type } as StoredItemPayload["item"],
    schemaVersion: 2,
    updatedAt: now,
  };
  return sealRevision(crypto, rootKey, vaultId, {
    itemId,
    operation,
    parentRevisionId: previous?.revisionId ?? null,
    payload,
    revisionId,
  });
}

export async function createEncryptedTombstone(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  item: VaultItem,
  now: string,
): Promise<EncryptedItemRevisionV1> {
  return sealRevision(crypto, rootKey, vaultId, {
    itemId: item.id,
    operation: "delete",
    parentRevisionId: item.revisionId,
    payload: { deletedAt: now, schemaVersion: 1, tombstone: true },
    revisionId: bytesToBase64Url(crypto.randomBytes(ID_BYTES)),
  });
}

async function sealRevision(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  data: {
    readonly itemId: string;
    readonly operation: "create" | "delete" | "update";
    readonly parentRevisionId: string | null;
    readonly payload: StoredItemPayload | StoredTombstone;
    readonly revisionId: string;
  },
): Promise<EncryptedItemRevisionV1> {
  const itemKey = crypto.randomBytes(KEY_BYTES);
  const wrapKey = await wrappingKey(crypto, rootKey, vaultId);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const wrapNonce = crypto.randomBytes(NONCE_BYTES);
  const shell: EncryptedItemRevisionV1 = {
    algorithm: ALGORITHM,
    ciphertext: "",
    format: ITEM_FORMAT,
    itemId: data.itemId,
    nonce: bytesToBase64Url(nonce),
    operation: data.operation,
    parentRevisionId: data.parentRevisionId,
    revisionId: data.revisionId,
    schemaVersion: 1,
    version: 1,
    wrappedItemKey: {
      algorithm: ALGORITHM,
      ciphertext: "",
      nonce: bytesToBase64Url(wrapNonce),
      version: 1,
    },
  };
  try {
    const ciphertext = await crypto.sealXChaCha20Poly1305(
      itemKey,
      nonce,
      utf8ToBytes(JSON.stringify(data.payload)),
      aad(vaultId, shell, "item-payload"),
    );
    const wrapped = await crypto.sealXChaCha20Poly1305(
      wrapKey,
      wrapNonce,
      itemKey,
      aad(vaultId, shell, "item-key-wrap"),
    );
    return {
      ...shell,
      ciphertext: bytesToBase64Url(ciphertext),
      wrappedItemKey: { ...shell.wrappedItemKey, ciphertext: bytesToBase64Url(wrapped) },
    };
  } finally {
    zeroBytes(itemKey);
    zeroBytes(wrapKey);
    zeroBytes(nonce);
    zeroBytes(wrapNonce);
  }
}

export async function openEncryptedItemRevision(
  crypto: CryptoProvider,
  rootKey: Uint8Array,
  vaultId: string,
  untrusted: unknown,
): Promise<VaultItem | null> {
  const revision = parseEncryptedItemRevision(untrusted);
  const wrapKey = await wrappingKey(crypto, rootKey, vaultId);
  let itemKey: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null;
  try {
    itemKey = await crypto.openXChaCha20Poly1305(
      wrapKey,
      base64UrlToBytes(revision.wrappedItemKey.nonce),
      base64UrlToBytes(revision.wrappedItemKey.ciphertext),
      aad(vaultId, revision, "item-key-wrap"),
    );
    plaintext = await crypto.openXChaCha20Poly1305(
      itemKey,
      base64UrlToBytes(revision.nonce),
      base64UrlToBytes(revision.ciphertext),
      aad(vaultId, revision, "item-payload"),
    );
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    if (revision.operation === "delete") {
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !exactKeys(parsed, ["deletedAt", "schemaVersion", "tombstone"]) ||
        parsed.schemaVersion !== 1 ||
        parsed.tombstone !== true ||
        !bounded(parsed.deletedAt, 64, false)
      )
        throw new Error();
      return null;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !exactKeys(parsed, ["createdAt", "item", "schemaVersion", "updatedAt"]) ||
      ![1, 2].includes(parsed.schemaVersion) ||
      !bounded(parsed.createdAt, 64, false) ||
      !bounded(parsed.updatedAt, 64, false) ||
      typeof parsed.item !== "object" ||
      parsed.item === null
    )
      throw new Error();
    const domain = parsed.item as Record<string, unknown>;
    if (domain.type === "login") {
      const { type: _type, ...candidate } = domain;
      return {
        ...parseLoginInput(candidate),
        createdAt: parsed.createdAt,
        id: revision.itemId,
        revisionId: revision.revisionId,
        type: "login",
        updatedAt: parsed.updatedAt,
      };
    }
    if (domain.type === "secure-note") {
      const { type: _type, ...candidate } = domain;
      return {
        ...parseSecureNoteInput(candidate),
        createdAt: parsed.createdAt,
        id: revision.itemId,
        revisionId: revision.revisionId,
        type: "secure-note",
        updatedAt: parsed.updatedAt,
      };
    }
    if (domain.type === "identity-profile") {
      const { type: _type, ...candidate } = domain;
      return {
        ...parseIdentityProfileInput(candidate),
        createdAt: parsed.createdAt,
        id: revision.itemId,
        revisionId: revision.revisionId,
        type: "identity-profile",
        updatedAt: parsed.updatedAt,
      };
    }
    if (domain.type === "payment-card") {
      const { type: _type, ...candidate } = domain;
      return {
        ...parsePaymentCardInput(candidate),
        createdAt: parsed.createdAt,
        id: revision.itemId,
        revisionId: revision.revisionId,
        type: "payment-card",
        updatedAt: parsed.updatedAt,
      };
    }
    throw new Error();
  } catch {
    throw new ItemError("ITEM_CORRUPT", "Encrypted item data is invalid");
  } finally {
    zeroBytes(wrapKey);
    if (itemKey !== null) zeroBytes(itemKey);
    if (plaintext !== null) zeroBytes(plaintext);
  }
}
