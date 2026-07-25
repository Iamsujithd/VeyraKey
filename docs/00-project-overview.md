# Project Overview

## Mission

Create an industry-grade portfolio password manager in which logins, secure notes, TOTP secrets, synchronization data, and backups remain under the user's cryptographic control. Convenience features must not require surrendering plaintext to the application operator.

## Primary users

- People who want a transparent zero-knowledge password manager.
- Developers and security reviewers evaluating the architecture and implementation.
- Users who prefer their own Google Drive as encrypted storage.

## Portfolio value

The project demonstrates applied cryptography, browser-extension isolation, offline-first data modeling, deterministic synchronization, OAuth/provider integration, accessible React UX, schema migration, property/security testing, CI, and honest threat modeling.

## V1 surfaces

- React/Vite web application.
- Chromium and Firefox WXT Manifest V3 extensions.
- Shared TypeScript packages.
- Minimal Hono/Cloudflare Worker only where deployment needs it.
- Google Drive `appDataFolder` encrypted source of truth.
- Encrypted IndexedDB offline cache.

## V1 capabilities

- Master-password vault creation, lock/unlock, auto-lock, and password change.
- Checksummed Recovery Kit and optional WebAuthn PRF convenience unlock.
- Encrypted immutable login and secure-note CRUD.
- Deterministic offline/multi-device sync with visible conflict copies.
- Google Drive synchronization and clean-profile recovery.
- Secure MV3 extension sessions.
- Exact-origin login autofill, save, and update.
- Password/passphrase generation, TOTP, and clipboard timeout.
- Tags, favorites, folders, and encrypted search.
- CSV/Bitwarden import and encrypted archive backup/restore.
- Local weak/reused/old analysis and HIBP k-anonymous password checks.
- Hardening, accessibility, reproducible builds, and a polished portfolio demo.

## Deferred direction

WebDAV, Secure Send, SSH keys, software passkeys, cards/identities/attachments, document intelligence, digital credentials, and DigiLocker are preserved in [`32-future-work.md`](32-future-work.md). They are not v1 promises or release blockers.

## Success definition

V1 succeeds when the 14-task roadmap is complete, the synthetic end-to-end journey passes on supported browsers, no critical/high security issue remains unresolved, limitations are accurately documented, and another developer can reproduce the build and understand the design.
