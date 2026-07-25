export const extensionManifest = {
  action: {
    default_title: "Open Zero-Knowledge Wallet",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  },
  description: "A browser-first zero-knowledge security and identity wallet.",
  host_permissions: [],
  name: "Zero-Knowledge Wallet",
  permissions: ["activeTab", "scripting", "storage"],
  version: "0.0.1",
};

export function manifestForBrowser(browser: string) {
  return {
    ...extensionManifest,
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              data_collection_permissions: {
                required: ["none" as const],
              },
              id: "zero-knowledge-wallet@local.invalid",
            },
          },
        }
      : {}),
  };
}
