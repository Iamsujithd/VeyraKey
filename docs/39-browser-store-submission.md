# Browser Store Submission Package

## Listing copy

**Name:** VeyraKey

**Short description:** A browser-first encrypted password, identity, TOTP, and BYOS vault with
exact-origin AutoFill.

**Detailed description:** VeyraKey encrypts vault records on the user's device before
optional synchronization to user-owned cloud storage. It supports login and secure-note history,
identity and payment-card field filling, TOTP, strong-password generation, encrypted sharing,
password-health checks, clean-profile recovery, and exact-HTTPS-origin AutoFill. Master passwords,
recovery secrets, plaintext vault records, and decrypted cloud data are not sent to an application
server.

## Permission justification

- `activeTab`: deliver an explicitly selected credential only to the currently requested page.
- `identity`: complete user-initiated Google Drive OAuth through the browser identity flow.
- `scripting`: inject the reviewed AutoFill content script into the active HTTPS page.
- `storage`: retain encrypted vault state, locked suggestion metadata, and bounded session state.
- `https://*.googleapis.com/*`: store and retrieve encrypted BYOS objects in Google Drive app data.
- `https://api.pwnedpasswords.com/*`: perform padded five-character SHA-1 prefix queries; passwords
  and complete hashes are never transmitted.

## Reviewer path

1. Load the submitted archive in a clean profile and create a synthetic local-only vault.
2. Save a synthetic login for an HTTPS fixture, lock the manager, select the matching username,
   authenticate, and verify exact-origin fill.
3. Verify HTTP, look-alike origins, cross-origin frames, and CVV fields remain untouched.
4. Create a synthetic registration credential and verify generation appears only on new-password
   fields and stores only after user confirmation.
5. Import and restore only synthetic encrypted data. Do not review with personal credentials.
6. If testing Drive, use the release owner's allow-listed OAuth account and verify `drive.appdata`
   is the only requested Drive scope.

## Submission assets

- Icons: `apps/extension/public/icons/icon-{16,32,48,128}.png`.
- Chrome archive: `apps/extension/.output/veyrakey-extension-0.10.0-chrome.zip`.
- Firefox archive: `apps/extension/.output/veyrakey-extension-0.10.0-firefox.zip`.
- Privacy disclosure: [`16-privacy-and-compliance-notes.md`](16-privacy-and-compliance-notes.md).
- Security policy and reviewer evidence: [`34-hardening-evidence.md`](34-hardening-evidence.md).

Store screenshots, promotional tiles, signed-store IDs, review correspondence, and approval URLs are
release-owner artifacts. Record them under the `browser-stores` entry in
`release/external-gates.json`; do not commit account tokens, recovery secrets, or personal data.
