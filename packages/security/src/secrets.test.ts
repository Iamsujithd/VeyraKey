import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_PASSPHRASE_WORDS,
  copyWithBestEffortClear,
  generatePassword,
  generateReadableStrongPassword,
  generateTotp,
  parseOtpAuthQr,
  parseOtpAuthUri,
  type RandomSource,
} from "./secrets";

describe("secret generation", () => {
  it("uses rejection sampling instead of modulo-biased bytes", () => {
    const bytes = [255, 4, 5, 6, 7, 8, 9, 10];
    const random: RandomSource = {
      randomBytes: () => Uint8Array.of(bytes.shift() ?? 0),
    };
    expect(generatePassword({ alphabet: "abc", length: 8, random })).toBe("bcabcaba");
  });

  it("rejects weak generator configurations", () => {
    const random: RandomSource = { randomBytes: (length) => new Uint8Array(length) };
    expect(() => generatePassword({ alphabet: "a", length: 20, random })).toThrow();
    expect(() => generatePassword({ alphabet: "abc", length: 7, random })).toThrow();
  });

  it("ships a unique 2048-entry passphrase list", () => {
    expect(BUILT_IN_PASSPHRASE_WORDS).toHaveLength(2_048);
    expect(new Set(BUILT_IN_PASSPHRASE_WORDS).size).toBe(2_048);
  });

  it("generates readable three-group strong passwords", () => {
    let next = 0;
    const password = generateReadableStrongPassword({
      randomBytes: (length) =>
        Uint8Array.from({ length }, () => {
          next = (next + 17) % 251;
          return next;
        }),
    });
    expect(password).toMatch(
      /^(?=.{20}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/u,
    );
  });
});

describe("RFC-compatible TOTP", () => {
  it.each([
    [59_000, "94287082"],
    [1_111_111_109_000, "07081804"],
    [1_111_111_111_000, "14050471"],
    [1_234_567_890_000, "89005924"],
    [2_000_000_000_000, "69279037"],
    [20_000_000_000_000, "65353130"],
  ] as const)("matches the RFC 6238 SHA-1 vector at %i", async (time, code) => {
    const configuration = parseOtpAuthUri(
      "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=8&period=30",
    );
    await expect(generateTotp(configuration, time)).resolves.toMatchObject({ code });
  });

  it("strictly parses QR-compatible otpauth URIs", () => {
    const parsed = parseOtpAuthUri(
      "otpauth://totp/Example%3Aperson?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    );
    expect(parsed).toMatchObject({
      algorithm: "SHA-1",
      digits: 6,
      issuer: "Example",
      label: "Example:person",
      period: 30,
    });
    expect(() => parseOtpAuthUri("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP")).toThrow();
    expect(() =>
      parseOtpAuthUri("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&unknown=true"),
    ).toThrow();
  });

  it("imports exactly one scanned authenticator QR payload", async () => {
    await expect(
      parseOtpAuthQr(
        {},
        {
          detect: async () => [
            {
              rawValue: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&issuer=Example",
            },
          ],
        },
      ),
    ).resolves.toMatchObject({ issuer: "Example", label: "Example" });
    await expect(parseOtpAuthQr({}, { detect: async () => [] })).rejects.toThrow();
  });
});

describe("clipboard exposure control", () => {
  it("clears only when the clipboard still contains the copied secret", async () => {
    let value = "";
    let callback: (() => void) | undefined;
    const clipboard = {
      readText: async () => value,
      writeText: async (next: string) => {
        value = next;
      },
    };
    await copyWithBestEffortClear({
      clearAfterMilliseconds: 30_000,
      clipboard,
      secret: "secret",
      setTimer: (next) => {
        callback = next;
      },
    });
    expect(value).toBe("secret");
    callback?.();
    await vi.waitFor(() => expect(value).toBe(""));

    await copyWithBestEffortClear({
      clearAfterMilliseconds: 30_000,
      clipboard,
      secret: "another-secret",
      setTimer: (next) => {
        callback = next;
      },
    });
    value = "new user clipboard value";
    callback?.();
    await Promise.resolve();
    expect(value).toBe("new user clipboard value");
  });
});
