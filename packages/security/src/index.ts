const MAX_ORIGIN_LENGTH = 2_048;

export {
  analyzePasswordHealth,
  checkPwnedPassword,
  type PasswordHealthFinding,
  type PasswordHealthLogin,
  type PwnedPasswordOptions,
  type PwnedPasswordResult,
  parsePwnedPasswordRange,
} from "./password-health";
export {
  BUILT_IN_PASSPHRASE_WORDS,
  type ClipboardPort,
  copyWithBestEffortClear,
  generatePassphrase,
  generatePassword,
  generateTotp,
  parseOtpAuthQr,
  parseOtpAuthUri,
  type QrCodeDetector,
  type RandomSource,
  type TotpConfiguration,
} from "./secrets";

export type AutofillRefusal =
  | "AMBIGUOUS_ACCOUNT"
  | "CROSS_ORIGIN_FRAME"
  | "INSECURE_SCHEME"
  | "INVALID_ORIGIN"
  | "NO_EXACT_MATCH"
  | "OPAQUE_ORIGIN"
  | "USER_ACTION_REQUIRED";

export type AutofillDecision =
  | {
      readonly allowed: true;
      readonly canonicalOrigin: string;
      readonly credentialId: string;
      readonly displayHost: string;
    }
  | {
      readonly allowed: false;
      readonly reason: AutofillRefusal;
    };

export interface OriginCredential {
  readonly id: string;
  readonly uris: readonly string[];
}

interface ParsedOrigin {
  readonly canonicalOrigin: string;
  readonly displayHost: string;
}

function parseHttpsOrigin(value: string): ParsedOrigin | AutofillRefusal {
  if (value.length === 0 || value.length > MAX_ORIGIN_LENGTH) return "INVALID_ORIGIN";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "INVALID_ORIGIN";
  }
  if (url.origin === "null") return "OPAQUE_ORIGIN";
  if (url.protocol !== "https:") return "INSECURE_SCHEME";
  if (url.username !== "" || url.password !== "") return "INVALID_ORIGIN";
  return {
    canonicalOrigin: url.origin,
    displayHost: url.hostname,
  };
}

export function decideAutofill(options: {
  readonly credentials: readonly OriginCredential[];
  readonly frameUrl: string;
  readonly topUrl: string;
  readonly userInitiated: boolean;
}): AutofillDecision {
  if (!options.userInitiated) return { allowed: false, reason: "USER_ACTION_REQUIRED" };
  const top = parseHttpsOrigin(options.topUrl);
  if (typeof top === "string") return { allowed: false, reason: top };
  const frame = parseHttpsOrigin(options.frameUrl);
  if (typeof frame === "string") return { allowed: false, reason: frame };
  if (top.canonicalOrigin !== frame.canonicalOrigin) {
    return { allowed: false, reason: "CROSS_ORIGIN_FRAME" };
  }
  const matches = options.credentials.filter((credential) =>
    credential.uris.some((uri) => {
      const saved = parseHttpsOrigin(uri);
      return typeof saved !== "string" && saved.canonicalOrigin === top.canonicalOrigin;
    }),
  );
  if (matches.length === 0) return { allowed: false, reason: "NO_EXACT_MATCH" };
  if (matches.length > 1) return { allowed: false, reason: "AMBIGUOUS_ACCOUNT" };
  return {
    allowed: true,
    canonicalOrigin: top.canonicalOrigin,
    credentialId: matches[0]?.id ?? "",
    displayHost: top.displayHost,
  };
}

export interface CredentialFormFields {
  readonly password: HTMLInputElement;
  readonly username: HTMLInputElement | null;
}

function visibleEditable(input: HTMLInputElement): boolean {
  return (
    input.isConnected &&
    !input.disabled &&
    !input.readOnly &&
    input.type !== "hidden" &&
    input.getAttribute("aria-hidden") !== "true"
  );
}

export function findCredentialFields(root: ParentNode): CredentialFormFields | null {
  const inputs = [...root.querySelectorAll<HTMLInputElement>("input")].filter(visibleEditable);
  const password = inputs.find(
    (input) =>
      input.type === "password" ||
      ["current-password", "new-password"].includes(input.autocomplete),
  );
  if (password === undefined) return null;
  const username =
    inputs.find((input) => ["email", "username"].includes(input.autocomplete)) ??
    inputs.find((input) => ["email", "text"].includes(input.type)) ??
    null;
  return { password, username };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillCredentialFields(
  fields: CredentialFormFields,
  credential: { readonly password: string; readonly username: string },
): void {
  if (
    !visibleEditable(fields.password) ||
    (fields.username !== null && !visibleEditable(fields.username))
  ) {
    throw new Error("Credential form changed before fill");
  }
  if (fields.username !== null) setInputValue(fields.username, credential.username);
  setInputValue(fields.password, credential.password);
}

export interface CapturedCredential {
  readonly password: string;
  readonly username: string;
}

export function captureCredentialFields(fields: CredentialFormFields): CapturedCredential | null {
  if (!visibleEditable(fields.password) || fields.password.value.length === 0) return null;
  return {
    password: fields.password.value,
    username: fields.username?.value ?? "",
  };
}

export type CredentialCaptureDecision =
  | {
      readonly action: "none";
      readonly reason: "EMPTY_PASSWORD" | "INSECURE_CONTEXT" | "UNCHANGED";
    }
  | {
      readonly action: "save";
      readonly canonicalOrigin: string;
      readonly displayHost: string;
    }
  | {
      readonly action: "update";
      readonly canonicalOrigin: string;
      readonly credentialId: string;
      readonly displayHost: string;
    };

export function decideCredentialCapture(options: {
  readonly captured: CapturedCredential;
  readonly credentials: readonly (OriginCredential & {
    readonly username: string;
    readonly passwordMatches: boolean;
  })[];
  readonly frameUrl: string;
  readonly topUrl: string;
}): CredentialCaptureDecision {
  if (options.captured.password.length === 0) return { action: "none", reason: "EMPTY_PASSWORD" };
  const context = decideAutofill({
    credentials:
      options.credentials.length === 0
        ? [{ id: "capture-probe", uris: [options.topUrl] }]
        : options.credentials,
    frameUrl: options.frameUrl,
    topUrl: options.topUrl,
    userInitiated: true,
  });
  if (!context.allowed && !["NO_EXACT_MATCH", "AMBIGUOUS_ACCOUNT"].includes(context.reason)) {
    return { action: "none", reason: "INSECURE_CONTEXT" };
  }
  const parsed = parseHttpsOrigin(options.topUrl);
  if (typeof parsed === "string") return { action: "none", reason: "INSECURE_CONTEXT" };
  const exact = options.credentials.filter((credential) =>
    credential.uris.some((uri) => {
      const saved = parseHttpsOrigin(uri);
      return typeof saved !== "string" && saved.canonicalOrigin === parsed.canonicalOrigin;
    }),
  );
  const account = exact.find((credential) => credential.username === options.captured.username);
  if (account === undefined) {
    return {
      action: "save",
      canonicalOrigin: parsed.canonicalOrigin,
      displayHost: parsed.displayHost,
    };
  }
  if (account.passwordMatches) return { action: "none", reason: "UNCHANGED" };
  return {
    action: "update",
    canonicalOrigin: parsed.canonicalOrigin,
    credentialId: account.id,
    displayHost: parsed.displayHost,
  };
}
