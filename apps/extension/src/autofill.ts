import type { RandomSource } from "@zk-wallet/security";

export const AUTOFILL_REQUEST_TYPE = "zk-wallet.autofill-request.v1" as const;
export const AUTOFILL_FILLED_TYPE = "zk-wallet.autofill-filled.v1" as const;
export const AUTHENTICATED_AUTOFILL_SELECT_TYPE =
  "zk-wallet.authenticated-autofill-select.v1" as const;
export const BIOMETRIC_AUTOFILL_REQUEST_TYPE = "zk-wallet.biometric-autofill-request.v1" as const;
export const MANUAL_AUTOFILL_REQUEST_TYPE = "zk-wallet.manual-autofill-request.v1" as const;
export const BIOMETRIC_FILL_TYPE = "zk-wallet.biometric-fill.v1" as const;
export const CAPTURE_REQUEST_TYPE = "zk-wallet.capture-request.v1" as const;
export const CAPTURE_CONFIRM_TYPE = "zk-wallet.capture-confirm.v1" as const;
export const CAPTURE_DISMISS_TYPE = "zk-wallet.capture-dismiss.v1" as const;
export const CAPTURE_PENDING_TYPE = "zk-wallet.capture-pending.v1" as const;
export const USERNAME_OBSERVED_TYPE = "zk-wallet.username-observed.v1" as const;
export const PROFILE_AUTOFILL_REQUEST_TYPE = "zk-wallet.profile-autofill-request.v1" as const;
export const PROFILE_AUTOFILL_SELECT_TYPE = "zk-wallet.profile-autofill-select.v1" as const;
export const CARD_AUTOFILL_REQUEST_TYPE = "zk-wallet.card-autofill-request.v1" as const;
export const CARD_AUTOFILL_SELECT_TYPE = "zk-wallet.card-autofill-select.v1" as const;
export const SHOW_AUTOFILL_TYPE = "zk-wallet.show-autofill.v1" as const;
export const OPEN_VAULT_MANAGER_TYPE = "zk-wallet.open-vault-manager.v1" as const;

export type ProfileFieldKind =
  | "addressLine1"
  | "addressLine2"
  | "age"
  | "city"
  | "country"
  | "dateOfBirth"
  | "email"
  | "firstName"
  | "lastName"
  | "middleName"
  | "nickname"
  | "organization"
  | "phone"
  | "postalCode"
  | "region";

export type CardFieldKind =
  | "billingAddress"
  | "cardNumber"
  | "cardholderName"
  | "expiry"
  | "expiryMonth"
  | "expiryYear";

interface OriginRequest {
  readonly topUrl: string;
  readonly userInitiated: true;
  readonly version: 1;
}

export interface AutofillRequest extends OriginRequest {
  readonly type: typeof AUTOFILL_REQUEST_TYPE;
}

export interface AutofillFilledRequest {
  readonly password: string;
  readonly topUrl: string;
  readonly type: typeof AUTOFILL_FILLED_TYPE;
  readonly username: string;
  readonly version: 1;
}

export interface AuthenticatedAutofillSelectRequest extends OriginRequest {
  readonly credentialId: string;
  readonly method: "biometric" | "password";
  readonly submit: boolean;
  readonly type: typeof AUTHENTICATED_AUTOFILL_SELECT_TYPE;
}

export interface BiometricAutofillRequest extends OriginRequest {
  readonly type: typeof BIOMETRIC_AUTOFILL_REQUEST_TYPE;
}

export interface ManualAutofillRequest extends OriginRequest {
  readonly type: typeof MANUAL_AUTOFILL_REQUEST_TYPE;
}

export interface BiometricFillRequest {
  readonly password: string;
  readonly submit: boolean;
  readonly topUrl: string;
  readonly type: typeof BIOMETRIC_FILL_TYPE;
  readonly username: string;
  readonly version: 1;
}

export interface CaptureRequest extends OriginRequest {
  readonly password: string;
  readonly type: typeof CAPTURE_REQUEST_TYPE;
  readonly username: string;
}

export interface CaptureActionRequest {
  readonly type: typeof CAPTURE_CONFIRM_TYPE | typeof CAPTURE_DISMISS_TYPE;
  readonly userInitiated: true;
  readonly version: 1;
}

export interface CapturePendingRequest {
  readonly type: typeof CAPTURE_PENDING_TYPE;
  readonly version: 1;
}

export interface UsernameObservedRequest extends OriginRequest {
  readonly type: typeof USERNAME_OBSERVED_TYPE;
  readonly username: string;
}

export interface ProfileAutofillRequest extends OriginRequest {
  readonly field: ProfileFieldKind;
  readonly type: typeof PROFILE_AUTOFILL_REQUEST_TYPE;
}

export interface ProfileAutofillSelectRequest extends OriginRequest {
  readonly field: ProfileFieldKind;
  readonly profileId: string;
  readonly type: typeof PROFILE_AUTOFILL_SELECT_TYPE;
}

