# Project Context

## Status

- **Phase:** V1 implementation complete through Task 13; release evidence is in review.
- **Current implementation task:** Task 14 — portfolio release (local artifacts complete; external gates open).
- **Task 4 execution brief:** [`docs/31-task-4-continuation-brief.md`](docs/31-task-4-continuation-brief.md)
- **Completed implementation tasks:** 13/14; Task 14 cannot be marked complete before its external gates.
- **Workspace state at documentation creation:** Greenfield; no application files existed.
- **Primary plan:** [`docs/19-implementation-roadmap.md`](docs/19-implementation-roadmap.md)
- **Progress tracker:** [`docs/20-progress.md`](docs/20-progress.md)

## Mission

Build an industry-grade portfolio v1: a browser-first, zero-knowledge password manager with encrypted offline storage, user-controlled recovery, deterministic Google Drive synchronization, safe browser autofill, TOTP, encrypted backup/restore, and local password-health analysis. The application server must never possess keys that decrypt vault content.

## Non-negotiable invariants

1. Master passwords, Recovery Kit secrets, PRF outputs, vault keys, compartment keys, item keys, plaintext records, documents, credentials, and BYOS OAuth tokens never enter application-server storage or logs.
2. Google account sign-in identifies the account; the separate master password unlocks the vault locally.
3. There is no server reset, escrow, or emergency-access backdoor.
4. Every persistent vault object is encrypted and authenticated before leaving the trusted client runtime.
5. Google Drive is the v1 source of truth; local IndexedDB is an encrypted offline cache.
6. Sync uses immutable revisions, tombstones, deterministic merging, and rebuildable snapshots—not one mutable vault blob.
7. Reserved sensitive compartments require step-up authentication and separate keys.
8. Unsupported browser/security capabilities fail closed and are reported honestly.
9. No cloud AI receives vault data.
10. Security-sensitive dependencies are pinned exactly and hidden behind project-owned interfaces.

## Approved platform and stack

- React + Vite web application.
- WXT Chromium/Firefox Manifest V3 extension builds.
- Shared TypeScript packages for crypto, vault, sync, providers, documents, credentials, and UI.
- Hono on Cloudflare Workers only for minimal v1 deployment needs.
- Google Drive `appDataFolder` as the first BYOS adapter.

## Approved v1 scope

- Logins and secure notes with immutable encrypted revisions.
- Master-password unlock, Recovery Kit, auto-lock, password change, and optional PRF convenience unlock.
- Deterministic offline sync and Google Drive `appDataFolder`.
- Secure MV3 sessions, exact-origin autofill, save/update prompts, and unsafe-context refusal.
- Password/passphrase generation, TOTP, and clipboard timeout.
- Tags, favorites, simple folders, and rebuildable encrypted local search.
- Generic CSV and one Bitwarden-compatible importer.
- Provider-independent encrypted archive backup and restore.
- Local weak/reused/old password analysis and HIBP k-anonymous compromise checks.
- Whole-system hardening, accessibility, reproducible deployment, and a polished portfolio demonstration.

## Explicit non-goals for v1

- WebDAV, multiple production providers, cards, identities, addresses, attachments, payment autofill, software passkeys, SSH keys, Secure Send, document intelligence, digital credentials, DigiLocker, iCloud, Safari, native desktop/mobile apps, native SSH agent, browser SSH terminal, persistent live shared vaults, emergency access, continuous paid breach monitoring, email aliases, arbitrary-PDF selective disclosure, and paid eSign generation.

## Security model summary

Task 3 persists independent random root, document, and credential keys, each wrapped separately by the master-password, Recovery Kit, and active WebAuthn PRF device slots. Task 4 adds independently keyed immutable login/note revisions. A root-derived V2 security tag authenticates mutable bootstrap state. Privileged mutations use atomic compare-and-replace; rollback or a stale writer locks rather than continuing with stale keys. Google Drive can observe traffic metadata and ciphertext sizes but cannot derive vault keys. Zero knowledge does not protect an unlocked compromised endpoint, guarantee JavaScript erasure, or prove freshness when a provider presents a self-consistent old history to a fresh client.

## Deferred expansion

The former document-wallet, digital-credential, DigiLocker, Secure Send, SSH, software-passkey, WebDAV, and broader item plans are preserved as future work, not v1 commitments. See [`docs/32-future-work.md`](docs/32-future-work.md).

## Working rules for future agents

1. Read this file, [`docs/26-security-invariants.md`](docs/26-security-invariants.md), the relevant architecture document, and the current roadmap task before editing.
2. Complete one vertical roadmap task at a time using failing tests first.
3. Do not weaken a security invariant to make a demo pass.
4. Record material decisions in [`docs/21-architecture-decisions.md`](docs/21-architecture-decisions.md).
5. Update [`docs/20-progress.md`](docs/20-progress.md) after every completed task and validation run.
6. Do not mark official integrations production-ready until their release gates are satisfied.

## Documentation map

Start with [`docs/README.md`](docs/README.md). Constraints and release blockers are in [`docs/17-constraints-and-non-goals.md`](docs/17-constraints-and-non-goals.md) and [`docs/18-risks-and-release-gates.md`](docs/18-risks-and-release-gates.md). Research sources are in [`docs/22-research-sources.md`](docs/22-research-sources.md).
