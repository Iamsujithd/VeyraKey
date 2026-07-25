import { describe, expect, it } from "vitest";
import { buildGoogleOAuthUrl, parseGoogleOAuthFragment } from "./googleDrive";

describe("Google Drive browser OAuth boundary", () => {
  it("requests only appDataFolder access with an exact redirect and state", () => {
    const url = new URL(
      buildGoogleOAuthUrl({
        clientId: "fixture.apps.googleusercontent.com",
        redirectUri: "http://127.0.0.1:5173/oauth/google/callback",
        state: "state-value",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.appdata");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:5173/oauth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("response_type")).toBe("token");
  });

  it("strictly validates state, bearer type, lifetime, and localhost redirects", () => {
    expect(
      parseGoogleOAuthFragment(
        "#access_token=abcdefghijklmnopqrstuvwxyz&expires_in=3600&state=expected&token_type=Bearer",
        "expected",
        1_000,
      ),
    ).toEqual({
      accessToken: "abcdefghijklmnopqrstuvwxyz",
      expiresAt: 3_601_000,
    });
    expect(() =>
      parseGoogleOAuthFragment(
        "#access_token=abcdefghijklmnopqrstuvwxyz&expires_in=3600&state=wrong&token_type=Bearer",
        "expected",
      ),
    ).toThrow(/state/u);
    expect(() =>
      buildGoogleOAuthUrl({
        clientId: "fixture.apps.googleusercontent.com",
        redirectUri: "http://remote.example/callback",
        state: "state",
      }),
    ).toThrow(/HTTPS or localhost/u);
  });
});
