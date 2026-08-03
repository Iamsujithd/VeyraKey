# Constraints and Non-Goals

## Hard constraints

### Zero knowledge

The application operator must not possess decryption keys or plaintext vault content. Features requiring server-side plaintext processing are rejected or redesigned for local execution.

### V1 source of truth

Google Drive stores encrypted canonical history. IndexedDB is an encrypted offline cache, and the application API is not a fallback vault database.

### Browser-first

V1 must work through a web app and Chromium/Firefox MV3 extensions. Native-only security capabilities are reported unavailable and deferred rather than simulated insecurely.

### Free initial operation

Approved dependencies/services must have a free and legally compatible path. Free-tier quotas and lack of SLA are accepted constraints, not hidden. Paid optional user-provided services do not become required.

### No recovery backdoor

Recovery uses user-held material. Support staff and server administrators cannot reset the master password or decrypt a vault.

## V1 non-goals

- WebDAV or multiple production sync providers.
- Cards, identities, addresses, attachments, payment autofill, and custom fields.
- Passkey private-key custody or WebAuthn assertion signing in the WebExtension.
- SSH key storage.
- Secure Send.
- Document storage/intelligence and digital-credential protocols.
- DigiLocker/API Setu integration.
- Apple iCloud storage integration.
- Safari extension.
- Native iOS, Android, macOS, Windows, or Linux apps.
- Native secure-element/key attestation guarantees.
- Native SSH agent/`SSH_AUTH_SOCK`.
- Browser SSH terminal/raw TCP gateway.
- Persistent live shared vaults or shared write access.
- Emergency/delegate access.
- Server-managed password reset or escrow.
- Continuous paid email/dark-web breach monitoring.
- A project-operated alias domain, SMTP ingress, or two-way email relay.
- CCA eSign creation or any paid signing API.
- Guaranteed secure deletion from provider backups or recipient devices.
- Production SLA on free tiers.

## Engineering constraints

- TypeScript-first; Rust/WASM core is deferred unless a measured security/performance need justifies it.
- React/Vite and WXT are approved client defaults; Hono/Workers remains minimal and optional beyond deployment needs.
- Exact dependencies are selected/pinned during implementation.
- One vertical roadmap task at a time.
- Tests precede implementation and each task ends with integrated demo evidence.
- Existing security invariants cannot be traded for delivery speed without an approved architecture decision.

## Product constraints

- Google Drive OAuth and master-password unlock remain visibly separate.
- Users must understand loss of all recovery material is unrecoverable.
- Only password compromise checks are included; account-breach monitoring is deferred.
- Password rotation reminders are user/site policy, not a universal forced schedule.

## Deferred opportunities

- Native platform apps and hardware-backed credentials.
- iCloud provider.
- Native SSH agent.
- Document and digital-credential wallet expansions described in `32-future-work.md`.
- A native credential-provider target capable of creating and signing passkeys.
- Persistent collaboration only after a separate group-key/access-revocation design.
