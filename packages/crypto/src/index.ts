import sodium from "libsodium-wrappers-sumo";

export const ARGON2ID_ALGORITHM = "argon2id-1.3" as const;
export const XCHACHA20_POLY1305_ALGORITHM = "xchacha20-poly1305-ietf" as const;
export const XCHACHA20_POLY1305_KEY_BYTES = 32;
export const XCHACHA20_POLY1305_NONCE_BYTES = 24;
export const XCHACHA20_POLY1305_TAG_BYTES = 16;

export interface Argon2idParameters {
  readonly algorithm: typeof ARGON2ID_ALGORITHM;
  readonly memoryKiB: number;
  readonly operations: number;
  readonly outputLength: 32;
  readonly parallelism: 1;
}

export const ARGON2ID_PRODUCTION_FLOOR = Object.freeze({
  algorithm: ARGON2ID_ALGORITHM,
  memoryKiB: 19_456,
  operations: 2,
  outputLength: 32,
  parallelism: 1,
} satisfies Argon2idParameters);

export type CryptoErrorCode =
  | "AUTHENTICATION_FAILED"
  | "CRYPTO_UNAVAILABLE"
  | "INVALID_CRYPTO_INPUT"
  | "KDF_POLICY_VIOLATION";

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

export interface EnvelopeAadContext {
  readonly algorithm: typeof XCHACHA20_POLY1305_ALGORITHM;
  readonly contentSchemaVersion: number;
  readonly envelopeVersion: number;
  readonly purpose: string;
  readonly subjectId: string;
  readonly vaultId: string;
}

export interface CryptoProvider {
  deriveArgon2id(
    password: Uint8Array,
    salt: Uint8Array,
    parameters: Argon2idParameters,
  ): Promise<Uint8Array>;
  hkdfSha256(
    inputKey: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array>;
  openXChaCha20Poly1305(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
  randomBytes(length: number): Uint8Array;
  sealXChaCha20Poly1305(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array>;
}

function assertIntegerInRange(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CryptoError("INVALID_CRYPTO_INPUT", `${label} is outside its accepted range`);
  }
}

function assertLength(bytes: Uint8Array, expected: number, label: string) {
  if (bytes.length !== expected) {
    throw new CryptoError("INVALID_CRYPTO_INPUT", `${label} must be ${expected} bytes`);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function platformCrypto(): Crypto {
  if (globalThis.crypto?.getRandomValues === undefined || globalThis.crypto.subtle === undefined) {
    throw new CryptoError("CRYPTO_UNAVAILABLE", "Required platform cryptography is unavailable");
  }
  return globalThis.crypto;
}

export function assertProductionKdfParameters(
  parameters: Argon2idParameters,
): asserts parameters is Argon2idParameters {
  const valid =
    parameters.algorithm === ARGON2ID_ALGORITHM &&
    parameters.memoryKiB >= ARGON2ID_PRODUCTION_FLOOR.memoryKiB &&
    parameters.operations >= ARGON2ID_PRODUCTION_FLOOR.operations &&
    parameters.outputLength === ARGON2ID_PRODUCTION_FLOOR.outputLength &&
    parameters.parallelism === ARGON2ID_PRODUCTION_FLOOR.parallelism &&
    Number.isSafeInteger(parameters.memoryKiB) &&
    Number.isSafeInteger(parameters.operations);

  if (!valid) {
    throw new CryptoError("KDF_POLICY_VIOLATION", "KDF policy violation");
  }
}

export function createCryptoProvider(): CryptoProvider {
  return {
    async deriveArgon2id(password, salt, parameters) {
      if (password.length === 0) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Password bytes cannot be empty");
      }
      assertLength(salt, 16, "Argon2id salt");
      if (parameters.algorithm !== ARGON2ID_ALGORITHM || parameters.parallelism !== 1) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Unsupported Argon2id parameters");
      }
      assertIntegerInRange(parameters.memoryKiB, 8, 4_194_304, "Argon2id memory");
      assertIntegerInRange(parameters.operations, 1, 64, "Argon2id operations");
      if (parameters.outputLength !== 32) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Argon2id output must be 32 bytes");
      }

      try {
        await sodium.ready;
        return sodium.crypto_pwhash(
          parameters.outputLength,
          password,
          salt,
          parameters.operations,
          parameters.memoryKiB * 1024,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
      } catch {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Argon2id derivation failed");
      }
    },

    async hkdfSha256(inputKey, salt, info, length) {
      assertIntegerInRange(length, 16, 8160, "HKDF output length");
      if (inputKey.length === 0) {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "HKDF input key cannot be empty");
      }

      const crypto = platformCrypto();
      const inputKeyCopy = inputKey.slice();
      try {
        const key = await crypto.subtle.importKey("raw", inputKeyCopy.buffer, "HKDF", false, [
          "deriveBits",
        ]);
        const bits = await crypto.subtle.deriveBits(
          {
            hash: "SHA-256",
            info: toArrayBuffer(info),
            name: "HKDF",
            salt: toArrayBuffer(salt),
          },
          key,
          length * 8,
        );
        return new Uint8Array(bits);
      } catch (error) {
        if (error instanceof CryptoError) {
          throw error;
        }
        throw new CryptoError("INVALID_CRYPTO_INPUT", "HKDF derivation failed");
      } finally {
        zeroBytes(inputKeyCopy);
      }
    },

    async openXChaCha20Poly1305(key, nonce, ciphertext, aad) {
      assertLength(key, XCHACHA20_POLY1305_KEY_BYTES, "XChaCha20-Poly1305 key");
      assertLength(nonce, XCHACHA20_POLY1305_NONCE_BYTES, "XChaCha20-Poly1305 nonce");
      if (ciphertext.length < XCHACHA20_POLY1305_TAG_BYTES) {
        throw new CryptoError("AUTHENTICATION_FAILED", "Authenticated decryption failed");
      }

      try {
        await sodium.ready;
        return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
      } catch {
        throw new CryptoError("AUTHENTICATION_FAILED", "Authenticated decryption failed");
      }
    },

    randomBytes(length) {
      assertIntegerInRange(length, 1, 65_536, "Random byte length");
      return platformCrypto().getRandomValues(new Uint8Array(length));
    },

    async sealXChaCha20Poly1305(key, nonce, plaintext, aad) {
      assertLength(key, XCHACHA20_POLY1305_KEY_BYTES, "XChaCha20-Poly1305 key");
      assertLength(nonce, XCHACHA20_POLY1305_NONCE_BYTES, "XChaCha20-Poly1305 nonce");

      try {
        await sodium.ready;
        return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key);
      } catch {
        throw new CryptoError("INVALID_CRYPTO_INPUT", "Authenticated encryption failed");
      }
    },
  };
}

