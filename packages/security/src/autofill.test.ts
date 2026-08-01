// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  captureCredentialFields,
  decideAutofill,
  decideCredentialCapture,
  explainAutofillDecision,
  fillCredentialFields,
  findCredentialFields,
} from "./index";

describe("exact-origin autofill policy", () => {
  const credential = { id: "one", uris: ["https://example.test/login"] };

  it("allows one exact HTTPS origin after explicit user action", () => {
    expect(
      decideAutofill({
        credentials: [credential],
        frameUrl: "https://example.test/form",
        topUrl: "https://example.test/home",
        userInitiated: true,
      }),
    ).toEqual({
      allowed: true,
      canonicalOrigin: "https://example.test",
      credentialId: "one",
      displayHost: "example.test",
    });
  });

  it.each([
    [
      "automatic fill",
      "https://example.test",
      "https://example.test",
      false,
      "USER_ACTION_REQUIRED",
    ],
    ["HTTP", "http://example.test", "http://example.test", true, "INSECURE_SCHEME"],
    [
      "cross-origin frame",
      "https://example.test",
      "https://login.example.test",
      true,
      "CROSS_ORIGIN_FRAME",
    ],
    ["lookalike domain", "https://examp1e.test", "https://examp1e.test", true, "NO_EXACT_MATCH"],
    ["opaque origin", "data:text/html,test", "data:text/html,test", true, "OPAQUE_ORIGIN"],
  ] as const)("refuses %s", (_name, topUrl, frameUrl, userInitiated, reason) => {
    expect(decideAutofill({ credentials: [credential], frameUrl, topUrl, userInitiated })).toEqual({
      allowed: false,
      reason,
    });
  });

  it("canonicalizes Unicode IDNs to their visible punycode security form", () => {
    expect(
      decideAutofill({
        credentials: [{ id: "idn", uris: ["https://bücher.example"] }],
        frameUrl: "https://xn--bcher-kva.example/login",
        topUrl: "https://bücher.example",
        userInitiated: true,
      }),
    ).toMatchObject({
      allowed: true,
      canonicalOrigin: "https://xn--bcher-kva.example",
      displayHost: "xn--bcher-kva.example",
    });
  });

  it("requires account selection when multiple credentials match", () => {
    expect(
      decideAutofill({
        credentials: [credential, { ...credential, id: "two" }],
        frameUrl: "https://example.test",
        topUrl: "https://example.test",
        userInitiated: true,
      }),
    ).toEqual({ allowed: false, reason: "AMBIGUOUS_ACCOUNT" });
  });

  it("provides stable, secret-free explanations for every policy outcome", () => {
    const allowed = decideAutofill({
      credentials: [credential],
      frameUrl: "https://example.test/login",
      topUrl: "https://example.test/login",
      userInitiated: true,
    });
    expect(explainAutofillDecision(allowed)).toEqual({
      code: "EXACT_ORIGIN_MATCH",
      detail: "The saved login exactly matches example.test.",
      severity: "allowed",
      title: "Exact website match",
    });

    const refusalCases = [
      "AMBIGUOUS_ACCOUNT",
      "CROSS_ORIGIN_FRAME",
      "INSECURE_SCHEME",
      "INVALID_ORIGIN",
      "NO_EXACT_MATCH",
      "OPAQUE_ORIGIN",
      "USER_ACTION_REQUIRED",
    ] as const;
    for (const reason of refusalCases) {
      const explanation = explainAutofillDecision({ allowed: false, reason });
      expect(explanation.code).toBe(reason);
      expect(explanation.title.length).toBeGreaterThan(0);
      expect(explanation.detail.length).toBeGreaterThan(0);
      expect(JSON.stringify(explanation)).not.toContain("synthetic-secret");
    }
  });
});

describe("credential capture prompts", () => {
  it("distinguishes save, update, and unchanged submissions", () => {
    const base = {
      captured: { password: "new-secret", username: "person" },
      frameUrl: "https://example.test/login",
      topUrl: "https://example.test",
    };
    expect(decideCredentialCapture({ ...base, credentials: [] })).toMatchObject({
      action: "save",
      canonicalOrigin: "https://example.test",
    });
    expect(
      decideCredentialCapture({
        ...base,
        credentials: [
          {
            id: "existing",
            passwordMatches: false,
            uris: ["https://example.test/account"],
            username: "person",
          },
        ],
      }),
    ).toMatchObject({ action: "update", credentialId: "existing" });
    expect(
      decideCredentialCapture({
        ...base,
        credentials: [
          {
            id: "existing",
            passwordMatches: true,
            uris: ["https://example.test"],
            username: "person",
          },
        ],
      }),
    ).toEqual({ action: "none", reason: "UNCHANGED" });
  });

  it("deduplicates usernames case-insensitively and tolerates a cleared username field", () => {
    const credential = {
      id: "existing",
      passwordMatches: true,
      uris: ["https://example.test"],
      username: "Person@Example.test",
    };
    const base = {
      credentials: [credential],
      frameUrl: "https://example.test/login",
      topUrl: "https://example.test/login",
    };

    expect(
      decideCredentialCapture({
        ...base,
        captured: { password: "same-secret", username: " person@example.TEST " },
      }),
    ).toEqual({ action: "none", reason: "UNCHANGED" });
    expect(
      decideCredentialCapture({
        ...base,
        captured: { password: "same-secret", username: "" },
      }),
    ).toEqual({ action: "none", reason: "UNCHANGED" });
  });

  it("never prompts from HTTP or a cross-origin frame", () => {
    expect(
      decideCredentialCapture({
        captured: { password: "secret", username: "person" },
        credentials: [],
        frameUrl: "http://example.test",
        topUrl: "http://example.test",
      }),
    ).toEqual({ action: "none", reason: "INSECURE_CONTEXT" });
    expect(
      decideCredentialCapture({
        captured: { password: "secret", username: "person" },
        credentials: [],
        frameUrl: "https://frame.example.test",
        topUrl: "https://example.test",
      }),
    ).toEqual({ action: "none", reason: "INSECURE_CONTEXT" });
  });
});

describe("conservative standard-form handling", () => {
  it("finds, fills, and captures standard username/password fields with framework events", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `;
    const fields = findCredentialFields(document);
    if (fields === null) throw new Error("Expected credential form");
    const input = vi.fn();
    const change = vi.fn();
    fields.password.addEventListener("input", input);
    fields.password.addEventListener("change", change);

    fillCredentialFields(fields, { password: "synthetic-secret", username: "person" });

    expect(input).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
    expect(captureCredentialFields(fields)).toEqual({
      password: "synthetic-secret",
      username: "person",
    });
  });

  it("ignores hidden, disabled, and absent password forms", () => {
    document.body.innerHTML = `
      <input type="hidden" />
      <input type="password" disabled />
      <input autocomplete="username" />
    `;
    expect(findCredentialFields(document)).toBeNull();
  });
});
