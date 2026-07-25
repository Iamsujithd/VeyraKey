# Portfolio V1 Product Requirements

## Product statement

Build a browser-first, zero-knowledge password manager with encrypted offline storage, user-controlled recovery, deterministic multi-device synchronization through Google Drive, safe browser autofill, TOTP, encrypted backups, and local password-health analysis.

The portfolio goal is depth: each shipped capability must have strict security boundaries, tests, migrations, accessible UX, documented limitations, and a polished demonstration.

## V1 functional requirements

### Vault and recovery

- Create, lock, and unlock a vault entirely in trusted client code.
- Support a master password and checksummed Recovery Kit.
- Support capability-gated WebAuthn PRF convenience unlock without making it mandatory.
- Change the master password by rewrapping random keys.
- Auto-lock and revoke enrolled device slots.
- Keep document/credential compartment foundations sealed for future use, without shipping document or credential products in v1.

### Password-manager data

- Create, read, update, and delete logins and secure notes.
- Preserve immutable encrypted revisions and authenticated tombstones.
- Organize items with tags, favorites, and simple folders.
- Search locally through a rebuildable encrypted index.
- Generate strong passwords and passphrases.
- Store and generate TOTP codes.

### Synchronization

- Work offline through encrypted IndexedDB.
- Synchronize immutable encrypted revisions deterministically.
- Preserve concurrent unsafe edits as visible conflict copies.
- Use Google Drive `appDataFolder` as the only production v1 provider.
- Recover a clean browser profile from Google Drive plus the Recovery Kit.
- Keep provider OAuth tokens client-side.

### Browser extension

- Maintain a short authorized MV3 session without permanent plaintext storage.
- Lock on browser restart and configured timeout.
- Validate extension messages, senders, tabs, frames, origins, and operations.
- Autofill only after exact origin/IDN and safe-frame validation.
- Offer conservative save and update prompts.
- Refuse unsafe HTTP, opaque, sandboxed, look-alike, and unapproved cross-origin contexts by default.

### Migration and backup

- Import generic CSV and one documented Bitwarden-compatible format.
- Preview imports, report unsupported fields, warn about duplicates, and roll back failures.
- Export and restore an encrypted provider-independent archive.
- Do not make ordinary plaintext export a v1 feature.

### Password health

- Detect weak, reused, and old passwords locally.
- Check known compromise through HIBP's k-anonymous Pwned Passwords protocol.
- Never transmit a password or complete password hash.
- Give clear, actionable recommendations without overstating certainty.

## V1 non-functional requirements

### Security and privacy

- All persistent sensitive content is authenticated ciphertext outside trusted client memory.
- Unknown formats, algorithms, corrupt data, unsafe origins, and ambiguous authorization fail closed.
- Logs and telemetry contain no secrets, vault content, user origins, or sensitive payloads.
- Use exact dependency pins and project-owned crypto/storage/sync boundaries.
- Maintain a threat model and retained security regression tests.

### Reliability and portability

- Support offline reads and edits after unlock.
- Use deterministic sync and idempotent retries.
- Rebuild from immutable revisions when snapshots are missing or corrupt.
- Version and validate every persisted format.
- Keep encrypted backups independent of Google Drive.

### Accessibility and performance

- Target WCAG 2.2 AA for core workflows.
- Support keyboard and screen-reader use and non-color-only security states.
- Profile representative-device unlock and extension performance.
- Evaluate moving expensive KDF work off the main thread and split oversized bundles.

### Portfolio evidence

- Provide reproducible setup/build/test commands.
- Include architecture, threat-model, ADR, limitations, and demo documentation.
- Demonstrate a complete synthetic-data journey.
- Never claim external audit, guaranteed JavaScript erasure, or standards conformance without evidence.

## Deferred from v1

- WebDAV and multiple production sync providers.
- Cards, identities, addresses, attachments, payment autofill, and custom fields.
- Software-passkey storage.
- SSH key vault.
- Secure Send.
- Private document wallet, OCR, signature validation, redaction, and exposure mapping.
- Verifiable credentials, SD-JWT, OpenID4VCI, OpenID4VP, DCQL, BBS, mdoc, and Digital Credentials API.
- DigiLocker/API Setu.
- Google application-account control plane beyond what Drive OAuth or a minimal deployment requires.

See [`32-future-work.md`](32-future-work.md) for preserved expansion ideas.

## V1 acceptance

The release must complete the focused journey in [`30-definition-of-done.md`](30-definition-of-done.md), preserve applicable invariants in [`26-security-invariants.md`](26-security-invariants.md), and have no unresolved v1 blocker in [`18-risks-and-release-gates.md`](18-risks-and-release-gates.md).
