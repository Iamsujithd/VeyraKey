const HIBP_RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range/";
const MAX_HIBP_RESPONSE_BYTES = 4 * 1024 * 1024;
const SHA1_SUFFIX = /^[0-9A-F]{35}$/u;
const DECIMAL_COUNT = /^(0|[1-9][0-9]{0,11})$/u;

export interface PasswordHealthLogin {
  readonly id: string;
  readonly password: string;
}

export interface PasswordHealthFinding {
  readonly id: string;
  readonly reused: boolean;
  readonly weak: boolean;
}

export function analyzePasswordHealth(
  logins: readonly PasswordHealthLogin[],
): readonly PasswordHealthFinding[] {
  const reuseCounts = new Map<string, number>();
  for (const login of logins) {
    reuseCounts.set(login.password, (reuseCounts.get(login.password) ?? 0) + 1);
  }
  return logins.map((login) => {
    return {
      id: login.id,
      reused: login.password.length > 0 && (reuseCounts.get(login.password) ?? 0) > 1,
      weak: isWeakPassword(login.password),
    };
  });
}

function isWeakPassword(password: string): boolean {
  if (password.length < 12) return true;
  let classes = 0;
  if (/[a-z]/u.test(password)) classes++;
  if (/[A-Z]/u.test(password)) classes++;
  if (/[0-9]/u.test(password)) classes++;
  if (/[^A-Za-z0-9]/u.test(password)) classes++;
  return classes < 3 || /^(.)\1+$/u.test(password);
}

export type PwnedPasswordResult =
  | { readonly count: number; readonly status: "found" }
  | { readonly status: "not-found" }
  | { readonly reason: "network" | "response"; readonly status: "unavailable" };

export interface PwnedPasswordOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly subtle?: SubtleCrypto;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function parsePwnedPasswordRange(body: string, expectedSuffix: string): number {
  if (new TextEncoder().encode(body).byteLength > MAX_HIBP_RESPONSE_BYTES) {
    throw new TypeError("Pwned Passwords response is too large");
  }
  if (!SHA1_SUFFIX.test(expectedSuffix)) throw new TypeError("Invalid SHA-1 suffix");
  let match = 0;
  for (const line of body.split(/\r?\n/u)) {
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator !== 35 || line.indexOf(":", separator + 1) !== -1) {
      throw new TypeError("Malformed Pwned Passwords response");
    }
    const suffix = line.slice(0, separator);
    const countText = line.slice(separator + 1);
    if (!SHA1_SUFFIX.test(suffix) || !DECIMAL_COUNT.test(countText)) {
      throw new TypeError("Malformed Pwned Passwords response");
    }
    const count = Number(countText);
    if (!Number.isSafeInteger(count)) throw new TypeError("Invalid breach count");
    if (suffix === expectedSuffix) match = count;
  }
  return match;
}

export async function checkPwnedPassword(
  password: string,
  options: PwnedPasswordOptions = {},
): Promise<PwnedPasswordResult> {
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  const fetcher = options.fetch ?? globalThis.fetch;
  if (subtle === undefined || fetcher === undefined) {
    return { reason: "network", status: "unavailable" };
  }
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const digest = new Uint8Array(await subtle.digest("SHA-1", passwordBytes));
    const hash = bytesToHex(digest);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    let response: Response;
    try {
      response = await fetcher(`${HIBP_RANGE_ENDPOINT}${prefix}`, {
        headers: { "Add-Padding": "true" },
        method: "GET",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch {
      return { reason: "network", status: "unavailable" };
    }
    if (!response.ok) return { reason: "network", status: "unavailable" };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HIBP_RESPONSE_BYTES) {
      return { reason: "response", status: "unavailable" };
    }
    try {
      const count = parsePwnedPasswordRange(await response.text(), suffix);
      return count > 0 ? { count, status: "found" } : { status: "not-found" };
    } catch {
      return { reason: "response", status: "unavailable" };
    }
  } finally {
    passwordBytes.fill(0);
  }
}