export interface CardAutofillRequest extends OriginRequest {
  readonly field: CardFieldKind;
  readonly type: typeof CARD_AUTOFILL_REQUEST_TYPE;
}

export interface CardAutofillSelectRequest extends OriginRequest {
  readonly cardId: string;
  readonly field: CardFieldKind;
  readonly type: typeof CARD_AUTOFILL_SELECT_TYPE;
}

export interface ShowAutofillRequest {
  readonly type: typeof SHOW_AUTOFILL_TYPE;
  readonly version: 1;
}

export interface OpenVaultManagerRequest {
  readonly type: typeof OPEN_VAULT_MANAGER_TYPE;
  readonly userInitiated: true;
  readonly version: 1;
}

export type ProfileAutofillResponse =
  | { readonly status: "locked" | "no-match" | "unavailable"; readonly version: 1 }
  | {
      readonly profiles: readonly { readonly id: string; readonly label: string }[];
      readonly status: "suggestions";
      readonly version: 1;
    }
  | { readonly status: "value"; readonly value: string; readonly version: 1 };

export type CardAutofillResponse =
  | { readonly status: "locked" | "no-match" | "unavailable"; readonly version: 1 }
  | {
      readonly cards: readonly { readonly id: string; readonly label: string }[];
      readonly status: "suggestions";
      readonly version: 1;
    }
  | { readonly status: "value"; readonly value: string; readonly version: 1 };

export type AutofillResponse =
  | { readonly status: "no-match" | "unavailable"; readonly version: 1 }
  | { readonly status: "filled"; readonly version: 1 }
  | {
      readonly deviceSlots: readonly { readonly id: string }[];
      readonly status: "locked";
      readonly version: 1;
    }
  | { readonly status: "opening-authentication"; readonly version: 1 }
  | {
      readonly credentials: readonly { readonly id: string; readonly username: string }[];
      readonly deviceSlots: readonly { readonly id: string }[];
      readonly displayHost: string;
      readonly status: "suggestions";
      readonly version: 1;
    };

export type CaptureResponse =
  | {
      readonly displayHost?: string;
      readonly status: "locked" | "unchanged" | "unavailable" | "unsafe";
      readonly version: 1;
    }
  | {
      readonly action: "save" | "update";
      readonly displayHost: string;
      readonly status: "offer";
      readonly version: 1;
    }
  | { readonly action: "save" | "update"; readonly status: "saved"; readonly version: 1 };

export function preferNamedCredentials<T extends { readonly username: string }>(
  credentials: readonly T[],
): readonly T[] {
  const named = credentials.filter((credential) => credential.username.trim().length > 0);
  return named.length > 0 ? named : credentials;
}

function normalizedUsername(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function credentialsMatch(
  first: { readonly password: string; readonly username: string },
  second: { readonly password: string; readonly username: string },
): boolean {
  return (
    first.password === second.password &&
    normalizedUsername(first.username) === normalizedUsername(second.username)
  );
}

export function shouldDismissSuggestionsForUsername(
  value: string,
  storedUsernames: readonly string[] | null,
): boolean {
  const typed = normalizedUsername(value);
  if (typed.length === 0) return false;
  if (storedUsernames === null) return true;
  return !storedUsernames.some((username) => normalizedUsername(username).startsWith(typed));
}

function isInvalidatedExtensionContext(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/iu.test(error.message);
}

export function readExtensionRuntimeIdSafely(
  read: () => unknown,
  onContextInvalidated: () => void,
): string | null {
  try {
    const id = read();
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) onContextInvalidated();
    return null;
  }
}

export async function sendRuntimeMessageSafely<T>(
  send: () => Promise<T>,
  onContextInvalidated: () => void,
): Promise<T | undefined> {
  try {
    return await send();
  } catch (error) {
    if (isInvalidatedExtensionContext(error)) onContextInvalidated();
    return undefined;
  }
}

function validOriginRequest(request: Record<string, unknown>): boolean {
  if (
    request.userInitiated !== true ||
    request.version !== 1 ||
    typeof request.topUrl !== "string"
  ) {
    return false;
  }
  try {
    const url = new URL(request.topUrl);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function parseAutofillRequest(value: unknown): AutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "topUrl,type,userInitiated,version" &&
    request.type === AUTOFILL_REQUEST_TYPE &&
    validOriginRequest(request)
    ? (request as unknown as AutofillRequest)
    : null;
}

export function parseAutofillFilledRequest(value: unknown): AutofillFilledRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !== "password,topUrl,type,username,version" ||
    request.type !== AUTOFILL_FILLED_TYPE ||
    request.version !== 1 ||
    typeof request.password !== "string" ||
    request.password.length === 0 ||
    request.password.length > 16_384 ||
    typeof request.username !== "string" ||
    request.username.length > 4_096 ||
    typeof request.topUrl !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(request.topUrl);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? (request as unknown as AutofillFilledRequest)
      : null;
  } catch {
    return null;
  }
}

