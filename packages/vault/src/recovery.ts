import { bech32m } from "@scure/base";
import { VaultError } from "./types";

const RECOVERY_KIT_BYTES = 32;
const RECOVERY_KIT_HRP = "zkwr";
const RECOVERY_KIT_VERSION = 1;
const BECH32_MAXIMUM_LENGTH = 90;
const PRINT_GROUP_SIZE = 4;

function invalidRecoveryKit(): VaultError {
  return new VaultError("INVALID_RECOVERY_KIT", "The Recovery Kit is invalid");
}

function compactRecoveryKit(value: string): string {
  if (value.length === 0 || value.length > 128) throw invalidRecoveryKit();
  const withoutPrintSeparators = value.replaceAll(" ", "").replaceAll("-", "");
  const hasLower = /[a-z]/u.test(withoutPrintSeparators);
  const hasUpper = /[A-Z]/u.test(withoutPrintSeparators);
  if (hasLower && hasUpper) throw invalidRecoveryKit();
  if (!/^[0-9A-Za-z]+$/u.test(withoutPrintSeparators)) throw invalidRecoveryKit();
  return withoutPrintSeparators.toLowerCase();
}

export function encodeRecoveryKit(secret: Uint8Array): string {
  if (secret.length !== RECOVERY_KIT_BYTES) throw invalidRecoveryKit();
  try {
    const compact = bech32m
      .encode(
        RECOVERY_KIT_HRP,
        [RECOVERY_KIT_VERSION, ...bech32m.toWords(secret)],
        BECH32_MAXIMUM_LENGTH,
      )
      .toUpperCase();
    const separator = compact.indexOf("1");
    if (separator < 0) throw invalidRecoveryKit();
    const prefix = compact.slice(0, separator + 1);
    const payload = compact.slice(separator + 1);
    const groups = payload.match(new RegExp(`.{1,${PRINT_GROUP_SIZE}}`, "gu"));
    if (groups === null) throw invalidRecoveryKit();
    return `${prefix} ${groups.join(" ")}`;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw invalidRecoveryKit();
  }
}

export function decodeRecoveryKit(value: string): Uint8Array {
  try {
    const compact = compactRecoveryKit(value);
    const decoded = bech32m.decode(compact, BECH32_MAXIMUM_LENGTH);
    if (decoded.prefix !== RECOVERY_KIT_HRP || decoded.words[0] !== RECOVERY_KIT_VERSION) {
      throw invalidRecoveryKit();
    }
    const secret = bech32m.fromWords(decoded.words.slice(1));
    if (secret.length !== RECOVERY_KIT_BYTES) throw invalidRecoveryKit();
    const canonical = bech32m.encode(
      RECOVERY_KIT_HRP,
      [RECOVERY_KIT_VERSION, ...bech32m.toWords(secret)],
      BECH32_MAXIMUM_LENGTH,
    );
    if (canonical !== compact) throw invalidRecoveryKit();
    return secret;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw invalidRecoveryKit();
  }
}
