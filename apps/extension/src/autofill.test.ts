// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  AUTHENTICATED_AUTOFILL_SELECT_TYPE,
  AUTOFILL_FILLED_TYPE,
  AUTOFILL_REQUEST_TYPE,
  BIOMETRIC_AUTOFILL_REQUEST_TYPE,
  BIOMETRIC_FILL_TYPE,
  CAPTURE_CONFIRM_TYPE,
  CAPTURE_PENDING_TYPE,
  CAPTURE_REQUEST_TYPE,
  CARD_AUTOFILL_REQUEST_TYPE,
  CARD_AUTOFILL_SELECT_TYPE,
  captureLoginFields,
  cardFieldKind,
  credentialFingerprint,
  credentialsMatch,
  fillCardField,
  fillLoginFields,
  fillProfileField,
  fillRegistrationPasswordFields,
  generateAdaptiveRegistrationPassword,
  generateStrongRegistrationPassword,
  isCredentialField,
  isLoginAction,
  isRegistrationPasswordField,
  isUsernameField,
  MANUAL_AUTOFILL_REQUEST_TYPE,
  PROFILE_AUTOFILL_REQUEST_TYPE,
  PROFILE_AUTOFILL_SELECT_TYPE,
  parseAuthenticatedAutofillSelectRequest,
  parseAutofillFilledRequest,
  parseAutofillRequest,
  parseBiometricAutofillRequest,
  parseBiometricFillRequest,
  parseCaptureActionRequest,
  parseCapturePendingRequest,
  parseCaptureRequest,
  parseCardAutofillRequest,
  parseCardAutofillSelectRequest,
  parseManualAutofillRequest,
  parseProfileAutofillRequest,
  parseProfileAutofillSelectRequest,
  parseUsernameObservedRequest,
  preferNamedCredentials,
  profileFieldKind,
  readExtensionRuntimeIdSafely,
  registrationPasswordPolicy,
  sendRuntimeMessageSafely,
  shouldDismissSuggestionsForUsername,
  submitLoginForm,
  USERNAME_OBSERVED_TYPE,
  usernameFieldForCredentialAnchor,
} from "./autofill";
import {
  AUTOFILL_COMPATIBILITY_CORPUS,
  AUTOFILL_COMPATIBILITY_CORPUS_VERSION,
} from "./autofillCompatibilityCorpus";

