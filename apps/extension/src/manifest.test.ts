import { describe, expect, it } from "vitest";
import { extensionManifest, manifestForBrowser } from "./manifest";

describe("extension manifest", () => {
  it("identifies the WebAssembly-enabled build", () => {
    expect(extensionManifest.version).toBe("0.10.0");
    expect(extensionManifest.name).toBe("VeyraKey");
    expect(extensionManifest.action.default_title).toBe("Open VeyraKey");
    expect(extensionManifest.icons).toEqual({
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    });
  });

  it("requests only browser tools, OAuth identity, storage, and Google API access", () => {
    expect(extensionManifest.permissions).toEqual([
      "activeTab",
      "identity",
      "scripting",
      "storage",
    ]);
    expect(extensionManifest.host_permissions).toEqual([
      "https://*.googleapis.com/*",
      "https://api.pwnedpasswords.com/*",
      "https://app.simplelogin.io/*",
      "https://app.addy.io/*",
    ]);
  });

  it("uses a restrictive extension-page CSP", () => {
    const policy = extensionManifest.content_security_policy.extension_pages;

    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self' https://*.googleapis.com");
    expect(policy).toContain("https://api.pwnedpasswords.com");
    expect(policy).toContain("https://app.simplelogin.io");
    expect(policy).toContain("https://app.addy.io");
    expect(policy).not.toMatch(/(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/u);
    expect(policy).not.toContain("unsafe-inline");
  });

  it("declares no data collection for the Firefox build", () => {
    const firefoxManifest = manifestForBrowser("firefox");

    expect(firefoxManifest.permissions).toEqual(["activeTab", "identity", "scripting", "storage"]);
    expect(firefoxManifest).toHaveProperty(
      "browser_specific_settings.gecko.data_collection_permissions.required",
      ["none"],
    );
    expect(firefoxManifest).toHaveProperty(
      "browser_specific_settings.gecko.id",
      "veyrakey@local.invalid",
    );
  });
});
