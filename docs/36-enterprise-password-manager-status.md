# Enterprise password-manager status

Date: 2026-07-29

This file separates implemented product behavior from platform-dependent follow-up work. It is a
release contract, not a marketing wish list.

## Implemented in extension 0.10.0

- Exact-HTTPS-origin login suggestions that remain silent when no saved credential exists.
- Concise username-first field suggestions with fresh biometric or master-password authorization
  before a password is released.
- Explicit save/update/not-now capture after a login submission, including service-worker-safe
  pending state.
- Conservative signup-only strong-password suggestions. The default is a readable 20-character
  `xxxxxx-Xxxxxx-xxxx0x` shape, and website `passwordrules`, length limits, patterns, and described
  requirements can produce a compatible alternative.
- Encrypted login, TOTP verification-code, secure-note, contact/address identity-profile, and
  payment-card records with independent item keys, authenticated immutable revisions, search,
  sync, backup, restore, and conflict handling.
- Field-level identity/contact AutoFill after an explicit selection.
- Exact-origin HTTPS payment AutoFill for recognized cardholder, card-number, and expiry fields.
  CVV/CVC is never stored or filled, and payment forms are never submitted automatically.
- Authenticated immutable item history with conflict-protected restore, plus encrypted single-item
  shares whose ciphertext file and 256-bit secret are delivered separately and expire by policy.
- Automatic k-anonymous Pwned Passwords checking when a login is created, updated, captured, or
  imported. Only the first five SHA-1 hash characters leave the client. The bounded result is
  encrypted with the login; a manual retry is available.
- Recommended user-owned Google Drive or OneDrive storage, explicit device-only mode, encrypted
  provider migration, Recovery-Kit restoration, and multi-device use without project-owned key
  escrow.
- A compact browser controller, separate manager tab, progressive item editor, dark/light themes,
  Apple Passwords-style sidebar/list/detail Security recommendations, readable opaque management
  surfaces, sparse transient glass, reduced-transparency and reduced-motion fallbacks, and
  keyboard-visible controls.
- Weak, reused, and breached recommendations are actionable. Password age is deliberately not
  inferred from item edit time, so the product does not display a misleading “Old” classification.

## Deliberate security boundaries

- The cloud provider is storage and identity transport, not a vault-unlock factor. Providers
  receive authenticated ciphertext and cannot reset the master password.
- Locked suggestion metadata contains only credential ID, username, and exact HTTPS origin. It is
  local-only and is never synchronized.
- A breach-service outage never blocks an encrypted save and is stored as `unavailable`, never as
  a clean result.
- Downloadable encrypted shares cannot be recalled from a recipient who already possesses both
  parts. Embedded expiry is enforced by this client, while true revocation requires a relay or a
  rekeyable shared-vault protocol.

## Platform work that is not falsely claimed

### Native passkey provider

A Chrome HTML content script cannot safely become Apple Passwords' system credential provider.
Full passkey creation, storage, signing, conditional suggestions, and cross-device provider
behavior require a native credential-provider target, platform entitlements, RP/origin validation,
secure private-key storage, signature-counter policy, browser registration, and a native fallback.
The WebExtension therefore detects and leaves existing site/browser passkey flows intact; it does
not intercept WebAuthn or claim to store passkey private keys.

The next valid implementation target is:

1. A macOS/iOS Authentication Services Credential Provider Extension for Apple platforms.
2. A Windows native companion using the supported Windows credential/passkey provider surface.
3. A narrowly authenticated native-messaging bridge to the encrypted vault.
4. Independent protocol, hostile-origin, lifecycle, and hardware-backed ceremony testing.

### External release evidence

Physical Touch ID/Windows Hello completion, user-owned Google/Microsoft OAuth success, signed store
installation, Firefox UI validation, native credential-provider entitlements, and an independent
security assessment cannot be manufactured by unit tests. They remain explicit release gates.
