// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  AUTHENTICATED_AUTOFILL_SELECT_TYPE,
  AUTOFILL_REQUEST_TYPE,
  BIOMETRIC_AUTOFILL_REQUEST_TYPE,
  BIOMETRIC_FILL_TYPE,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_PENDING_TYPE,
  CAPTURE_REQUEST_TYPE,
  captureLoginFields,
  fillLoginFields,
  isCredentialField,
  isLoginAction,
  isUsernameField,
  MANUAL_AUTOFILL_REQUEST_TYPE,
  parseAuthenticatedAutofillSelectRequest,
  parseAutofillRequest,
  parseBiometricAutofillRequest,
  parseBiometricFillRequest,
  parseCaptureActionRequest,
  parseCapturePendingRequest,
  parseCaptureRequest,
  parseManualAutofillRequest,
  parseUsernameObservedRequest,
  readExtensionRuntimeIdSafely,
  sendRuntimeMessageSafely,
  submitLoginForm,
  USERNAME_OBSERVED_TYPE,
} from "./autofill";

describe("extension automatic autofill", () => {
  it("aborts cleanly when a content script starts during extension replacement", () => {
    const invalidated = vi.fn();
    expect(
      readExtensionRuntimeIdSafely(() => {
        throw new Error("Extension context invalidated.");
      }, invalidated),
    ).toBeNull();
    expect(readExtensionRuntimeIdSafely(() => "", invalidated)).toBeNull();
    expect(readExtensionRuntimeIdSafely(() => "extension-id", invalidated)).toBe("extension-id");
    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it("contains both synchronous and asynchronous extension-reload failures", async () => {
    const invalidated = vi.fn();
    await expect(
      sendRuntimeMessageSafely(() => {
        throw new Error("Extension context invalidated.");
      }, invalidated),
    ).resolves.toBeUndefined();
    await expect(
      sendRuntimeMessageSafely(
        () => Promise.reject(new Error("Extension context invalidated.")),
        invalidated,
      ),
    ).resolves.toBeUndefined();
    expect(invalidated).toHaveBeenCalledTimes(2);

    const ordinaryFailure = vi.fn();
    await expect(
      sendRuntimeMessageSafely(
        () => Promise.reject(new Error("Temporary background failure")),
        ordinaryFailure,
      ),
    ).resolves.toBeUndefined();
    expect(ordinaryFailure).not.toHaveBeenCalled();
  });

  it("accepts only an exact HTTPS request schema", () => {
    expect(
      parseAutofillRequest({
        topUrl: "https://accounts.example.test/login",
        type: AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).not.toBeNull();
    expect(
      parseAutofillRequest({
        topUrl: "http://accounts.example.test/login",
        type: AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).toBeNull();
    expect(
      parseAutofillRequest({
        extra: true,
        topUrl: "https://accounts.example.test/login",
        type: AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).toBeNull();
  });

  it("fills a blank login form and emits browser-compatible events", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const username = document.querySelector<HTMLInputElement>("[autocomplete=username]");
    const password = document.querySelector<HTMLInputElement>("[type=password]");
    let inputEvents = 0;
    document.addEventListener("input", () => {
      inputEvents += 1;
    });

    expect(fillLoginFields(document, { password: "secret", username: "person@example.test" })).toBe(
      true,
    );
    expect(username?.value).toBe("person@example.test");
    expect(password?.value).toBe("secret");
    expect(inputEvents).toBe(2);
  });

  it("acknowledges an identical repeated delivery without rewriting the fields", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    let inputEvents = 0;
    document.addEventListener("input", () => {
      inputEvents += 1;
    });
    const credential = { password: "secret", username: "person@example.test" };

    expect(fillLoginFields(document, credential)).toBe(true);
    expect(fillLoginFields(document, credential)).toBe(true);
    expect(inputEvents).toBe(2);
  });

  it("submits only one unambiguous filled login form after explicit selection", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" value="person@example.test">
        <input type="password" autocomplete="current-password" value="secret">
        <button type="submit">Sign in</button>
      </form>
    `;
    const form = document.querySelector("form");
    const button = document.querySelector("button");
    if (form === null || button === null) throw new Error("Expected login fixture");
    const requestSubmit = vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);

    expect(submitLoginForm(document)).toBe(true);
    expect(requestSubmit).toHaveBeenCalledWith(button);

    form.insertAdjacentHTML("beforeend", '<button type="submit">Continue</button>');
    expect(submitLoginForm(document)).toBe(false);
    expect(requestSubmit).toHaveBeenCalledOnce();
  });

  it("validates biometric handoff messages and secure target origins", () => {
    expect(
      parseBiometricAutofillRequest({
        topUrl: "https://accounts.example.test/login",
        type: BIOMETRIC_AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).not.toBeNull();
    expect(
      parseBiometricFillRequest({
        password: "secret",
        submit: true,
        topUrl: "https://accounts.example.test/login",
        type: BIOMETRIC_FILL_TYPE,
        username: "person@example.test",
        version: 1,
      }),
    ).not.toBeNull();
    expect(
      parseBiometricFillRequest({
        password: "secret",
        submit: true,
        topUrl: "http://accounts.example.test/login",
        type: BIOMETRIC_FILL_TYPE,
        username: "person@example.test",
        version: 1,
      }),
    ).toBeNull();
    expect(
      parseManualAutofillRequest({
        topUrl: "https://accounts.example.test/login",
        type: MANUAL_AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).not.toBeNull();
    expect(
      parseManualAutofillRequest({
        extra: "must-fail",
        topUrl: "https://accounts.example.test/login",
        type: MANUAL_AUTOFILL_REQUEST_TYPE,
        userInitiated: true,
        version: 1,
      }),
    ).toBeNull();
  });

  it("requires an explicit authentication method for every selected credential", () => {
    const selection = {
      credentialId: "login-id",
      method: "biometric",
      submit: false,
      topUrl: "https://accounts.example.test/login",
      type: AUTHENTICATED_AUTOFILL_SELECT_TYPE,
      userInitiated: true,
      version: 1,
    };
    expect(parseAuthenticatedAutofillSelectRequest(selection)).toEqual(selection);
    expect(
      parseAuthenticatedAutofillSelectRequest({
        ...selection,
        method: "none",
      }),
    ).toBeNull();
    expect(
      parseAuthenticatedAutofillSelectRequest({
        ...selection,
        submit: undefined,
      }),
    ).toBeNull();
    expect(
      parseAuthenticatedAutofillSelectRequest({
        ...selection,
        extra: "bypass",
      }),
    ).toBeNull();
  });

  it("does not overwrite fields or fill password-creation forms", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" value="existing">
        <input type="password" autocomplete="new-password">
      </form>
    `;
    expect(fillLoginFields(document, { password: "secret", username: "other" })).toBe(false);
    expect(document.querySelector<HTMLInputElement>("[autocomplete=username]")?.value).toBe(
      "existing",
    );
  });

  it("captures a completed login and rejects malformed capture messages", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" value="person@example.test">
        <input type="password" value="secret">
      </form>
    `;
    expect(captureLoginFields(document)).toEqual({
      password: "secret",
      username: "person@example.test",
    });
    expect(
      parseCaptureRequest(
        {
          password: "secret",
          topUrl: "https://accounts.example.test/login",
          type: CAPTURE_REQUEST_TYPE,
          userInitiated: true,
          username: "person@example.test",
          version: 1,
        },
        CAPTURE_REQUEST_TYPE,
      ),
    ).not.toBeNull();
    expect(
      parseCaptureRequest(
        {
          password: "",
          topUrl: "https://accounts.example.test/login",
          type: CAPTURE_REQUEST_TYPE,
          userInitiated: true,
          username: "person@example.test",
          version: 1,
        },
        CAPTURE_REQUEST_TYPE,
      ),
    ).toBeNull();
  });

  it("recognizes multi-step username fields and sign-in actions", () => {
    document.body.innerHTML = `
      <input id="account-login" type="text" value="person@example.test">
      <button type="button">Sign in</button>
    `;
    const username = document.querySelector<HTMLInputElement>("input");
    const button = document.querySelector<HTMLButtonElement>("button");
    expect(username === null ? false : isUsernameField(username)).toBe(true);
    expect(username === null ? false : isCredentialField(username)).toBe(true);
    expect(button === null ? false : isLoginAction(button)).toBe(true);
    expect(
      parseUsernameObservedRequest({
        topUrl: "https://accounts.example.test/username",
        type: USERNAME_OBSERVED_TYPE,
        userInitiated: true,
        username: "person@example.test",
        version: 1,
      }),
    ).not.toBeNull();
  });

  it("accepts only minimal persistent capture prompt actions", () => {
    expect(parseCapturePendingRequest({ type: CAPTURE_PENDING_TYPE, version: 1 })).not.toBeNull();
    expect(
      parseCaptureActionRequest(
        { type: CAPTURE_CONFIRM_TYPE, userInitiated: true, version: 1 },
        CAPTURE_CONFIRM_TYPE,
      ),
    ).not.toBeNull();
    expect(
      parseCaptureActionRequest(
        {
          password: "must-not-cross-navigation",
          type: CAPTURE_CONFIRM_TYPE,
          userInitiated: true,
          version: 1,
        },
        CAPTURE_CONFIRM_TYPE,
      ),
    ).toBeNull();
  });

  it("fails closed across malformed and hostile message variations", () => {
    const valid = {
      topUrl: "https://accounts.example.test/login",
      type: AUTOFILL_REQUEST_TYPE,
      userInitiated: true,
      version: 1,
    };
    const mutations: unknown[] = [
      null,
      [],
      "",
      1,
      { ...valid, topUrl: "http://accounts.example.test/login" },
      { ...valid, topUrl: "javascript:alert(1)" },
      { ...valid, topUrl: "https://user:secret@accounts.example.test/login" },
      { ...valid, topUrl: "not a url" },
      { ...valid, userInitiated: false },
      { ...valid, version: 2 },
      { ...valid, type: "__proto__" },
      { ...valid, extra: "field" },
    ];
    for (let index = 0; index < 1_000; index += 1) {
      const seed = mutations[index % mutations.length];
      expect(parseAutofillRequest(seed)).toBeNull();
    }
  });

  it("handles repeated dynamic login-form replacement without overwriting user input", () => {
    for (let index = 0; index < 200; index += 1) {
      document.body.innerHTML =
        index % 2 === 0
          ? `<form><input type="email"><input type="password" autocomplete="current-password"></form>`
          : `<form><input name="account-username"><input type="password"></form>`;
      expect(
        fillLoginFields(document, {
          password: `secret-${index}`,
          username: `person-${index}@example.test`,
        }),
      ).toBe(true);
      const inputs = document.querySelectorAll<HTMLInputElement>("input");
      expect(inputs[0]?.value).toBe(`person-${index}@example.test`);
      expect(inputs[1]?.value).toBe(`secret-${index}`);
      expect(
        fillLoginFields(document, {
          password: "must-not-overwrite",
          username: "must-not-overwrite",
        }),
      ).toBe(false);
      expect(inputs[1]?.value).toBe(`secret-${index}`);
    }
  });
});
