import { describe, expect, it } from "vitest";
import { extensionManifest, manifestForBrowser } from "./manifest";

describe("extension manifest", () => {
  it("requests only session-storage capability and no host access", () => {
    expect(extensionManifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(extensionManifest.host_permissions).toEqual([]);
  });

  it("uses a restrictive extension-page CSP", () => {
    const policy = extensionManifest.content_security_policy.extension_pages;

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
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
