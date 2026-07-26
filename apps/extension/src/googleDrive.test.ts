import { describe, expect, it } from "vitest";
import { buildExtensionGoogleOAuthUrl, parseExtensionGoogleOAuthResult } from "./googleDrive";

describe("extension Google Drive OAuth boundary", () => {
  it("requests only hidden app-data access through the extension redirect", () => {
    const url = new URL(
      buildExtensionGoogleOAuthUrl({
        clientId: "fixture.apps.googleusercontent.com",
        redirectUri: "https://extension-id.chromiumapp.org/oauth/google",
        state: "expected-state",
      }),
    );
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.appdata");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://extension-id.chromiumapp.org/oauth/google",
    );
    expect(url.searchParams.get("state")).toBe("expected-state");
  });

  it("strictly validates the returned state and bearer token", () => {
    expect(
      parseExtensionGoogleOAuthResult(
        "https://extension-id.chromiumapp.org/oauth/google#access_token=abcdefghijklmnopqrstuvwxyz&expires_in=3600&state=expected&token_type=Bearer",
        "expected",
        1_000,
      ),
    ).toEqual({
      accessToken: "abcdefghijklmnopqrstuvwxyz",
      expiresAt: 3_601_000,
    });
    expect(() =>
      parseExtensionGoogleOAuthResult(
        "https://extension-id.chromiumapp.org/oauth/google#access_token=abcdefghijklmnopqrstuvwxyz&expires_in=3600&state=wrong&token_type=Bearer",
        "expected",
      ),
    ).toThrow(/state/u);
  });
});
