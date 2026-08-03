import type { RandomSource } from "@zk-wallet/security";

export const PRIVATE_EMAIL_SETTINGS_TAG = "veyrakey:private-email-settings" as const;
export const PRIVATE_EMAIL_SETTINGS_TITLE = "VeyraKey Private Email Settings" as const;
export const PRIVATE_EMAIL_SETTINGS_FOLDER = "VeyraKey System" as const;

interface CommonSettings {
  readonly autoFill: boolean;
  readonly version: 1;
}

export type PrivateEmailSettings =
  | (CommonSettings & { readonly baseEmail: string; readonly provider: "plus" })
  | (CommonSettings & { readonly apiCode: string; readonly provider: "simplelogin" })
  | (CommonSettings & {
      readonly apiToken: string;
      readonly domain: string;
      readonly provider: "addy";
    });

export interface CreatedPrivateEmailAlias {
  readonly address: string;
  readonly createdAt: string;
  readonly createdForOrigin: string;
  readonly provider: PrivateEmailSettings["provider"];
  readonly providerAliasId?: string;
  readonly sourceEmail?: string;
}

export class PrivateEmailError extends Error {
  constructor(
    readonly code: "CONFIGURATION" | "NETWORK" | "PROVIDER_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "PrivateEmailError";
  }
}

function nonEmpty(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validEmail(value: string): boolean {
  const at = value.lastIndexOf("@");
  return at > 0 && at < value.length - 1 && !/\s/u.test(value);
}

function exactHttpsOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new Error();
    return url.origin;
  } catch {
    throw new PrivateEmailError(
      "CONFIGURATION",
      "Private email aliases can only be created for an exact HTTPS origin",
    );
  }
}

export function parsePrivateEmailSettings(value: unknown): PrivateEmailSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.autoFill !== "boolean") return null;
  if (
    candidate.provider === "plus" &&
    Object.keys(candidate).every((key) =>
      ["autoFill", "baseEmail", "provider", "version"].includes(key),
    ) &&
    nonEmpty(candidate.baseEmail, 320) &&
    validEmail(candidate.baseEmail.trim())
  ) {
    return {
      autoFill: candidate.autoFill,
      baseEmail: candidate.baseEmail.trim(),
      provider: "plus",
      version: 1,
    };
  }
  if (
    candidate.provider === "simplelogin" &&
    Object.keys(candidate).every((key) =>
      ["apiCode", "autoFill", "provider", "version"].includes(key),
    ) &&
    nonEmpty(candidate.apiCode, 2_048)
  ) {
    return {
      apiCode: candidate.apiCode.trim(),
      autoFill: candidate.autoFill,
      provider: "simplelogin",
      version: 1,
    };
  }
  if (
    candidate.provider === "addy" &&
    Object.keys(candidate).every((key) =>
      ["apiToken", "autoFill", "domain", "provider", "version"].includes(key),
    ) &&
    nonEmpty(candidate.apiToken, 2_048) &&
    nonEmpty(candidate.domain, 253) &&
    !/[\s/@]/u.test(candidate.domain)
  ) {
    return {
      apiToken: candidate.apiToken.trim(),
      autoFill: candidate.autoFill,
      domain: candidate.domain.trim().toLocaleLowerCase(),
      provider: "addy",
      version: 1,
    };
  }
  return null;
}

export function parsePrivateEmailSettingsNote(note: string): PrivateEmailSettings | null {
  try {
    return parsePrivateEmailSettings(JSON.parse(note));
  } catch {
    return null;
  }
}

export function serializePrivateEmailSettings(settings: PrivateEmailSettings): string {
  const parsed = parsePrivateEmailSettings(settings);
  if (parsed === null)
    throw new PrivateEmailError("CONFIGURATION", "Private email settings are invalid");
  return JSON.stringify(parsed);
}

