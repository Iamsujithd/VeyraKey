import { describe, expect, it } from "vitest";
import { extensionManifest, manifestForBrowser } from "./manifest";

describe("extension manifest", () => {
  it("identifies the WebAssembly-enabled build", () => {
    expect(extensionManifest.version).toBe("0.1.0");
  });

  it("requests only browser tools, OAuth identity, storage, and Google API access", () => {
    expect(extensionManifest.permissions).toEqual([
      "activeTab",
      "identity",
      "scripting",
      "storage",
    ]);
    expect(extensionManifest.host_permissions).toEqual(["https://*.googleapis.com/*"]);
  });

  it("uses a restrictive extension-page CSP", () => {
    const policy = extensionManifest.content_security_policy.extension_pages;

    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self' https://*.googleapis.com");
    expect(policy).not.toMatch(/(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/u);
    expect(policy).not.toContain("unsafe-inline");
  });

  it("declares no data collection for the Firefox build", () => {
    const firefoxManifest = manifestForBrowser("firefox");

    expect(firefoxManifest).toHaveProperty(
      "browser_specific_settings.gecko.data_collection_permissions.required",
      ["none"],
    );
    expect(firefoxManifest).toHaveProperty(
      "browser_specific_settings.gecko.id",
      "zero-knowledge-wallet@local.invalid",
    );
  });
});