export async function credentialFingerprint(credential: {
  readonly password: string;
  readonly topUrl: string;
  readonly username: string;
}): Promise<string> {
  const origin = new URL(credential.topUrl).origin;
  const normalized = `${origin.length}:${origin}|${normalizedUsername(credential.username).length}:${normalizedUsername(credential.username)}|${credential.password.length}:${credential.password}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseShowAutofillRequest(value: unknown): ShowAutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "type,version" &&
    request.type === SHOW_AUTOFILL_TYPE &&
    request.version === 1
    ? (request as unknown as ShowAutofillRequest)
    : null;
}

export function parseOpenVaultManagerRequest(value: unknown): OpenVaultManagerRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "type,userInitiated,version" &&
    request.type === OPEN_VAULT_MANAGER_TYPE &&
    request.userInitiated === true &&
    request.version === 1
    ? (request as unknown as OpenVaultManagerRequest)
    : null;
}

function validCredentialId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export function parseAuthenticatedAutofillSelectRequest(
  value: unknown,
): AuthenticatedAutofillSelectRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "credentialId,method,submit,topUrl,type,userInitiated,version" &&
    request.type === AUTHENTICATED_AUTOFILL_SELECT_TYPE &&
    validCredentialId(request.credentialId) &&
    (request.method === "biometric" || request.method === "password") &&
    typeof request.submit === "boolean" &&
    validOriginRequest(request)
    ? (request as unknown as AuthenticatedAutofillSelectRequest)
    : null;
}

export function parseBiometricAutofillRequest(value: unknown): BiometricAutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "topUrl,type,userInitiated,version" &&
    request.type === BIOMETRIC_AUTOFILL_REQUEST_TYPE &&
    validOriginRequest(request)
    ? (request as unknown as BiometricAutofillRequest)
    : null;
}

export function parseManualAutofillRequest(value: unknown): ManualAutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "topUrl,type,userInitiated,version" &&
    request.type === MANUAL_AUTOFILL_REQUEST_TYPE &&
    validOriginRequest(request)
    ? (request as unknown as ManualAutofillRequest)
    : null;
}

export function parseBiometricFillRequest(value: unknown): BiometricFillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !== "password,submit,topUrl,type,username,version" ||
    request.type !== BIOMETRIC_FILL_TYPE ||
    request.version !== 1 ||
    typeof request.password !== "string" ||
    request.password.length === 0 ||
    request.password.length > 16_384 ||
    typeof request.username !== "string" ||
    request.username.length > 4_096 ||
    typeof request.submit !== "boolean" ||
    typeof request.topUrl !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(request.topUrl);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? (request as unknown as BiometricFillRequest)
      : null;
  } catch {
    return null;
  }
}

export function parseCaptureRequest(
  value: unknown,
  type: typeof CAPTURE_REQUEST_TYPE,
): CaptureRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "password,topUrl,type,userInitiated,username,version" &&
    request.type === type &&
    typeof request.password === "string" &&
    request.password.length > 0 &&
    request.password.length <= 16_384 &&
    typeof request.username === "string" &&
    request.username.length <= 4_096 &&
    validOriginRequest(request)
    ? (request as unknown as CaptureRequest)
    : null;
}

export function parseCaptureActionRequest(
  value: unknown,
  type: typeof CAPTURE_CONFIRM_TYPE | typeof CAPTURE_DISMISS_TYPE,
): CaptureActionRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "type,userInitiated,version" &&
    request.type === type &&
    request.userInitiated === true &&
    request.version === 1
    ? (request as unknown as CaptureActionRequest)
    : null;
}

export function parseCapturePendingRequest(value: unknown): CapturePendingRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "type,version" &&
    request.type === CAPTURE_PENDING_TYPE &&
    request.version === 1
    ? (request as unknown as CapturePendingRequest)
    : null;
}

export function parseUsernameObservedRequest(value: unknown): UsernameObservedRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "topUrl,type,userInitiated,username,version" &&
    request.type === USERNAME_OBSERVED_TYPE &&
    typeof request.username === "string" &&
    request.username.length > 0 &&
    request.username.length <= 4_096 &&
    validOriginRequest(request)
    ? (request as unknown as UsernameObservedRequest)
    : null;
}

const PROFILE_FIELDS = new Set<ProfileFieldKind>([
  "addressLine1",
  "addressLine2",
  "age",
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
]);

function validProfileField(value: unknown): value is ProfileFieldKind {
  return typeof value === "string" && PROFILE_FIELDS.has(value as ProfileFieldKind);
}

export function parseProfileAutofillRequest(value: unknown): ProfileAutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "field,topUrl,type,userInitiated,version" &&
    request.type === PROFILE_AUTOFILL_REQUEST_TYPE &&
    validProfileField(request.field) &&
    validOriginRequest(request)
    ? (request as unknown as ProfileAutofillRequest)
    : null;
}

export function parseProfileAutofillSelectRequest(
  value: unknown,
): ProfileAutofillSelectRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "field,profileId,topUrl,type,userInitiated,version" &&
    request.type === PROFILE_AUTOFILL_SELECT_TYPE &&
    validProfileField(request.field) &&
    validCredentialId(request.profileId) &&
    validOriginRequest(request)
    ? (request as unknown as ProfileAutofillSelectRequest)
    : null;
}

const CARD_FIELDS = new Set<CardFieldKind>([
  "billingAddress",
  "cardNumber",
  "cardholderName",
  "expiry",
  "expiryMonth",
  "expiryYear",
]);

function validCardField(value: unknown): value is CardFieldKind {
  return typeof value === "string" && CARD_FIELDS.has(value as CardFieldKind);
}

export function parseCardAutofillRequest(value: unknown): CardAutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") === "field,topUrl,type,userInitiated,version" &&
    request.type === CARD_AUTOFILL_REQUEST_TYPE &&
    validCardField(request.field) &&
    validOriginRequest(request)
    ? (request as unknown as CardAutofillRequest)
    : null;
}

export function parseCardAutofillSelectRequest(value: unknown): CardAutofillSelectRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "cardId,field,topUrl,type,userInitiated,version" &&
    request.type === CARD_AUTOFILL_SELECT_TYPE &&
    validCardField(request.field) &&
    validCredentialId(request.cardId) &&
    validOriginRequest(request)
    ? (request as unknown as CardAutofillSelectRequest)
    : null;
}

export function cardFieldKind(input: HTMLInputElement): CardFieldKind | null {
  if (
    !input.isConnected ||
    input.disabled ||
    input.readOnly ||
    input.type === "password" ||
    input.type === "hidden"
  ) {
    return null;
  }
  const autocomplete = input.autocomplete.trim().split(/\s+/u).at(-1) ?? "";
  const byAutocomplete: Readonly<Record<string, CardFieldKind>> = {
    "billing street-address": "billingAddress",
    "cc-exp": "expiry",
    "cc-exp-month": "expiryMonth",
    "cc-exp-year": "expiryYear",
    "cc-name": "cardholderName",
    "cc-number": "cardNumber",
  };
  const direct = byAutocomplete[autocomplete];
  if (direct !== undefined) return direct;
  // Never classify a security-code field. CVV/CVC is deliberately not persisted or filled.
  if (autocomplete === "cc-csc") return null;
  const hint =
    `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
  if (/\b(cvv|cvc|csc|security[-_\s]*code)\b/u.test(hint)) return null;
  const patterns: readonly [RegExp, CardFieldKind][] = [
    [/\b(card[-_\s]*(holder|owner)[-_\s]*name|name[-_\s]*on[-_\s]*card)\b/u, "cardholderName"],
    [/\b(card[-_\s]*(number|no)|credit[-_\s]*card)\b/u, "cardNumber"],
    [/\b(exp(iry|iration)?[-_\s]*month|month[-_\s]*exp)\b/u, "expiryMonth"],
    [/\b(exp(iry|iration)?[-_\s]*year|year[-_\s]*exp)\b/u, "expiryYear"],
    [/\b(card[-_\s]*exp(iry|iration)?|exp(iry|iration)?[-_\s]*date)\b/u, "expiry"],
    [/\b(billing[-_\s]*address)\b/u, "billingAddress"],
  ];
  return patterns.find(([pattern]) => pattern.test(hint))?.[1] ?? null;
}

