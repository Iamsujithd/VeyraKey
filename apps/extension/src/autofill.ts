export const AUTOFILL_REQUEST_TYPE = "zk-wallet.autofill-request.v1" as const;

export interface AutofillRequest {
  readonly topUrl: string;
  readonly type: typeof AUTOFILL_REQUEST_TYPE;
  readonly userInitiated: true;
  readonly version: 1;
}

export type AutofillResponse =
  | { readonly status: "ambiguous" | "locked" | "no-match" | "unavailable"; readonly version: 1 }
  | {
      readonly password: string;
      readonly status: "fill";
      readonly username: string;
      readonly version: 1;
    };

export function parseAutofillRequest(value: unknown): AutofillRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !== "topUrl,type,userInitiated,version" ||
    request.type !== AUTOFILL_REQUEST_TYPE ||
    request.userInitiated !== true ||
    request.version !== 1 ||
    typeof request.topUrl !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(request.topUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  } catch {
    return null;
  }
  return request as unknown as AutofillRequest;
}

export function fillLoginFields(
  document: Document,
  credential: { readonly password: string; readonly username: string },
): boolean {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) =>
      input.isConnected &&
      !input.disabled &&
      !input.readOnly &&
      input.type !== "hidden" &&
      input.getAttribute("aria-hidden") !== "true",
  );
  const passwordInput = inputs.find(
    (input) =>
      input.type === "password" &&
      input.autocomplete !== "new-password" &&
      input.value.length === 0,
  );
  if (passwordInput === undefined) return false;
  const formInputs =
    passwordInput.form === null
      ? inputs
      : inputs.filter((input) => input.form === passwordInput.form);
  const usernameInput =
    formInputs.find(
      (input) =>
        input.value.length === 0 && ["email", "username"].includes(input.autocomplete),
    ) ??
    formInputs.find(
      (input) =>
        input.value.length === 0 &&
        ["email", "text"].includes(input.type) &&
        input !== passwordInput,
    );
  const setValue = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (usernameInput !== undefined) setValue(usernameInput, credential.username);
  setValue(passwordInput, credential.password);
  return true;
}