export function encodeEnvelopeAad(context: EnvelopeAadContext): Uint8Array {
  const fields = [
    "zk-wallet-envelope",
    String(context.envelopeVersion),
    context.algorithm,
    context.purpose,
    context.vaultId,
    context.subjectId,
    String(context.contentSchemaVersion),
  ].map(utf8ToBytes);
  const totalLength = fields.reduce((total, field) => total + 4 + field.length, 0);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  let offset = 0;

  for (const field of fields) {
    assertIntegerInRange(field.length, 0, 65_535, "Authenticated context field length");
    view.setUint32(offset, field.length, false);
    offset += 4;
    output.set(field, offset);
    offset += field.length;
  }

  return output;
}

export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/u.test(value)) {
    throw new CryptoError("INVALID_CRYPTO_INPUT", "Hex input is not canonical lowercase bytes");
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new CryptoError("INVALID_CRYPTO_INPUT", "Base64url input is not canonical");
  }

  try {
    const paddingLength = (4 - (value.length % 4)) % 4;
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytesToBase64Url(bytes) !== value) {
      throw new Error("non-canonical");
    }
    return bytes;
  } catch {
    throw new CryptoError("INVALID_CRYPTO_INPUT", "Base64url input is invalid");
  }
}

export function zeroBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}

export type DevicePrfCapability = "supported" | "unsupported";

export interface DevicePrfEnrollmentRequest {
  readonly prfInput: Uint8Array;
  readonly userId: Uint8Array;
}

export interface DevicePrfEvaluationRequest {
  readonly credentialId: string;
  readonly prfInput: Uint8Array;
}

export interface DevicePrfEnrollmentResult {
  readonly credentialId: string;
  readonly prfOutput: Uint8Array;
}

export interface DevicePrfProvider {
  enroll(request: DevicePrfEnrollmentRequest): Promise<DevicePrfEnrollmentResult>;
  evaluate(request: DevicePrfEvaluationRequest): Promise<Uint8Array>;
  getCapability(): Promise<DevicePrfCapability>;
}

export interface WebAuthnPrfPlatform {
  readonly credentials: Pick<CredentialsContainer, "create" | "get">;
  readonly getClientCapabilities?: () => Promise<Record<string, boolean>>;
  readonly hostname?: string;
  readonly protocol: string;
  readonly randomBytes: (length: number) => Uint8Array;
}

export interface WebAuthnPrfProviderOptions {
  readonly platform?: WebAuthnPrfPlatform;
}

export class DevicePrfError extends Error {
  readonly code = "PRF_OPERATION_FAILED" as const;

  constructor() {
    super("Device unlock failed");
    this.name = "DevicePrfError";
  }
}

type PrfExtensionResult = {
  readonly enabled?: boolean;
  readonly results?: { readonly first?: ArrayBuffer };
};

function defaultWebAuthnPrfPlatform(): WebAuthnPrfPlatform | null {
  const credentialConstructor = globalThis.PublicKeyCredential as unknown as
    | {
        readonly getClientCapabilities?: () => Promise<Record<string, boolean>>;
      }
    | undefined;
  if (
    globalThis.navigator?.credentials === undefined ||
    credentialConstructor?.getClientCapabilities === undefined ||
    globalThis.location === undefined
  ) {
    return null;
  }

  return {
    credentials: globalThis.navigator.credentials,
    getClientCapabilities: () =>
      credentialConstructor.getClientCapabilities?.() ?? Promise.resolve({}),
    hostname: globalThis.location.hostname,
    protocol: globalThis.location.protocol,
    randomBytes: (length) => platformCrypto().getRandomValues(new Uint8Array(length)),
  };
}

