import { describe, expect, it, vi } from "vitest";
import {
  analyzePasswordHealth,
  checkPwnedPassword,
  parsePwnedPasswordRange,
} from "./password-health";

describe("local password health", () => {
  it("reports weak and reused credentials without returning passwords", () => {
    const findings = analyzePasswordHealth([
      { id: "a", password: "same" },
      { id: "b", password: "same" },
      { id: "c", password: "Unique-Long-Password-93" },
    ]);
    expect(findings[0]).toMatchObject({ reused: true, weak: true });
    expect(findings[1]).toMatchObject({ reused: true, weak: true });
    expect(findings[2]).toMatchObject({ reused: false, weak: false });
    expect(JSON.stringify(findings)).not.toContain("same");
  });
});

describe("Pwned Passwords range client", () => {
  it("sends only a five-character SHA-1 prefix and requests padded results", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toMatch(/\/range\/[0-9A-F]{5}$/u);
      expect(String(input)).not.toContain("correct horse");
      expect(init?.headers).toEqual({ "Add-Padding": "true" });
      return new Response(`${"A".repeat(35)}:0\n`);
    });
    await expect(
      checkPwnedPassword("correct horse", { fetch: fetcher as typeof fetch }),
    ).resolves.toEqual({ status: "not-found" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("matches the suffix and rejects malformed, oversized, and unsafe counts", () => {
    const suffix = "A".repeat(35);
    expect(parsePwnedPasswordRange(`${suffix}:42\r\n${"B".repeat(35)}:0`, suffix)).toBe(42);
    expect(() => parsePwnedPasswordRange(`${suffix}:1:2`, suffix)).toThrow();
    expect(() => parsePwnedPasswordRange(`${suffix}:9999999999999`, suffix)).toThrow();
    expect(() => parsePwnedPasswordRange(`${suffix}:1\n`.repeat(120_000), suffix)).toThrow();
  });

  it("fails closed for malicious responses and reports offline behavior", async () => {
    const malformed = vi.fn(async () => new Response("not-a-range"));
    await expect(
      checkPwnedPassword("secret", { fetch: malformed as typeof fetch }),
    ).resolves.toEqual({ reason: "response", status: "unavailable" });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(checkPwnedPassword("secret", { fetch: offline as typeof fetch })).resolves.toEqual(
      { reason: "network", status: "unavailable" },
    );
  });
});
