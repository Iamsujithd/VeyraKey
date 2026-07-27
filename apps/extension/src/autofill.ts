export const AUTOFILL_REQUEST_TYPE = "zk-wallet.autofill-request.v1" as const;
export const AUTOFILL_SELECT_TYPE = "zk-wallet.autofill-select.v1" as const;
export const CAPTURE_REQUEST_TYPE = "zk-wallet.capture-request.v1" as const;
export const CAPTURE_CONFIRM_TYPE = "zk-wallet.capture-confirm.v1" as const;
export const USERNAME_OBSERVED_TYPE = "zk-wallet.username-observed.v1" as const;

interface OriginRequest {
  readonly topUrl: string;
  readonly userInitiated: true;
  readonly version: 1;
}

export interface AutofillRequest extends OriginRequest {
  readonly type: typeof AUTOFILL_REQUEST_TYPE;
}

export interface AutofillSelectRequest extends OriginRequest {
  readonly credentialId: string;
  readonly type: typeof AUTOFILL_SELECT_TYPE;
}

export interface CaptureRequest extends OriginRequest {
  readonly password: string;
  readonly type: typeof CAPTURE_REQUEST_TYPE | typeof CAPTURE_CONFIRM_TYPE;
  readonly username: string;
}

export interface UsernameObservedRequest extends OriginRequest {
  readonly type: typeof USERNAME_OBSERVED_TYPE;
  readonly username: string;
}

export type AutofillResponse =
  | { readonly status: "locked" | "no-match" | "unavailable"; readonly version: 1 }
  | {
      readonly credentials: readonly { readonly id: string; readonly username: string }[];
      readonly displayHost: string;
      readonly status: "suggestions";
      readonly version: 1;
    }
  | {
      readonly password: string;
      readonly status: "fill";
      readonly username: string;
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

export function parseAutofillSelectRequest(value: unknown): AutofillSelectRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "credentialId,topUrl,type,userInitiated,version" &&
    request.type === AUTOFILL_SELECT_TYPE &&
    typeof request.credentialId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(request.credentialId) &&
    validOriginRequest(request)
    ? (request as unknown as AutofillSelectRequest)
    : null;
}

export function parseCaptureRequest(
  value: unknown,
  type: typeof CAPTURE_REQUEST_TYPE | typeof CAPTURE_CONFIRM_TYPE,
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

export function parseUsernameObservedRequest(value: unknown): UsernameObservedRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  return Object.keys(request).sort().join(",") ===
    "topUrl,type,userInitiated,username,version" &&
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
    (input) =>
      input.type === "password" &&
      input.autocomplete !== "new-password" &&
      input.value.length === 0,
  );
  if (password === undefined) return null;
  const formInputs =
    password.form === null ? inputs : inputs.filter((input) => input.form === password.form);
  const username =
    formInputs.find(
      (input) =>
        input.value.length === 0 && ["email", "username"].includes(input.autocomplete),
    ) ??
    formInputs.find(
      (input) =>
        input.value.length === 0 && ["email", "text"].includes(input.type) && input !== password,
    );
  return { password, ...(username === undefined ? {} : { username }) };
}

export function fillLoginFields(
  document: Document,
  credential: { readonly password: string; readonly username: string },
): boolean {
  const fields = loginFields(document);
  if (fields === null) return false;
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (fields.username !== undefined) setValue(fields.username, credential.username);
  setValue(fields.password, credential.password);
  return true;
}

export function captureLoginFields(document: Document): {
  readonly password: string;
  readonly username: string;
} | null {
  const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (input) => input.isConnected && !input.disabled && !input.readOnly && input.value.length > 0,
  );
  const password = passwords.at(-1);
  if (password === undefined) return null;
  const inputs = [...(password.form?.querySelectorAll<HTMLInputElement>("input") ?? [])];
  const username =
    inputs.find(isUsernameField) ??
    inputs.find((input) => ["email", "text"].includes(input.type));
  return { password: password.value, username: username?.value ?? "" };
}
