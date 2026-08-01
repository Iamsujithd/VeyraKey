# External Release Evidence

The local release candidate is automated. The following ceremonies require accounts, hardware, or
an independent person and therefore cannot be replaced by fixtures or assertions in source code.
After a gate is exercised, add non-secret file paths or public review URLs to its `evidence` array in
`release/external-gates.json`, change its status to `complete`, and run
`CI=true pnpm release:verify:public`.

## Google OAuth

Use a dedicated allow-listed test account. Record consent-screen status, registered localhost and
pinned-extension redirects, Drive API enablement, connect/disconnect, token expiry/revocation,
offline recovery, quota failure, cross-device restore, and confirmation that only encrypted app-data
objects are visible. Redact account identifiers and never capture access tokens.

## Browser stores

Submit the exact archives whose SHA-256 hashes appear in `release/release-manifest.json`. Record the
Chrome Web Store and Firefox Add-ons item IDs, signed artifact hashes, permission-review outcome,
approval URLs, version, and rollback/unpublish procedure. Use the copy and reviewer path in
[`39-browser-store-submission.md`](39-browser-store-submission.md).

## Physical biometrics

Exercise supported macOS/Chrome Touch ID, Windows/Chrome Windows Hello, and a roaming security key
where available. Record browser/OS/device versions, PRF capability result, enrollment, successful
fill, cancellation, failed assertion, credential deletion, device revocation, fallback, worker
restart, browser restart, and proof that authentication on one origin cannot release another
origin's credential. A missing capability must remain an honest unsupported state.

## Independent review

Provide the threat model, invariants, architecture, SBOM, release manifest, and synthetic test plan
to someone who did not implement the reviewed behavior. Record security findings by severity and
resolution, keyboard-only and screen-reader results, contrast/zoom/reduced-motion results, and the
reviewer's signed scope statement. Never describe internal automated tests as an independent audit.
