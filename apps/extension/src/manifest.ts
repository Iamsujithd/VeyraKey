export const extensionManifest = {
  action: {
    default_title: "Open Zero-Knowledge Wallet",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://*.googleapis.com https://api.pwnedpasswords.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  },
  description: "A browser-first zero-knowledge security and identity wallet.",
  host_permissions: ["https://*.googleapis.com/*", "https://api.pwnedpasswords.com/*"],
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt/mAyYbU0fn6w8RuJguaSsbKM3UdD8SZMjlRiymIc6ccBPcHRI9RjuZwsQEI+fYtJie2MDKnNpzLI8Y3omT4UrGznHEW1j/bejOFi6A6iGXZ1Vchc+041Jm2d+d1Nr2vnR1VM+iVp7GFayJC+5NpRo4w8YrwQjMAtObqtjAZ65kOfbdGTDHYmBgZ4gwWuT4UK4Pe2JMZdni6rHZlt5u8FHMkx2ehQj/duu8zB36K+ICpPcNgp0E+4qlYiMkLk9L7DkNgbzt/wU2L7X0FWEJnm5NQdCPZ9tqSFTE6YewxQdnUfgWarBp/qI1hrPcASuT7I2+NzQu7dvFVDAVAlbYlFwIDAQAB",
  name: "Zero-Knowledge Wallet",
  permissions: ["activeTab", "identity", "scripting", "storage"],
  version: "0.6.2",
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
