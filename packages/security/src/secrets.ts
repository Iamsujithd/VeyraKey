const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASSPHRASE_PREFIXES = [
  "amber",
  "apricot",
  "azure",
  "brisk",
  "bronze",
  "calm",
  "cedar",
  "cobalt",
  "coral",
  "crimson",
  "daring",
  "ember",
  "emerald",
  "gentle",
  "golden",
  "indigo",
  "jade",
  "lively",
  "lunar",
  "maple",
  "navy",
  "nimble",
  "opal",
  "pearl",
  "quiet",
  "rapid",
  "scarlet",
  "silver",
  "solar",
  "steady",
  "violet",
  "warm",
] as const;
const PASSPHRASE_NOUNS = [
  "anchor",
  "badger",
  "bamboo",
  "beacon",
  "birch",
  "bison",
  "breeze",
  "brook",
  "canyon",
  "cedar",
  "comet",
  "coral",
  "crane",
  "dawn",
  "delta",
  "dolphin",
  "eagle",
  "ember",
  "falcon",
  "fern",
  "fjord",
  "forest",
  "fox",
  "garden",
  "glacier",
  "harbor",
  "hawk",
  "heron",
  "island",
  "jasmine",
  "kestrel",
  "lagoon",
  "lantern",
  "lark",
  "lotus",
  "maple",
  "meadow",
  "meteor",
  "moon",
  "oak",
  "ocean",
  "olive",
  "orchid",
  "otter",
  "pine",
  "planet",
  "quartz",
  "raven",
  "reef",
  "river",
  "robin",
  "sage",
  "shore",
  "sparrow",
  "spruce",
  "star",
  "summit",
  "tiger",
  "valley",
  "violet",
  "willow",
  "wind",
  "wolf",
  "zenith",
] as const;

export const BUILT_IN_PASSPHRASE_WORDS: readonly string[] = PASSPHRASE_PREFIXES.flatMap((prefix) =>
  PASSPHRASE_NOUNS.map((noun) => `${prefix}${noun}`),
);

export interface RandomSource {
  randomBytes(length: number): Uint8Array;
}

function unbiasedIndex(random: RandomSource, upperBound: number): number {
  if (!Number.isSafeInteger(upperBound) || upperBound < 2 || upperBound > 65_536) {
    throw new Error("Invalid random selection bound");
  }
  const bytes = upperBound <= 256 ? 1 : 2;
  const range = bytes === 1 ? 256 : 65_536;
  const limit = range - (range % upperBound);
  for (;;) {
    const sample = random.randomBytes(bytes);
    if (sample.length !== bytes) throw new Error("Random source returned the wrong length");
    const value =
      bytes === 1 ? (sample[0] as number) : ((sample[0] as number) << 8) | (sample[1] as number);
    if (value < limit) return value % upperBound;
  }
}

export function generatePassword(options: {
  readonly alphabet: string;
  readonly length: number;
  readonly random: RandomSource;
}): string {
  const symbols = [...new Set([...options.alphabet])];
  if (
    !Number.isSafeInteger(options.length) ||
    options.length < 8 ||
    options.length > 256 ||
    symbols.length < 2 ||
    symbols.length > 256
  ) {
    throw new Error("Password generator settings are invalid");
  }
  return Array.from(
    { length: options.length },
    () => symbols[unbiasedIndex(options.random, symbols.length)] as string,
  ).join("");
}

export function generatePassphrase(options: {
  readonly separator?: string;
  readonly random: RandomSource;
  readonly wordCount: number;
  readonly words: readonly string[];
}): string {
  if (
    !Number.isSafeInteger(options.wordCount) ||
    options.wordCount < 4 ||
    options.wordCount > 20 ||
    options.words.length < 2_048 ||
    new Set(options.words).size !== options.words.length ||
    options.words.some((word) => word.length === 0 || word.length > 64)
  ) {
    throw new Error("Passphrase generator settings are invalid");
  }
  const separator = options.separator ?? "-";
  if (separator.length > 8 || /[\r\n]/u.test(separator)) {
    throw new Error("Passphrase separator is invalid");
  }
  return Array.from(
    { length: options.wordCount },
    () => options.words[unbiasedIndex(options.random, options.words.length)] as string,
  ).join(separator);
}

function decodeBase32(value: string): Uint8Array {
  const compact = value.toUpperCase().replaceAll("=", "").replaceAll(" ", "");
  if (compact.length === 0 || compact.length > 1_024 || !/^[A-Z2-7]+$/u.test(compact)) {
    throw new Error("TOTP secret is invalid");
  }
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of compact) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  if (output.length < 10 || output.length > 128) throw new Error("TOTP secret length is invalid");
  return Uint8Array.from(output);
}

