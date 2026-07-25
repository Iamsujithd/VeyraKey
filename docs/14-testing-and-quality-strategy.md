# Testing and Quality Strategy

## Development rule

Every roadmap task begins with failing tests for observable behavior and security properties, implements the smallest integrated production-quality increment, and ends with a demonstrable user flow. No speculative orphan modules.

## Test layers

### Unit tests

Pure schemas, parsers, matching, merge functions, security checks, generators, clocks, field transforms, and UX state machines.

### Known-answer and standards vectors

- Cryptographic primitive/library vectors.
- TOTP RFC vectors.
- WebAuthn fixture vectors.
- SD-JWT/VC/JOSE/COSE/OpenID protocol vectors.
- Status-list and BBS vectors where implemented.
- PDF/XML signature fixtures.

### Property/model tests

- Encrypt/decrypt/tamper properties.
- Sync convergence under arbitrary ordering, duplication, and failure.
- Schema migration round trips.
- Import/export round trips.
- Chunking/reassembly invariants.
- Redaction output contains no removed content.

### Fuzzing and malicious corpora

Target encrypted envelopes, import formats, URLs/origins, extension messages, PDFs, images, XML, JSON/JSON-LD, JWT/CBOR, credential metadata, QR payloads, and archive/package parsers. Preserve every discovered crash/regression as a fixture.

### Provider contract tests

Run every BYOS adapter against one shared suite for immutable put/get/list, retries, cursors, duplicates, auth revocation, quota, stale data, corruption, and interrupted compaction.

### API integration tests

Worker routes, identity validation, authorization, D1 migrations, R2 lifecycle, one-time races, rate limits, Turnstile stubs, CORS, secure headers, and log redaction.

### Browser and extension E2E

- Chromium and Firefox independently.
- Web app and extension builds.
- Worker suspension/restart and browser restart.
- Autofill fixtures: traditional, SPA, shadow DOM, multistep, iframe, IDN, phishing, HTTP.
- WebAuthn fixture RPs.
- Document ingest/OCR/preview.
- Credential issuance/presentation fixtures.

### Accessibility

Automated checks plus keyboard-only, focus order, screen-reader semantics, zoom/reflow, reduced motion, contrast, and non-color security-state verification.

### Performance

- Argon2id calibration and unlock budget.
- Large vault startup/search/sync.
- Attachment/document streaming memory.
- OCR cancellation and memory ceilings.
- Extension content-script overhead.
- Credential/status parsing bounds.

## Security-specific assertions

- No plaintext values in IndexedDB/provider fixtures/server logs.
- Master password and keys never cross mocked network boundaries.
- CSP/Trusted Types prevent inline/script injection paths.
- Remote document/credential resources do not load without policy/consent.
- Unknown versions/algorithms fail closed.
- Sensitive errors are redacted.
- Cross-origin/frame/RP confusion is rejected.

## CI stages

1. Formatting, linting, strict type checking, dependency boundaries.
2. Unit, known-vector, and property tests.
3. Package builds and reproducibility checks.
4. API/provider integration.
5. Browser E2E matrix.
6. Fuzz smoke/regression corpus.
7. Accessibility/performance budgets.
8. Dependency/license/SBOM/secret scans.
9. Release-only full conformance and recovery drill.

## Test data

Use synthetic identities and documents. Real PII, production credentials, real vaults, DigiLocker data, and user secrets are forbidden in fixtures, recordings, screenshots, and CI. Secrets for sandbox integration tests use scoped test accounts and protected CI variables.

## Release evidence

Each release records exact dependency lock, build provenance, migrations, test/conformance results, browser matrix, known limitations, security review findings, recovery drill, and rollback artifact. “Industry-grade” claims require evidence, not only test counts.