function isEligibleWebOrigin(platform: WebAuthnPrfPlatform): boolean {
  return (
    platform.protocol === "https:" ||
    (platform.protocol === "http:" &&
      (platform.hostname === "localhost" || platform.hostname === "127.0.0.1"))
  );
}

function assertPrfInput(input: Uint8Array): void {
  if (input.length !== 32) throw new DevicePrfError();
}

function prfResult(credential: Credential | null, requireEnabled: boolean): Uint8Array | null {
  const candidate = credential as
    | (Credential & {
        readonly getClientExtensionResults?: () => { readonly prf?: PrfExtensionResult };
      })
    | null;
  if (candidate?.getClientExtensionResults === undefined) return null;
  const prf = candidate.getClientExtensionResults().prf;
  if (requireEnabled && prf?.enabled !== true) return null;
  const first = prf?.results?.first;
  if (first === undefined) return null;
  const output = new Uint8Array(first.slice(0));
  if (output.length !== 32) {
    zeroBytes(output);
    return null;
  }
  return output;
}

function credentialIdBytes(credentialId: string): Uint8Array {
  try {
    const bytes = base64UrlToBytes(credentialId);
    if (bytes.length === 0 || bytes.length > 1024) throw new Error("credential ID length");
    return bytes;
  } catch {
    throw new DevicePrfError();
  }
}

export function createWebAuthnPrfProvider(
  options: WebAuthnPrfProviderOptions = {},
): DevicePrfProvider {
  const platform = options.platform ?? defaultWebAuthnPrfPlatform();

  async function getCapability(): Promise<DevicePrfCapability> {
    if (
      platform === null ||
      !isEligibleWebOrigin(platform) ||
      platform.getClientCapabilities === undefined
    ) {
      return "unsupported";
    }
    try {
      const capabilities = await platform.getClientCapabilities();
      return capabilities["extension:prf"] === true ? "supported" : "unsupported";
    } catch {
      return "unsupported";
    }
  }

  async function evaluate(request: DevicePrfEvaluationRequest): Promise<Uint8Array> {
    try {
      if (platform === null || (await getCapability()) !== "supported") {
        throw new DevicePrfError();
      }
      assertPrfInput(request.prfInput);
      const credentialId = credentialIdBytes(request.credentialId);
      const challenge = platform.randomBytes(32);
      if (challenge.length !== 32) throw new DevicePrfError();
      const options = {
        publicKey: {
          allowCredentials: [{ id: credentialId, type: "public-key" }],
          challenge,
          extensions: {
            prf: {
              evalByCredential: {
                [request.credentialId]: { first: request.prfInput },
              },
            },
          },
          timeout: 120_000,
          userVerification: "required",
        },
      } as unknown as CredentialRequestOptions;
      const assertion = await platform.credentials.get(options);
      const output = prfResult(assertion, false);
      if (output === null) throw new DevicePrfError();
      return output;
    } catch {
      throw new DevicePrfError();
    }
  }

  return {
    async enroll(request) {
      try {
        if (platform === null || (await getCapability()) !== "supported") {
          throw new DevicePrfError();
        }
        assertPrfInput(request.prfInput);
        if (request.userId.length === 0 || request.userId.length > 64) {
          throw new DevicePrfError();
        }
        const challenge = platform.randomBytes(32);
        if (challenge.length !== 32) throw new DevicePrfError();
        const options = {
          publicKey: {
            attestation: "none",
            authenticatorSelection: {
              residentKey: "preferred",
              userVerification: "required",
            },
            challenge,
            extensions: { prf: { eval: { first: request.prfInput } } },
            pubKeyCredParams: [
              { alg: -7, type: "public-key" },
              { alg: -257, type: "public-key" },
            ],
            rp: { name: "Zero-Knowledge Wallet" },
            timeout: 120_000,
            user: {
              displayName: "Local vault",
              id: request.userId,
              name: "local-vault",
            },
          },
        } as unknown as CredentialCreationOptions;
        const created = await platform.credentials.create(options);
        const candidate = created as
          | (Credential & {
              readonly getClientExtensionResults?: () => { readonly prf?: PrfExtensionResult };
              readonly rawId?: ArrayBuffer;
            })
          | null;
        const rawId = candidate?.rawId;
        const extension = candidate?.getClientExtensionResults?.() as
          | { readonly prf?: PrfExtensionResult }
          | undefined;
        if (rawId === undefined || extension?.prf?.enabled !== true) {
          throw new DevicePrfError();
        }
        const credentialId = bytesToBase64Url(new Uint8Array(rawId.slice(0)));
        const prfOutput = await evaluate({ credentialId, prfInput: request.prfInput });
        return { credentialId, prfOutput };
      } catch {
        throw new DevicePrfError();
      }
    },
    evaluate,
    getCapability,
  };
}
