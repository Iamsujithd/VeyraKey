import { describe, expect, it } from "vitest";
import { buildOneDriveOAuthUrl } from "./oneDrive";

describe("OneDrive browser OAuth boundary", () => {
  it("uses authorization code PKCE and the least-privilege app-folder scope", () => {
    const url = new URL(
      buildOneDriveOAuthUrl({
        clientId: "00000000-0000-0000-0000-000000000000",
        codeChallenge: "safe-challenge",
        redirectUri: "http://127.0.0.1:5173/oauth/microsoft/callback",
        state: "safe-state",
      }),
    );
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("Files.ReadWrite.AppFolder offline_access");
    expect(url.searchParams.get("state")).toBe("safe-state");
  });

  it("rejects insecure non-local redirect URIs", () => {
    expect(() =>
      buildOneDriveOAuthUrl({
        clientId: "00000000-0000-0000-0000-000000000000",
        codeChallenge: "safe-challenge",
        redirectUri: "http://example.com/callback",
        state: "safe-state",
      }),
    ).toThrow(/HTTPS or localhost/u);
  });
});