function randomToken(random: RandomSource, length = 8): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = random.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function siteSlug(origin: string): string {
  try {
    return (
      (
        new URL(origin).hostname
          .replace(/^www\./u, "")
          .split(".")
          .at(0) ?? ""
      )
        .replace(/[^a-z0-9]+/giu, "-")
        .replace(/^-|-$/gu, "")
        .toLocaleLowerCase()
        .slice(0, 18) || "site"
    );
  } catch {
    throw new PrivateEmailError("CONFIGURATION", "The website origin is invalid");
  }
}

export function createPlusAddress(baseEmail: string, origin: string, random: RandomSource): string {
  const normalized = baseEmail.trim();
  if (!validEmail(normalized)) {
    throw new PrivateEmailError(
      "CONFIGURATION",
      "A valid base email is required for plus addressing",
    );
  }
  const at = normalized.lastIndexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const suffix = `veyrakey-${siteSlug(origin)}-${randomToken(random)}`;
  const available = 64 - local.length - 1;
  if (available < 8) {
    throw new PrivateEmailError(
      "CONFIGURATION",
      "The base email local part is too long for plus addressing",
    );
  }
  return `${local}+${suffix.slice(0, available)}@${domain}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new PrivateEmailError("NETWORK", `Alias provider returned HTTP ${response.status}`);
  }
  const body = asObject(await response.json().catch(() => null));
  if (body === null)
    throw new PrivateEmailError("PROVIDER_RESPONSE", "Alias provider returned invalid JSON");
  return body;
}

export async function createPrivateEmailAlias(
  settings: PrivateEmailSettings,
  origin: string,
  random: RandomSource,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<CreatedPrivateEmailAlias> {
  const parsed = parsePrivateEmailSettings(settings);
  if (parsed === null)
    throw new PrivateEmailError("CONFIGURATION", "Private email settings are invalid");
  const createdAt = now().toISOString();
  const createdForOrigin = exactHttpsOrigin(origin);
  if (parsed.provider === "plus") {
    return {
      address: createPlusAddress(parsed.baseEmail, createdForOrigin, random),
      createdAt,
      createdForOrigin,
      provider: "plus",
      sourceEmail: parsed.baseEmail,
    };
  }
  if (parsed.provider === "simplelogin") {
    const endpoint = new URL("https://app.simplelogin.io/api/alias/random/new");
    endpoint.searchParams.set("hostname", new URL(createdForOrigin).hostname);
    endpoint.searchParams.set("mode", "word");
    const body = await providerJson(
      await fetcher(endpoint, {
        body: JSON.stringify({ note: `Created by VeyraKey for ${createdForOrigin}` }),
        headers: { Authentication: parsed.apiCode, "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    if (!nonEmpty(body.email, 320) || !validEmail(body.email)) {
      throw new PrivateEmailError(
        "PROVIDER_RESPONSE",
        "SimpleLogin did not return an alias address",
      );
    }
    return {
      address: body.email,
      createdAt,
      createdForOrigin,
      provider: "simplelogin",
      ...(typeof body.id === "number" || typeof body.id === "string"
        ? { providerAliasId: String(body.id) }
        : {}),
    };
  }
  const body = await providerJson(
    await fetcher("https://app.addy.io/api/v1/aliases", {
      body: JSON.stringify({
        description: `Created by VeyraKey for ${createdForOrigin}`,
        domain: parsed.domain,
        format: "random_words",
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${parsed.apiToken}`,
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      method: "POST",
    }),
  );
  const data = asObject(body.data) ?? body;
  const address = typeof data.email === "string" ? data.email : data.address;
  if (!nonEmpty(address, 320) || !validEmail(address)) {
    throw new PrivateEmailError("PROVIDER_RESPONSE", "Addy.io did not return an alias address");
  }
  return {
    address,
    createdAt,
    createdForOrigin,
    provider: "addy",
    ...(typeof data.id === "string" ? { providerAliasId: data.id } : {}),
  };
}
