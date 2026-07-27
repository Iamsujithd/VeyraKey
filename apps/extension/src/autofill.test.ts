// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AUTOFILL_REQUEST_TYPE,
  CAPTURE_REQUEST_TYPE,
  captureLoginFields,
  fillLoginFields,
  parseAutofillRequest,
  parseCaptureRequest,
} from "./autofill";

describe("extension automatic autofill", () => {
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
});