export function fillCardField(input: HTMLInputElement, value: string): boolean {
  if (cardFieldKind(input) === null || value.length === 0 || value.length > 8_192) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function profileFieldKind(input: HTMLInputElement): ProfileFieldKind | null {
  if (!input.isConnected || input.disabled || input.readOnly || input.type === "password") {
    return null;
  }
  const autocomplete = input.autocomplete.trim().split(/\s+/u).at(-1) ?? "";
  const byAutocomplete: Readonly<Record<string, ProfileFieldKind>> = {
    "additional-name": "middleName",
    "address-level1": "region",
    "address-level2": "city",
    "address-line1": "addressLine1",
    "address-line2": "addressLine2",
    bday: "dateOfBirth",
    email: "email",
    "family-name": "lastName",
    "given-name": "firstName",
    name: "firstName",
    nickname: "nickname",
    organization: "organization",
    "postal-code": "postalCode",
    tel: "phone",
    "country-name": "country",
  };
  const explicit = byAutocomplete[autocomplete];
  if (explicit !== undefined) {
    const password = input.form?.querySelector<HTMLInputElement>('input[type="password"]') ?? null;
    if (explicit !== "email" || password === null || isRegistrationPasswordField(password)) {
      return explicit;
    }
    return null;
  }
  const formPassword =
    input.form?.querySelector<HTMLInputElement>('input[type="password"]') ?? null;
  if (formPassword !== null && !isRegistrationPasswordField(formPassword)) return null;
  const hint =
    `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
  const patterns: readonly [RegExp, ProfileFieldKind][] = [
    [/\b(first|given)[-_\s]*name\b/u, "firstName"],
    [/\b(middle|additional)[-_\s]*name\b/u, "middleName"],
    [/\b(last|family|surname)[-_\s]*name\b/u, "lastName"],
    [/\bnick[-_\s]*name\b/u, "nickname"],
    [/\be-?mail\b/u, "email"],
    [/\b(phone|mobile|telephone|tel)\b/u, "phone"],
    [/\b(company|organization|organisation)\b/u, "organization"],
    [/\b(birth|birthday|dob)\b/u, "dateOfBirth"],
    [/\bage\b/u, "age"],
    [/\b(address[-_\s]*line[-_\s]*1|street[-_\s]*address)\b/u, "addressLine1"],
    [/\b(address[-_\s]*line[-_\s]*2|apartment|suite|unit)\b/u, "addressLine2"],
    [/\b(city|town)\b/u, "city"],
    [/\b(state|province|region)\b/u, "region"],
    [/\b(zip|postal)[-_\s]*code\b/u, "postalCode"],
    [/\bcountry\b/u, "country"],
  ];
  return patterns.find(([pattern]) => pattern.test(hint))?.[1] ?? null;
}

export function fillProfileField(input: HTMLInputElement, value: string): boolean {
  if (profileFieldKind(input) === null || value.length === 0 || value.length > 8_192) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function isUsernameField(input: HTMLInputElement): boolean {
  if (!input.isConnected || input.disabled || input.readOnly || input.type === "password") {
    return false;
  }
  const hint =
    `${input.autocomplete} ${input.type} ${input.name} ${input.id} ${input.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
  return (
    input.autocomplete === "username" ||
    input.autocomplete === "email" ||
    input.type === "email" ||
    /(?:^|[^a-z])(email|e-mail|user(?:name)?|login)(?:[^a-z]|$)/u.test(hint)
  );
}

export function isCredentialField(element: Element | null): element is HTMLInputElement {
  if (
    !(element instanceof HTMLInputElement) ||
    !element.isConnected ||
    element.disabled ||
    element.readOnly ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }
  if (element.type === "password" || isUsernameField(element)) return true;
  if (element.type !== "text") return false;
  const password = element.form?.querySelector<HTMLInputElement>('input[type="password"]') ?? null;
  return password !== null && !isRegistrationPasswordField(password);
}

function registrationHint(input: HTMLInputElement, includeAutocomplete = true): string {
  const form = input.form;
  const formHint =
    form === null
      ? ""
      : `${form.id} ${form.className} ${form.getAttribute("name") ?? ""} ${form.getAttribute("aria-label") ?? ""} ${form.getAttribute("action") ?? ""} ${[
          ...form.querySelectorAll<HTMLElement>(
            'button, input[type="submit"], [role="button"], h1, h2, legend',
          ),
        ]
          .map((element) => `${element.textContent ?? ""} ${element.getAttribute("value") ?? ""}`)
          .join(" ")}`;
  return `${input.id} ${input.name} ${includeAutocomplete ? input.autocomplete : ""} ${input.getAttribute("aria-label") ?? ""} ${formHint}`.toLocaleLowerCase();
}

export function isRegistrationPasswordField(element: Element | null): element is HTMLInputElement {
  if (
    !(element instanceof HTMLInputElement) ||
    !element.isConnected ||
    element.disabled ||
    element.readOnly ||
    element.type !== "password"
  ) {
    return false;
  }
  if (element.autocomplete === "current-password") return false;
  const hint = registrationHint(element, false);
  const passwordCreationEvidence =
    /(?:^|[^a-z])(?:change[-_\s]*password|confirm[-_\s]*(?:new[-_\s]*)?password|create[-_\s]*(?:an?[-_\s]*)?(?:account|password)|join|new[-_\s]*password|register|registration|reset[-_\s]*password|save[-_\s]*password|sign[-_\s]*up|signup)(?:[^a-z]|$)/u.test(
      hint,
    );
  if (passwordCreationEvidence) return true;
  const currentLoginEvidence =
    /(?:^|[^a-z])(?:continue|log[-_\s]*in|next|sign[-_\s]*in)(?:[^a-z]|$)/u.test(hint);
  return element.autocomplete === "new-password" && !currentLoginEvidence;
}

function passwordFieldIsRegistration(input: HTMLInputElement): boolean {
  return isRegistrationPasswordField(input);
}

export function registrationPasswordFields(
  document: Document,
  anchor: Element | null = null,
): readonly HTMLInputElement[] {
  const candidate =
    anchor instanceof HTMLInputElement && isRegistrationPasswordField(anchor)
      ? anchor
      : [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].find(
          isRegistrationPasswordField,
        );
  if (candidate === undefined || candidate === null) return [];
  const passwords = [
    ...(candidate.form?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? [
      candidate,
    ]),
  ].filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      input.autocomplete !== "current-password",
  );
  return passwords.length === 0 ? [] : passwords;
}

export interface RegistrationPasswordPolicy {
  readonly alphabet: string;
  readonly appleDefault: boolean;
  readonly length: number;
  readonly label: string;
  readonly requiredGroups: readonly string[];
  readonly separator: string | null;
  readonly supportsNoSpecialCharacters: boolean;
}

function describedPasswordRules(input: HTMLInputElement): string {
  const describedBy = (input.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => input.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  return `${input.pattern} ${input.getAttribute("passwordrules") ?? ""} ${input.title} ${
    input.placeholder
  } ${describedBy} ${input.form?.textContent ?? ""}`.toLocaleLowerCase();
}

function numericPasswordRule(rules: string, name: "maxlength" | "minlength"): number | null {
  const match = rules.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*(\\d{1,3})`, "u"));
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 1 && value <= 256 ? value : null;
}

function requiresSpecialCharacter(rules: string): boolean {
  return /required\s*:\s*(?:special|\[[^\]]*[^a-z0-9\s][^\]]*\])/iu.test(rules);
}

function permitsHyphen(input: HTMLInputElement, rules: string): boolean {
  if (/(?:letters?\s+and\s+numbers?\s+only|alphanumeric|\\w\+|\[a-z0-9\]\+?)/iu.test(rules)) {
    return false;
  }
  const allowedRule = rules.match(/allowed\s*:\s*([^;]+)/iu)?.[1];
  if (allowedRule !== undefined) {
    return /special|ascii-printable|unicode|-/iu.test(allowedRule);
  }
  const pattern = input.pattern;
  if (pattern.length === 0) return true;
  try {
    return new RegExp(`^(?:${pattern})$`, "u").test("aaaaaA-aaaaa1-aaaaaa");
  } catch {
    return true;
  }
}

export function registrationPasswordPolicy(input: HTMLInputElement): RegistrationPasswordPolicy {
  const rules = describedPasswordRules(input);
  const statedMinimums = [...rules.matchAll(/(?:at least|minimum|min\.?)\D{0,12}(\d{1,3})/gu)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value >= 8 && value <= 256);
  const declaredMinimum = Math.max(
    input.minLength > 0 ? input.minLength : 0,
    numericPasswordRule(rules, "minlength") ?? 0,
  );
  const minimum = Math.max(12, declaredMinimum, ...statedMinimums);
  const declaredMaximum = Math.min(
    input.maxLength > 0 ? input.maxLength : 256,
    numericPasswordRule(rules, "maxlength") ?? 256,
  );
  const maximum = Math.max(8, Math.min(256, declaredMaximum));
  const length = Math.min(maximum, Math.max(20, minimum));
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const hyphenAllowed = permitsHyphen(input, rules);
  const specialRequired = requiresSpecialCharacter(rules);
  const alphanumericOnly =
    /(?:letters?\s+and\s+numbers?\s+only|alphanumeric|\\w\+|\[a-z0-9\])/u.test(rules) &&
    !/(?:special|symbol|punctuation)/u.test(rules);
  const separator = hyphenAllowed && !alphanumericOnly && length >= 14 ? "-" : null;
  const appleDefault =
    length === 20 &&
    separator === "-" &&
    declaredMinimum <= 20 &&
    declaredMaximum >= 20 &&
    !specialRequired;
  const requiredGroups = [
    lower,
    upper,
    digits,
    ...(specialRequired ? [hyphenAllowed ? "-" : "!@#$%^&*"] : []),
  ];
  return {
    alphabet: requiredGroups.join(""),
    appleDefault,
    length,
    label: appleDefault
      ? "20 characters · three readable groups"
      : `${length} characters · adapted to this site`,
    requiredGroups,
    separator,
    supportsNoSpecialCharacters: !specialRequired,
  };
}

function randomIndex(random: RandomSource, limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
    throw new Error("Invalid random selection limit");
  }
  const ceiling = 256 - (256 % limit);
  for (;;) {
    const value = random.randomBytes(1)[0] ?? 0;
    if (value < ceiling) return value % limit;
  }
}

export type RegistrationPasswordStyle = "easy-to-type" | "no-special" | "strong";

function shuffle(characters: string[], random: RandomSource): void {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(random, index + 1);
    const current = characters[index] ?? "";
    characters[index] = characters[target] ?? "";
    characters[target] = current;
  }
}

function randomCharacter(group: string, random: RandomSource): string {
  return group.charAt(randomIndex(random, group.length));
}

function appleDefaultPassword(random: RandomSource): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const characters = Array.from({ length: 16 }, () => randomCharacter(lower, random));
  characters.push(randomCharacter("ABCDEFGHIJKLMNOPQRSTUVWXYZ", random));
  characters.push(randomCharacter("0123456789", random));
  shuffle(characters, random);
  return `${characters.slice(0, 6).join("")}-${characters.slice(6, 12).join("")}-${characters
    .slice(12)
    .join("")}`;
}

function policyPassword(
  policy: RegistrationPasswordPolicy,
  style: RegistrationPasswordStyle,
  random: RandomSource,
): string {
  const easy = style === "easy-to-type";
  const lower = easy ? "abcdefghjkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz";
  const upper = easy ? "ABCDEFGHJKMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = easy ? "23456789" : "0123456789";
  const allowSeparator = style !== "no-special" && policy.separator !== null;
  const separatorCount = allowSeparator && policy.length >= 14 ? 2 : 0;
  const characterCount = policy.length - separatorCount;
  const required = [
    lower,
    upper,
    digits,
    ...(style === "strong"
      ? policy.requiredGroups.filter(
          (group) =>
            group !== policy.separator &&
            group !== "abcdefghijklmnopqrstuvwxyz" &&
            !/[A-Z0-9]/u.test(group),
        )
      : []),
  ];
  const alphabet = `${lower}${upper}${digits}`;
  const characters = required.map((group) => randomCharacter(group, random));
  while (characters.length < characterCount) {
    characters.push(randomCharacter(alphabet, random));
  }
  shuffle(characters, random);
  if (separatorCount === 0) return characters.join("");
  const firstBreak = Math.floor(characterCount / 3);
  const secondBreak = Math.floor((characterCount * 2) / 3);
  return `${characters.slice(0, firstBreak).join("")}-${characters
    .slice(firstBreak, secondBreak)
    .join("")}-${characters.slice(secondBreak).join("")}`;
}

export function generateAdaptiveRegistrationPassword(
  input: HTMLInputElement,
  random?: RandomSource,
  style: RegistrationPasswordStyle = "strong",
): string {
  const source: RandomSource =
    random ??
    ({
      randomBytes(length: number) {
        return crypto.getRandomValues(new Uint8Array(length));
      },
    } satisfies RandomSource);
  const policy = registrationPasswordPolicy(input);
  if (style === "strong" && policy.appleDefault) return appleDefaultPassword(source);
  return policyPassword(policy, style, source);
}

export function generateStrongRegistrationPassword(random?: RandomSource): string {
  const input = document.createElement("input");
  input.type = "password";
  return generateAdaptiveRegistrationPassword(input, random);
}

export function fillRegistrationPasswordFields(
  document: Document,
  password: string,
  anchor: Element | null = null,
): boolean {
  if (password.length < 8 || password.length > 256) return false;
  const fields = registrationPasswordFields(document, anchor);
  if (fields.length === 0) return false;
  for (const field of fields) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      password,
    );
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

export function isLoginAction(element: Element): boolean {
  const action = element.closest<HTMLElement>(
    'button, input[type="submit"], input[type="button"], [role="button"], a[href]',
  );
  if (action === null) return false;
  if (action instanceof HTMLButtonElement && action.type === "submit") return true;
  if (action instanceof HTMLInputElement && action.type === "submit") return true;
  const label =
    `${"value" in action ? action.value : ""} ${action.textContent ?? ""} ${action.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
  return /\b(?:continue|create\s*(?:an?\s*)?account|join|log\s*in|next|register|sign\s*in|sign\s*up|submit)\b/u.test(
    label,
  );
}

interface LoginFields {
  readonly password: HTMLInputElement;
  readonly username?: HTMLInputElement;
}

function renderedForCredentialUse(input: HTMLInputElement): boolean {
  if (
    !input.isConnected ||
    input.disabled ||
    input.readOnly ||
    input.hidden ||
    input.type === "hidden" ||
    input.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }
  const view = input.ownerDocument.defaultView;
  for (let element: Element | null = input; element !== null; element = element.parentElement) {
    if (
      element.hasAttribute("hidden") ||
      element.hasAttribute("inert") ||
      element.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = view?.getComputedStyle(element);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      style?.contentVisibility === "hidden"
    ) {
      return false;
    }
  }
  return true;
}

function loginFieldCandidates(document: Document): readonly LoginFields[] {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      input.type !== "hidden" &&
      input.getAttribute("aria-hidden") !== "true",
  );
  const passwords = inputs.filter(
    (input) => input.type === "password" && !passwordFieldIsRegistration(input),
  );
  return passwords.map((password) => {
    const formInputs =
      password.form === null ? inputs : inputs.filter((input) => input.form === password.form);
    const username =
      formInputs.find((input) => ["email", "username"].includes(input.autocomplete)) ??
      formInputs.find((input) => ["email", "text"].includes(input.type) && input !== password);
    return { password, ...(username === undefined ? {} : { username }) };
  });
}

function visibleCredentialFieldScore(input: HTMLInputElement): number {
  const view = input.ownerDocument.defaultView;
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const viewportWidth = view?.innerWidth ?? 0;
  const viewportHeight = view?.innerHeight ?? 0;
  const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  if (visibleWidth === 0 || visibleHeight === 0) return 0;
  const visibleRatio = (visibleWidth * visibleHeight) / (rect.width * rect.height);
  return 40 + Math.round(visibleRatio * 20);
}

function selectLoginFields(
  document: Document,
  credential?: { readonly password: string; readonly username: string },
): LoginFields | null {
  const active = document.activeElement;
  const compatible = loginFieldCandidates(document)
    .filter(({ password, username }) => {
      if (!renderedForCredentialUse(password)) return false;
      if (credential === undefined) return true;
      if (password.value.length > 0 && password.value !== credential.password) return false;
      return !(
        username !== undefined &&
        username.value.length > 0 &&
        normalizedUsername(username.value) !== normalizedUsername(credential.username)
      );
    })
    .map((fields) => {
      let score = 0;
      if (active === fields.password || active === fields.username) score += 100;
      else if (
        active instanceof Element &&
        fields.password.form !== null &&
        active.closest("form") === fields.password.form
      ) {
        score += 80;
      }
      if (renderedForCredentialUse(fields.password)) score += 20;
      if (fields.username !== undefined && renderedForCredentialUse(fields.username)) score += 10;
      score += visibleCredentialFieldScore(fields.password);
      if (fields.username !== undefined) {
        score += Math.round(visibleCredentialFieldScore(fields.username) / 2);
      }
      if (fields.password.autocomplete === "current-password") score += 5;
      if (fields.password.form !== null) score += 4;
      if (credential !== undefined) {
        score += fields.password.value === credential.password ? 16 : 8;
        if (fields.username !== undefined) {
          score +=
            normalizedUsername(fields.username.value) === normalizedUsername(credential.username)
              ? 16
              : 8;
        }
      }
      return { fields, score };
    })
    .sort((left, right) => right.score - left.score);
  const best = compatible[0];
  if (best === undefined || compatible[1]?.score === best.score) return null;
  return best.fields;
}

export function loginFields(document: Document): LoginFields | null {
  return selectLoginFields(document);
}

export function usernameFieldForCredentialAnchor(
  document: Document,
  anchor: Element | null,
): HTMLInputElement | null {
  if (anchor instanceof HTMLInputElement && isUsernameField(anchor)) return anchor;
  return loginFields(document)?.username ?? null;
}

export function fillLoginFields(
  document: Document,
  credential: { readonly password: string; readonly username: string },
): boolean {
  const fields = selectLoginFields(document, credential);
  if (fields === null) return false;
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (fields.username !== undefined && fields.username.value.length === 0) {
    setValue(fields.username, credential.username);
  }
  if (fields.password.value.length === 0) setValue(fields.password, credential.password);
  return (
    fields.password.value === credential.password &&
    (fields.username === undefined ||
      normalizedUsername(fields.username.value) === normalizedUsername(credential.username))
  );
}

export function submitLoginForm(document: Document): boolean {
  const password = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].find(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      !passwordFieldIsRegistration(input) &&
      input.value.length > 0,
  );
  const form = password?.form;
  if (form === null || form === undefined) return false;
  const submitters = [
    ...form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="button"]',
    ),
  ].filter((element) => element.isConnected && !element.disabled && isLoginAction(element));
  if (submitters.length !== 1) return false;
  form.requestSubmit(submitters[0]);
  return true;
}

