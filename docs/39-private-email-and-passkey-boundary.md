# Private Email and Passkey Boundary

Date: 2026-08-03

This document is the release contract for private-email aliases, TOTP, and passkey records. It
separates browser functionality from native credential-provider work that a WebExtension cannot
honestly provide.

## Private email

The extension supports three user-selected methods:

1. **Plus addressing.** The user configures one delivery inbox. On a recognized signup form the
   client generates an origin-labelled address such as `name+signup-example-random@domain`. This
   requires the user's mail provider to support plus delivery; the project operates no mail server.
2. **SimpleLogin.** The user supplies their own API token. The extension requests a random alias
   through SimpleLogin's documented API.
3. **Addy.io.** The user supplies their own API token and alias domain. The extension creates an
   alias through Addy.io's documented API.

Provider selection and tokens are stored in a reserved secure note. The note uses the same
independently keyed, authenticated, immutable encryption and BYOS synchronization as other vault
items. It is excluded from the user library and never copied into browser storage, the locked
suggestion index, logs, or page DOM.

Generation occurs only for a trusted user interaction on an HTTPS top-level page and only when the
field classifier recognizes an email field in a registration/new-password form. Existing non-empty
field content is not overwritten. One generated address is cached briefly per tab and exact origin
to prevent repeated provider calls during dynamic form replacement. When the user approves the
normal credential-save prompt, the alias address, provider, creation time, and origin are stored
with that encrypted login. Declining the credential save does not silently create a password record.

Plus addressing is convenient but is not sender isolation: sites can remove the `+tag`, the delivery
inbox remains visible in the address, and not every provider supports it. SimpleLogin/Addy.io provide
actual aliases and forwarding, but availability, retention, abuse controls, and account recovery
belong to those user-selected services.

## MFA and passkeys

TOTP already works as encrypted `otpauth://` data attached to a login. The client derives the
short-lived verification code locally; the seed is never sent to the application server.

Passkey records in the WebExtension are deliberately **references**, not credentials. A login can
record the RP ID, account label, authenticator type, optional public credential ID, discoverability,
and creation time. Strict schema validation rejects unknown fields and secret/private-key-shaped
payloads. These records help users find which device or provider owns a passkey and synchronize that
inventory as encrypted vault data.

WebAuthn authenticators create and retain passkey private keys. The browser API does not export those
keys to an extension. Chrome's `webAuthenticationProxy` API is intended for remote-desktop proxying
and suspends the browser's native WebAuthn handling; it is not a general password-manager provider
surface. This extension therefore does not intercept registration/assertion ceremonies, synthesize
signatures, or claim that a public reference can authenticate.

A real cross-device passkey provider requires a separately signed native credential-provider target
for each supported platform, secure private-key custody, RP/origin and user-verification policy,
platform entitlements/registration, an authenticated native bridge to encrypted sync, and physical
device testing. Until that component exists, the browser leaves native passkeys fully available.

The manager deliberately does not expose RP IDs, credential IDs, or authenticator metadata as a
setup form. Passkey creation and approval stay in the website/browser's native WebAuthn sheet, where
Touch ID, Windows Hello, or the selected security key performs user verification. VeyraKey may show
an already-linked public reference beside the encrypted login, but it never asks the user to paste a
private credential or pretends that the reference can sign in.

## Vault and account modes

VeyraKey has two explicit storage states rather than a mandatory application account:

1. **Local vault.** No registration or OAuth is required. The encrypted vault remains in this
   browser profile and can be migrated to Google Drive later.
2. **Google-connected vault.** Google OAuth grants access only to the hidden Drive app-data area.
   VeyraKey uploads authenticated encrypted archive data, never the master password or plaintext
   keys. Sync, account switching, and sign-out are separate user actions; signing out leaves the
   local encrypted copy intact.

On a clean device, the user chooses the Google account that owns the app-data archive and supplies
the existing vault master password. Google locates and authorizes the ciphertext; the existing
password decrypts and authenticates it locally. There is no VeyraKey server account or server-side
password reset. A Recovery Kit remains the fallback for an unavailable or forgotten master
password.

Biometric enrollment is also local to one browser profile. An unenrolled device shows one setup
action. An enrolled device shows its active status and a per-device revoke action instead of a
second redundant setup button. Biometric material is never synchronized through Drive; every new
device enrolls independently after the encrypted vault is opened.

## Verification

- Strict settings, provider-response, plus-address, message-schema, alias-metadata, and passkey-
  reference tests.
- Manifest permission/CSP tests for the two optional provider APIs.
- Full workspace unit/integration suite, strict TypeScript checks, Chrome/Firefox MV3 builds, and the
  existing release scanners.
- UI regressions for isolated settings panels, local/no-account setup, Google account switching and
  sign-out, existing-password clean-device restore, and mutually exclusive device setup/revocation.
- Archive integration proves that a clean device can restore every encrypted revision with the
  existing master password and that a wrong password leaves no partial local vault.
- Live provider consent, provider quotas, physical biometric ceremonies, and native credential-
  provider signing remain external release gates and cannot be manufactured by unit tests.
