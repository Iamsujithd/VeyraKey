export const AUTOFILL_REQUEST_TYPE = "zk-wallet.autofill-request.v1" as const;
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

interface OriginRequest {
  readonly topUrl: string;
  readonly userInitiated: true;
  readonly version: 1;
}

export interface AutofillRequest extends OriginRequest {
  readonly type: typeof AUTOFILL_REQUEST_TYPE;
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

export type AutofillResponse =
  | { readonly status: "no-match" | "unavailable"; readonly version: 1 }
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
  | { readonly status: "locked" | "unchanged" | "unavailable" | "unsafe"; readonly version: 1 }
  | {
      readonly action: "save" | "update";
      readonly displayHost: string;
      readonly status: "offer";
      readonly version: 1;
    }
  | { readonly action: "save" | "update"; readonly status: "saved"; readonly version: 1 };

function isInvalidatedExtensionContext(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/iu.test(error.message);
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
  return (
    element instanceof HTMLInputElement &&
    element.isConnected &&
    !element.disabled &&
    !element.readOnly &&
    element.getAttribute("aria-hidden") !== "true" &&
    ["email", "password", "text"].includes(element.type)
  );
}

export function isLoginAction(element: Element): boolean {
  const action = element.closest<HTMLButtonElement | HTMLInputElement>(
    'button, input[type="submit"], input[type="button"]',
  );
  if (action === null) return false;
  if (action instanceof HTMLButtonElement && action.type === "submit") return true;
  if (action instanceof HTMLInputElement && action.type === "submit") return true;
  const label =
    `${"value" in action ? action.value : ""} ${action.textContent ?? ""} ${action.getAttribute("aria-label") ?? ""}`.toLocaleLowerCase();
  return /\b(?:continue|log\s*in|next|sign\s*in|submit)\b/u.test(label);
}

export function loginFields(document: Document): {
  readonly password: HTMLInputElement;
  readonly username?: HTMLInputElement;
} | null {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      input.type !== "hidden" &&
      input.getAttribute("aria-hidden") !== "true",
  );
  const password = inputs.find(
    (input) => input.type === "password" && input.autocomplete !== "new-password",
  );
  if (password === undefined) return null;
  const formInputs =
    password.form === null ? inputs : inputs.filter((input) => input.form === password.form);
  const username =
    formInputs.find((input) => ["email", "username"].includes(input.autocomplete)) ??
    formInputs.find((input) => ["email", "text"].includes(input.type) && input !== password);
  return { password, ...(username === undefined ? {} : { username }) };
}

export function fillLoginFields(
  document: Document,
  credential: { readonly password: string; readonly username: string },
): boolean {
  const fields = loginFields(document);
  if (fields === null) return false;
  if (fields.password.value.length > 0 && fields.password.value !== credential.password)
    return false;
  if (
    fields.username !== undefined &&
    fields.username.value.length > 0 &&
    fields.username.value !== credential.username
  ) {
    return false;
  }
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (fields.username !== undefined && fields.username.value.length === 0) {
    setValue(fields.username, credential.username);
  }
  if (fields.password.value.length === 0) setValue(fields.password, credential.password);
  return true;
}

export function submitLoginForm(document: Document): boolean {
  const password = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].find(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      input.autocomplete !== "new-password" &&
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
} | null {
  const passwords = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ].filter(
    (input) => input.isConnected && !input.disabled && !input.readOnly && input.value.length > 0,
  );
  const password = passwords.at(-1);
  if (password === undefined) return null;
  const inputs = [...(password.form?.querySelectorAll<HTMLInputElement>("input") ?? [])];
  const username =
    inputs.find(isUsernameField) ?? inputs.find((input) => ["email", "text"].includes(input.type));
  return { password: password.value, username: username?.value ?? "" };
}