export interface TotpConfiguration {
  readonly algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  readonly digits: 6 | 8;
  readonly issuer?: string;
  readonly label: string;
  readonly period: number;
  readonly secret: Uint8Array;
}

export interface QrCodeDetector {
  detect(source: unknown): Promise<readonly { readonly rawValue?: string }[]>;
}

export async function parseOtpAuthQr(
  source: unknown,
  detector: QrCodeDetector,
): Promise<TotpConfiguration & { readonly uri: string }> {
  const results = await detector.detect(source);
  if (results.length !== 1 || typeof results[0]?.rawValue !== "string") {
    throw new Error("Expected one authenticator QR code");
  }
  return { ...parseOtpAuthUri(results[0].rawValue), uri: results[0].rawValue };
}

export function parseOtpAuthUri(value: string): TotpConfiguration {
  if (value.length === 0 || value.length > 4_096) throw new Error("TOTP URI is invalid");
  const url = new URL(value);
  if (url.protocol !== "otpauth:" || url.hostname !== "totp" || url.username || url.password) {
    throw new Error("TOTP URI is invalid");
  }
  const allowed = new Set(["algorithm", "digits", "issuer", "period", "secret"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new Error("TOTP URI contains unsupported parameters");
  }
  const secretValue = url.searchParams.get("secret");
  if (secretValue === null) throw new Error("TOTP secret is missing");
  const algorithmValue = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
  const algorithms = {
    SHA1: "SHA-1",
    SHA256: "SHA-256",
    SHA512: "SHA-512",
  } as const;
  const algorithm = algorithms[algorithmValue as keyof typeof algorithms];
  const digitsValue = Number(url.searchParams.get("digits") ?? "6");
  const period = Number(url.searchParams.get("period") ?? "30");
  const label = decodeURIComponent(url.pathname.slice(1));
  if (
    algorithm === undefined ||
    ![6, 8].includes(digitsValue) ||
    !Number.isSafeInteger(period) ||
    period < 15 ||
    period > 120 ||
    label.length === 0 ||
    label.length > 512
  ) {
    throw new Error("TOTP configuration is invalid");
  }
  const issuer = url.searchParams.get("issuer") ?? undefined;
  if (issuer !== undefined && (issuer.length === 0 || issuer.length > 256)) {
    throw new Error("TOTP issuer is invalid");
  }
  return {
    algorithm,
    digits: digitsValue as 6 | 8,
    ...(issuer === undefined ? {} : { issuer }),
    label,
    period,
    secret: decodeBase32(secretValue),
  };
}

export async function generateTotp(
  configuration: TotpConfiguration,
  timestampMilliseconds: number,
): Promise<{ readonly code: string; readonly remainingSeconds: number }> {
  if (!Number.isSafeInteger(timestampMilliseconds) || timestampMilliseconds < 0) {
    throw new Error("TOTP time is invalid");
  }
  const seconds = Math.floor(timestampMilliseconds / 1_000);
  const counter = Math.floor(seconds / configuration.period);
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const secret = new Uint8Array(configuration.secret.length);
  secret.set(configuration.secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secret.buffer,
    { hash: configuration.algorithm, name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message.buffer));
  const offset = (digest.at(-1) as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    ((digest[offset + 1] as number) << 16) |
    ((digest[offset + 2] as number) << 8) |
    (digest[offset + 3] as number);
  const divisor = 10 ** configuration.digits;
  return {
    code: String(binary % divisor).padStart(configuration.digits, "0"),
    remainingSeconds: configuration.period - (seconds % configuration.period),
  };
}

export interface ClipboardPort {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

export async function copyWithBestEffortClear(options: {
  readonly clipboard: ClipboardPort;
  readonly clearAfterMilliseconds: number;
  readonly secret: string;
  readonly setTimer?: (callback: () => void, milliseconds: number) => unknown;
}): Promise<void> {
  if (
    !Number.isSafeInteger(options.clearAfterMilliseconds) ||
    options.clearAfterMilliseconds < 5_000 ||
    options.clearAfterMilliseconds > 300_000
  ) {
    throw new Error("Clipboard timeout is invalid");
  }
  await options.clipboard.writeText(options.secret);
  const setTimer = options.setTimer ?? setTimeout;
  setTimer(() => {
    void options.clipboard
      .readText()
      .then((current) =>
        current === options.secret ? options.clipboard.writeText("") : Promise.resolve(),
      )
      .catch(() => undefined);
  }, options.clearAfterMilliseconds);
}
