# V1 Hardening Evidence

## Security and resilience

- Cryptographic vectors and randomized round trips cover HKDF, XChaCha20-Poly1305, Argon2id, TOTP,
  strict envelopes, tamper rejection, and vault lifecycle races.
- Model/property tests shuffle and duplicate immutable sync histories; integration tests cover
  offline edits, conflicts, retry, quarantine, provider quota/auth/network failures, and oversized
  provider responses.
- Hostile autofill fixtures cover exact origins, IDNs, HTTP, opaque origins, frames, ambiguity, and
  changed forms. Import, archive, search-index, and HIBP parsers have strict sizes and malformed or
  malicious-response tests.
- CI verifies least-privilege MV3 permissions, no persistent host permissions, self-only script
  CSP, no production source maps or embedded private-key markers, and a per-chunk size budget.

## Accessibility review

The shared UI uses semantic headings, labelled form controls, real buttons, keyboard-native
controls, visible focus styling, `role=alert` for failures, polite live regions for operations, and
text labels in addition to color. Automated component tests query the setup, unlock, item,
recovery, import, and confirmation journeys by accessible role or label.

Manual release checks remain required for keyboard traversal, zoom/reflow, contrast, VoiceOver,
NVDA, focus restoration after errors, QR unsupported behavior, and browser-extension popup sizing.
An independent accessibility audit is not claimed.

## Performance and KDF decision

- Production validation enforces a 900 kB ceiling for every JavaScript chunk and separates React
  and the cryptographic runtime into cacheable production chunks.
- Argon2id intentionally retains the v1 floor (19,456 KiB, two operations, one lane). Busy and
  failure states are visible; security parameters never silently downgrade.
- Moving Argon2id to a worker is deferred until representative browser/device measurements can
  verify worker loading, cancellation, memory behavior, extension CSP, and session-race handling.
  The current main-thread KDF is an explicit documented performance limitation, not hidden.

## Dependency review

Production security-sensitive dependencies are few and exactly pinned: libsodium wrappers provide
the project-owned cryptographic primitives and `@scure/base` provides strict encoding; React is the
UI runtime, Hono is the minimal health Worker, and Vite/WXT are build tooling. Workspace boundaries
prohibit API imports of client crypto/vault/persistence modules. The lockfile, restricted install
scripts, checked-in CycloneDX SBOM, and artifact scanner are release inputs.

Automated evidence cannot prove that an upstream package is uncompromised. Lockfile diffs,
provenance/license review, advisories, and built-artifact hashes must be reviewed for each tagged
release.