describe("extension automatic autofill", () => {
  it("classifies every versioned compatibility-corpus password field", () => {
    expect(AUTOFILL_COMPATIBILITY_CORPUS_VERSION).toBe(1);
    for (const fixture of AUTOFILL_COMPATIBILITY_CORPUS) {
      window.history.replaceState(null, "", fixture.pathname);
      document.body.innerHTML = fixture.html;
      const actual = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].map(
        (input) => (isRegistrationPasswordField(input) ? "new" : "current"),
      );
      expect(actual, fixture.id).toEqual(fixture.expectedPasswordPurposes);
    }
  });
  it("recognizes a recent successful fill without retaining plaintext credentials", async () => {
    const receipt = {
      password: "same-secret",
      topUrl: "https://example.test/login",
      type: AUTOFILL_FILLED_TYPE,
      username: "Person@Example.test",
      version: 1,
    } as const;
    expect(parseAutofillFilledRequest(receipt)).toEqual(receipt);
    await expect(credentialFingerprint(receipt)).resolves.toBe(
      await credentialFingerprint({ ...receipt, username: " person@example.test " }),
    );
    await expect(credentialFingerprint(receipt)).resolves.not.toContain("same-secret");
    await expect(
      credentialFingerprint({ ...receipt, password: "changed-secret" }),
    ).resolves.not.toBe(await credentialFingerprint(receipt));
  });

  it("recognizes the exact credential just filled without case-sensitive username drift", () => {
    expect(
      credentialsMatch(
        { password: "same-secret", username: " Practice " },
        { password: "same-secret", username: "practice" },
      ),
    ).toBe(true);
    expect(
      credentialsMatch(
        { password: "changed-secret", username: "practice" },
        { password: "same-secret", username: "practice" },
      ),
    ).toBe(false);
  });

  it("suppresses blank legacy duplicates when a named account exists", () => {
    expect(
      preferNamedCredentials([
        { id: "legacy", username: "   " },
        { id: "student", username: "student" },
      ]),
    ).toEqual([{ id: "student", username: "student" }]);

    expect(preferNamedCredentials([{ id: "legacy", username: "" }])).toEqual([
      { id: "legacy", username: "" },
    ]);
  });

  it("dismisses suggestions only after a username diverges case-insensitively", () => {
    expect(shouldDismissSuggestionsForUsername("", ["Practice"])).toBe(false);
    expect(shouldDismissSuggestionsForUsername("PRA", ["Practice"])).toBe(false);
    expect(shouldDismissSuggestionsForUsername("practice", ["Practice"])).toBe(false);
    expect(shouldDismissSuggestionsForUsername("other", ["Practice"])).toBe(true);
    expect(shouldDismissSuggestionsForUsername("typed", null)).toBe(true);
  });

  it("associates password-field suggestion requests with their username field", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const username = document.querySelector<HTMLInputElement>("[autocomplete=username]");
    const password = document.querySelector<HTMLInputElement>("[type=password]");
    expect(usernameFieldForCredentialAnchor(document, username)).toBe(username);
    expect(usernameFieldForCredentialAnchor(document, password)).toBe(username);
  });

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

  it("classifies and fills payment fields but never classifies a security code", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="cc-name">
        <input autocomplete="cc-number">
        <input autocomplete="cc-exp-month">
        <input autocomplete="cc-exp-year">
        <input autocomplete="cc-csc">
      </form>
    `;
    const fields = [...document.querySelectorAll<HTMLInputElement>("input")];
    expect(fields.map(cardFieldKind)).toEqual([
      "cardholderName",
      "cardNumber",
      "expiryMonth",
      "expiryYear",
      null,
    ]);
    const cardNumber = fields[1];
    const securityCode = fields[4];
    if (cardNumber === undefined || securityCode === undefined) throw new Error("Missing fixture");
    expect(fillCardField(cardNumber, "4111111111111111")).toBe(true);
    expect(cardNumber.value).toBe("4111111111111111");
    expect(fillCardField(securityCode, "123")).toBe(false);
  });

  it("accepts strict HTTPS payment request and selection schemas", () => {
    const request = {
      field: "cardNumber",
      topUrl: "https://shop.example.test/checkout",
      type: CARD_AUTOFILL_REQUEST_TYPE,
      userInitiated: true,
      version: 1,
    } as const;
    expect(parseCardAutofillRequest(request)).toEqual(request);
    expect(parseCardAutofillRequest({ ...request, topUrl: "http://shop.example.test" })).toBeNull();
    const selection = {
      cardId: "dGVzdC1jYXJkLWlkMQ",
      field: "expiry",
      topUrl: request.topUrl,
      type: CARD_AUTOFILL_SELECT_TYPE,
      userInitiated: true,
      version: 1,
    } as const;
    expect(parseCardAutofillSelectRequest(selection)).toEqual(selection);
    expect(parseCardAutofillSelectRequest({ ...selection, extra: true })).toBeNull();
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

  it("accepts a case-insensitive username match without rewriting the user's value", () => {
    document.body.innerHTML = `
      <form>
        <input autocomplete="username" value="PRACTICE">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const username = document.querySelector<HTMLInputElement>("[autocomplete=username]");
    const password = document.querySelector<HTMLInputElement>("[type=password]");

    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(true);
    expect(username?.value).toBe("PRACTICE");
    expect(password?.value).toBe("secret");
  });

  it("fills a login form whose site incorrectly marks its password as new-password", () => {
    document.body.innerHTML = `
      <form id="login">
        <input name="username" autocomplete="off">
        <input name="password" type="password" autocomplete="new-password">
        <button type="submit">Login</button>
      </form>
    `;
    const username = document.querySelector<HTMLInputElement>("[name=username]");
    const password = document.querySelector<HTMLInputElement>("[name=password]");

    expect(isRegistrationPasswordField(password)).toBe(false);
    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(true);
    expect(username?.value).toBe("practice");
    expect(password?.value).toBe("secret");
  });

  it("ignores hidden duplicate forms during a protected fill handoff", () => {
    document.body.innerHTML = `
      <form hidden>
        <input autocomplete="username" value="unrelated">
        <input type="password" autocomplete="current-password" value="unrelated-secret">
      </form>
      <form id="visible-login">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const visible = document.querySelector<HTMLFormElement>("#visible-login");
    const inputs = visible?.querySelectorAll<HTMLInputElement>("input");

    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(true);
    expect(inputs?.[0]?.value).toBe("practice");
    expect(inputs?.[1]?.value).toBe("secret");
  });

  it("uses the focused login form when a page contains multiple visible forms", () => {
    document.body.innerHTML = `
      <form id="header-login">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
      <form id="main-login">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const focusedUsername = document.querySelector<HTMLInputElement>(
      "#main-login [autocomplete=username]",
    );
    focusedUsername?.focus();

    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("#main-login [autocomplete=username]")?.value,
    ).toBe("practice");
    expect(document.querySelector<HTMLInputElement>("#main-login [type=password]")?.value).toBe(
      "secret",
    );
    expect(
      document.querySelector<HTMLInputElement>("#header-login [autocomplete=username]")?.value,
    ).toBe("");
  });

  it("fails closed when multiple blank login forms are equally plausible", () => {
    document.body.innerHTML = `
      <form><input autocomplete="username"><input type="password"></form>
      <form><input autocomplete="username"><input type="password"></form>
    `;
    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].every(
        (input) => input.value.length === 0,
      ),
    ).toBe(true);
  });

  it("selects the only on-screen login form when an off-screen duplicate remains mounted", () => {
    document.body.innerHTML = `
      <form id="stale-login">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
      <form id="live-login">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    for (const input of document.querySelectorAll<HTMLInputElement>("#stale-login input")) {
      vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
        bottom: -80,
        height: 40,
        left: 20,
        right: 320,
        top: -120,
        width: 300,
        x: 20,
        y: -120,
        toJSON: () => ({}),
      });
    }
    for (const input of document.querySelectorAll<HTMLInputElement>("#live-login input")) {
      vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
        bottom: 240,
        height: 40,
        left: 20,
        right: 320,
        top: 200,
        width: 300,
        x: 20,
        y: 200,
        toJSON: () => ({}),
      });
    }

    expect(fillLoginFields(document, { password: "secret", username: "practice" })).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("#live-login [autocomplete=username]")?.value,
    ).toBe("practice");
    expect(document.querySelector<HTMLInputElement>("#live-login [type=password]")?.value).toBe(
      "secret",
    );
    expect(document.querySelector<HTMLInputElement>("#stale-login [type=password]")?.value).toBe(
      "",
    );
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
      <form id="signup">
        <input autocomplete="username" value="existing">
        <input type="password" autocomplete="new-password">
        <button type="submit">Create account</button>
      </form>
    `;
    expect(fillLoginFields(document, { password: "secret", username: "other" })).toBe(false);
    expect(document.querySelector<HTMLInputElement>("[autocomplete=username]")?.value).toBe(
      "existing",
    );
  });

  it("suggests and fills one strong password only on registration fields", () => {
    document.body.innerHTML = `
      <form id="signup">
        <input autocomplete="username" value="person@example.test">
        <input type="password" autocomplete="new-password">
        <input type="password" autocomplete="new-password" aria-label="Confirm password">
      </form>
    `;
    const fields = [...document.querySelectorAll<HTMLInputElement>("[type=password]")];
    expect(isRegistrationPasswordField(fields[0] ?? null)).toBe(true);
    const deterministic = {
      randomBytes(length: number) {
        return new Uint8Array(length).fill(7);
      },
    };
    const generated = generateStrongRegistrationPassword(deterministic);
    expect(generated).toHaveLength(20);
    expect(generated).toMatch(/^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/u);
    expect(generated).toMatch(/[A-Z]/u);
    expect(generated).toMatch(/[0-9]/u);
    expect(generated.replaceAll("-", "")).toMatch(/^[A-Za-z0-9]{18}$/u);
    expect([...generated].filter((character) => /[a-z]/u.test(character))).toHaveLength(16);
    expect([...generated].filter((character) => /[A-Z]/u.test(character))).toHaveLength(1);
    expect([...generated].filter((character) => /[0-9]/u.test(character))).toHaveLength(1);
    expect([...generated].filter((character) => character === "-")).toHaveLength(2);
    expect(fillRegistrationPasswordFields(document, generated, fields[0])).toBe(true);
    expect(fields.map((field) => field.value)).toEqual([generated, generated]);
    expect(captureLoginFields(document)).toEqual({
      password: generated,
      username: "person@example.test",
    });
  });

  it("never treats a current-password login as password creation", () => {
    document.body.innerHTML = `
      <form id="sign-in">
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const password = document.querySelector<HTMLInputElement>("[type=password]");
    expect(isRegistrationPasswordField(password)).toBe(false);
    expect(fillRegistrationPasswordFields(document, "Strong-Test-Password-42!", password)).toBe(
      false,
    );
  });

  it("does not infer password creation from a registration URL alone", () => {
    window.history.replaceState(null, "", "/Account/Register");
    document.body.innerHTML = `
      <form action="/Account/Login">
        <input name="username">
        <input name="password" type="password">
        <button type="submit">Login</button>
      </form>
    `;
    const password = document.querySelector<HTMLInputElement>("[type=password]");
    expect(isRegistrationPasswordField(password)).toBe(false);
  });

  it("does not offer login credentials on a registration name field", () => {
    window.history.replaceState(null, "", "/Account/Register");
    document.body.innerHTML = `
      <form action="/Account/Register">
        <label>First and last name <input name="Name"></label>
        <label>Email <input name="Email" type="email"></label>
        <label>Password <input name="Password" type="password"></label>
        <button type="submit">Register</button>
      </form>
    `;
    const name = document.querySelector<HTMLInputElement>("[name=Name]");
    const password = document.querySelector<HTMLInputElement>("[type=password]");
    expect(isRegistrationPasswordField(password)).toBe(true);
    expect(name === null ? true : isUsernameField(name)).toBe(false);
    expect(name === null ? true : isCredentialField(name)).toBe(false);
  });

  it("suggests a new strong password on reset and change-password pages", () => {
    window.history.replaceState(null, "", "/reset-password");
    document.body.innerHTML = `
      <form aria-label="Reset password">
        <h1>Reset password</h1>
        <input type="password" autocomplete="new-password">
        <button type="submit">Change password</button>
      </form>
    `;
    expect(
      isRegistrationPasswordField(document.querySelector<HTMLInputElement>("[type=password]")),
    ).toBe(true);
  });

  it("keeps a mislabelled new-password field in a sign-in form as a login password", () => {
    document.body.innerHTML = `
      <form action="/signin">
        <input autocomplete="username">
        <input type="password" autocomplete="new-password">
        <button type="submit">Sign in</button>
      </form>
    `;
    expect(
      isRegistrationPasswordField(document.querySelector<HTMLInputElement>("[type=password]")),
    ).toBe(false);
  });

  it("separates current and new passwords on a password-change form", () => {
    document.body.innerHTML = `
      <form aria-label="Change password">
        <input type="password" autocomplete="current-password" aria-label="Current password">
        <input type="password" autocomplete="new-password" aria-label="Create password">
        <input type="password" autocomplete="new-password" aria-label="Confirm password">
        <button type="submit">Save password</button>
      </form>
    `;
    const fields = [...document.querySelectorAll<HTMLInputElement>("[type=password]")];
    expect(isRegistrationPasswordField(fields[0] ?? null)).toBe(false);
    expect(isRegistrationPasswordField(fields[1] ?? null)).toBe(true);
    expect(isRegistrationPasswordField(fields[2] ?? null)).toBe(true);
  });

  it("uses Apple's readable default composition and adapts only for site constraints", () => {
    window.history.replaceState(null, "", "/register");
    document.body.innerHTML = `
      <form action="/register">
        <input type="password" autocomplete="new-password" minlength="24" maxlength="28">
        <button type="submit">Create account</button>
      </form>
    `;
    const input = document.querySelector<HTMLInputElement>("[type=password]");
    expect(input).not.toBeNull();
    if (input === null) throw new Error("Expected registration password field");
    const deterministic = {
      randomBytes(length: number) {
        return new Uint8Array(length).fill(11);
      },
    };
    const policy = registrationPasswordPolicy(input);
    expect(policy.appleDefault).toBe(false);
    expect(policy.length).toBe(24);
    expect(policy.label).toBe("24 characters · adapted to this site");
    expect(generateAdaptiveRegistrationPassword(input, deterministic)).toHaveLength(24);
  });

  it("honors passwordrules and offers Apple-style alphanumeric and easy-to-type variants", () => {
    window.history.replaceState(null, "", "/signup");
    document.body.innerHTML = `
      <form action="/signup">
        <input
          type="password"
          autocomplete="new-password"
          passwordrules="required: upper; required: lower; required: digit; allowed: upper, lower, digit; minlength: 14; maxlength: 16"
        >
        <button type="submit">Sign up</button>
      </form>
    `;
    const input = document.querySelector<HTMLInputElement>("[type=password]");
    if (input === null) throw new Error("Expected registration password field");
    const deterministic = {
      randomBytes(length: number) {
        return new Uint8Array(length).fill(7);
      },
    };
    const policy = registrationPasswordPolicy(input);
    expect(policy).toMatchObject({
      appleDefault: false,
      length: 16,
      separator: null,
      supportsNoSpecialCharacters: true,
    });
    const noSpecial = generateAdaptiveRegistrationPassword(input, deterministic, "no-special");
    expect(noSpecial).toHaveLength(16);
    expect(noSpecial).toMatch(/^[A-Za-z0-9]+$/u);
    expect(noSpecial).toMatch(/[A-Z]/u);
    expect(noSpecial).toMatch(/[0-9]/u);

    const easy = generateAdaptiveRegistrationPassword(input, deterministic, "easy-to-type");
    expect(easy).not.toMatch(/[01ILOilo]/u);
  });

  it("disables the no-special option when a website explicitly requires punctuation", () => {
    window.history.replaceState(null, "", "/create-account");
    document.body.innerHTML = `
      <form action="/create-account">
        <input
          type="password"
          autocomplete="new-password"
          passwordrules="required: upper; required: lower; required: digit; required: special"
        >
        <button type="submit">Create account</button>
      </form>
    `;
    const input = document.querySelector<HTMLInputElement>("[type=password]");
    if (input === null) throw new Error("Expected registration password field");
    expect(registrationPasswordPolicy(input).supportsNoSpecialCharacters).toBe(false);
  });

  it("refuses to capture mismatched registration passwords", () => {
    document.body.innerHTML = `
      <form action="/register">
        <input autocomplete="username" value="person">
        <input type="password" autocomplete="new-password" value="first-value">
        <input type="password" autocomplete="new-password" value="different-value">
      </form>
    `;
    expect(captureLoginFields(document)).toBeNull();
  });

  it("detects and fills profile fields without confusing login email fields", () => {
    document.body.innerHTML = `
      <form id="shipping">
        <input autocomplete="given-name">
        <input autocomplete="address-line1">
        <input name="postal_code">
      </form>
      <form id="login">
        <input autocomplete="email">
        <input type="password" autocomplete="current-password">
      </form>
    `;
    const given = document.querySelector<HTMLInputElement>("[autocomplete=given-name]");
    const address = document.querySelector<HTMLInputElement>("[autocomplete=address-line1]");
    const postal = document.querySelector<HTMLInputElement>("[name=postal_code]");
    const loginEmail = document.querySelector<HTMLInputElement>("#login [autocomplete=email]");
    expect(given === null ? null : profileFieldKind(given)).toBe("firstName");
    expect(address === null ? null : profileFieldKind(address)).toBe("addressLine1");
    expect(postal === null ? null : profileFieldKind(postal)).toBe("postalCode");
    expect(loginEmail === null ? null : profileFieldKind(loginEmail)).toBeNull();
    if (given === null) throw new Error("Expected given-name field");
    expect(fillProfileField(given, "Ada")).toBe(true);
    expect(given.value).toBe("Ada");
  });

  it("offers explicit contact and age fields on registration forms", () => {
    document.body.innerHTML = `
      <form id="register">
        <input autocomplete="given-name">
        <input autocomplete="email">
        <input name="age" type="number">
        <input type="password" autocomplete="new-password">
      </form>
    `;
    const given = document.querySelector<HTMLInputElement>("[autocomplete=given-name]");
    const email = document.querySelector<HTMLInputElement>("[autocomplete=email]");
    const age = document.querySelector<HTMLInputElement>("[name=age]");
    expect(given === null ? null : profileFieldKind(given)).toBe("firstName");
    expect(email === null ? null : profileFieldKind(email)).toBe("email");
    expect(age === null ? null : profileFieldKind(age)).toBe("age");
  });

  it("strictly validates profile lookup and selection messages", () => {
    const request = {
      field: "city",
      topUrl: "https://checkout.example.test/address",
      type: PROFILE_AUTOFILL_REQUEST_TYPE,
      userInitiated: true,
      version: 1,
    };
    expect(parseProfileAutofillRequest(request)).toEqual(request);
    expect(parseProfileAutofillRequest({ ...request, field: "password" })).toBeNull();
    const selection = {
      field: "city",
      profileId: "profile_id",
      topUrl: request.topUrl,
      type: PROFILE_AUTOFILL_SELECT_TYPE,
      userInitiated: true,
      version: 1,
    };
    expect(parseProfileAutofillSelectRequest(selection)).toEqual(selection);
    expect(parseProfileAutofillSelectRequest({ ...selection, extra: true })).toBeNull();
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

  it("captures the form that actually submitted instead of another filled form", () => {
    document.body.innerHTML = `
      <form id="unrelated">
        <input autocomplete="username" value="other">
        <input type="password" value="other-secret">
        <button type="submit">Sign in</button>
      </form>
      <form id="submitted">
        <input autocomplete="username" value="practice">
        <input type="password" value="SuperSecretPassword!">
        <button type="submit">Login</button>
      </form>
    `;
    const submitted = document.querySelector<HTMLFormElement>("#submitted");
    expect(captureLoginFields(document, submitted)).toEqual({
      password: "SuperSecretPassword!",
      username: "practice",
    });
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
          : `<form><input name="account-username"><input type="password" autocomplete="current-password"></form>`;
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