export function captureLoginFields(document: Document): {
  readonly password: string;
  readonly username: string;
} | null;
export function captureLoginFields(
  document: Document,
  anchor: Element | null,
): {
  readonly password: string;
  readonly username: string;
} | null;
export function captureLoginFields(
  document: Document,
  anchor: Element | null = null,
): {
  readonly password: string;
  readonly username: string;
} | null {
  const anchorForm =
    anchor instanceof HTMLFormElement
      ? anchor
      : anchor instanceof HTMLInputElement || anchor instanceof HTMLButtonElement
        ? anchor.form
        : (anchor?.closest("form") ?? null);
  const scope: ParentNode = anchorForm ?? document;
  const passwords = [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      renderedForCredentialUse(input) &&
      input.value.length > 0,
  );
  const password =
    anchor instanceof HTMLInputElement && anchor.type === "password" && passwords.includes(anchor)
      ? anchor
      : passwords.at(-1);
  if (password === undefined) return null;
  if (isRegistrationPasswordField(password)) {
    const registrationPasswords = registrationPasswordFields(document, password);
    if (
      registrationPasswords.length === 0 ||
      registrationPasswords.some((input) => input.value !== password.value)
    ) {
      return null;
    }
  }
  const inputs = [...(password.form?.querySelectorAll<HTMLInputElement>("input") ?? [])];
  const username =
    inputs.find(isUsernameField) ?? inputs.find((input) => ["email", "text"].includes(input.type));
  return { password: password.value, username: username?.value ?? "" };
}
