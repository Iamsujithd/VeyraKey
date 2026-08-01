# Portfolio flagship roadmap

Date: 2026-07-31

This roadmap deliberately limits the portfolio release to five deep systems. A feature is not
complete because a control is visible: its protocol, failure behavior, security boundary,
accessibility, migration path, and automated evidence must all pass the release gates below.

## Current implementation snapshot

- The local implementation covers the non-negotiable vault foundation, exact-origin login and
  identity AutoFill, protected payment-field fill without CVV or submission, adaptive generation,
  save/update deduplication, Google Drive/OneDrive encrypted BYOS, immutable sync/history/restore,
  recovery, imports/backups, TOTP, password-health checks, and encrypted single-item sharing.
- The whole-repository gate passes 37 test files/243 tests plus strict typechecking, web and both
  MV3 builds, and production artifact/permission/source-map/secret/size/SBOM validation.
- Physical biometric ceremonies, live provider-consent matrices, signed browser-store packages,
  native credential-provider passkeys, independent assessment, and downloadable-share revocation
  remain external or native-platform gates and are not marked complete by local automation.

## Non-negotiable foundation

- A user can create a device-only vault or restore/connect a user-owned cloud vault.
- Google Drive is the primary BYOS provider; encrypted migration remains provider-neutral.
- Master-password and Recovery-Kit access work without project-owned accounts or key escrow.
- Device authentication is optional and never weakens the password fallback.
- Plaintext secrets and vault keys never enter BYOS, the control plane, telemetry, or page scripts.
- The extension stays silent when it has no useful suggestion and never authenticates merely to
  discover whether an entry exists.
- Adaptive generation appears only for new/reset/change-password fields, not ordinary login.
- Save/update prompts are deduplicated, survive same-tab redirects, and reuse an authorized session.
- Chrome/Firefox, keyboard and screen-reader use, offline behavior, import, encrypted backup, and
  clean-profile recovery are release requirements.

## Flagship 1 — Intelligent, phishing-resistant AutoFill

**Outcome:** credentials appear only where they belong, with minimal interruption.

- Standard, SPA, delayed, multi-step, change-password, and conservative Shadow DOM discovery.
- Exact-origin default with IDN/confusable detection and an explicit related-domain model.
- Username-first ranking, unlocked direct fill, automatic device authentication when locked, and
  master-password fallback without redundant choices.
- Reliable save/update capture across redirects with unchanged-credential suppression.
- Adaptive Apple-style strong passwords using site constraints and confirmation-field pairing.
- A concise "why suggested / why blocked" diagnostic view that never exposes the password.
- Release gate: a versioned 100-form compatibility corpus plus cross-browser black-box and hostile
  origin tests.

## Flagship 2 — Offline-first BYOS and trusted devices

**Outcome:** one encrypted vault works offline across devices and can move between providers.

- Google Drive source of truth, device-only mode, encrypted provider migration, and resumable sync.
- Immutable revision DAG, deterministic convergence, visible conflicts, rollback, and tombstones.
- Trusted-device list with enrollment, last sync, capability, and revocation state.
- Recovery-Kit clean-profile restore and guided migration/recovery drills.
- Release gate: multi-device chaos tests for offline edits, duplication, reordering, partial upload,
  quota, OAuth expiry, corruption, stale snapshots, revocation, and interrupted migration.

## Flagship 3 — Actionable Security Center

**Outcome:** the product finds real risks and guides the user to resolve them.

- Local weak/reused analysis and k-anonymous compromised-password checks on save/update/import.
- Compromised, reused, weak, missing-2FA, insecure-origin, and dismissed recommendations.
- Guided password changes that distinguish current/new/confirmation fields and update only after
  success, retaining a short encrypted rollback revision.
- Privacy-preserving security timeline for device, sync, recovery, export, and credential events.
- Release gate: malicious breach-response tests and black-box change-flow success/failure tests.

## Flagship 4 — Passkeys and authenticator codes

**Outcome:** modern passwordless and two-factor authentication live beside passwords.

- Encrypted TOTP import, QR/URI validation, clock-skew handling, expiring codes, and explicit fill.
- Passkey metadata, RP binding, lifecycle, backup eligibility, provenance, and security reporting.
- A versioned native-provider boundary for actual passkey creation/assertion where supported.
- Native platform passkeys remain available; the WebExtension never intercepts WebAuthn or claims
  to own private keys it cannot securely protect.
- Release gate: RFC vectors, parser abuse, clock-boundary, RP-mismatch, protocol, and physical-device
  evidence for native ceremonies.

## Flagship 5 — Protected personal data, sharing, and history

**Outcome:** identities, cards, and selected secrets can be used safely and recovered.

- Multiple encrypted identity/address profiles with field-level explicit AutoFill.
- Payment cards with fresh protected authorization, HTTPS/top-frame restrictions, CVV excluded by
  default, and no automatic submission.
- Immutable item history, diff metadata, restore, soft deletion, retention, and conflict ancestry.
- End-to-end encrypted single-item sharing with verification, expiry, and honest revocation limits.
- Generic CSV, Bitwarden, Chrome, Firefox, Apple, and 1Password import with preview, duplicate
  handling, normalization, and encrypted rollback.
- Release gate: hostile payment fields, sharing replay/expiry, history restore, and importer corpora.

## Common definition of done

1. Threat and privacy boundaries are documented before implementation.
2. Strict schemas, bounded inputs, migrations, and fail-closed behavior exist.
3. Unit, integration, black-box, accessibility, and adversarial tests pass.
4. Offline, cancellation, timeout, restart, retry, and partial failures remain usable.
5. UI explains user outcomes and no dead control ships.
6. Production packages pass permission, CSP, secret, source-map, SBOM, and artifact checks.
7. Platform-dependent claims have physical evidence or remain explicitly unavailable.

## Delivery order

1. Close foundation regressions and freeze the compatibility corpus.
2. Finish Flagship 1 because every other convenience feature depends on page understanding.
3. Finish Flagship 2 for durable multi-device use.
4. Add Flagship 3 on the stable item/history foundation.
5. Add TOTP and the native passkey boundary from Flagship 4.
6. Add protected personal data, sharing, and broad import from Flagship 5.
