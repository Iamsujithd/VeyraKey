# Portfolio V1 Implementation Roadmap

## Delivery rule

Implement sequentially. For every task: add failing tests first, implement one secure integrated increment, validate it, demonstrate it, record evidence in [`20-progress.md`](20-progress.md), and update decisions or risks when assumptions change. Industry-grade means a smaller feature set completed deeply, not a broad collection of partial features.

## Phase A — Secure foundation

### Task 1: Secure walking skeleton — complete

- **Simple purpose:** Make the same locked product run as a web app, Chrome extension, Firefox extension, and minimal API.
- **Includes:** React/Vite, WXT MV3, Hono Worker, shared TypeScript packages, CI, strict builds, CSP, pinned dependencies, and package boundaries.

### Task 2: Vault creation, encryption, lock, and unlock — complete

- **Simple purpose:** Let a user create a local encrypted vault and unlock it with a master password.
- **Includes:** Argon2id, random vault keys, authenticated encryption, strict formats, safe errors, and lock lifecycle.

### Task 3: Recovery, compartments, and device security — complete

- **Simple purpose:** Give the user a Recovery Kit, optional device unlock, password change, auto-lock, and extra protection for sensitive key compartments.
- **Includes:** Recovery drill/restore, WebAuthn PRF capability gate, device revocation, root/document/credential key separation, and step-up authentication.

### Task 4: Encrypted login and secure-note CRUD — complete

- **Simple purpose:** Save, edit, list, and delete encrypted logins and private notes.
- **Includes:** Strict schemas, independent item keys, immutable local revisions, tombstones, IndexedDB migration, restart recovery, and concurrent-edit rejection.

## Phase B — Core password manager

### Task 5: Immutable offline sync engine — complete

- **Simple purpose:** Make two offline devices eventually agree without silently losing either device's work.
- **Includes:** Provider-neutral interface, device IDs, hybrid logical clocks, revision DAG, deterministic merging, retries, encrypted snapshots, checkpoints, tombstones, and visible conflict copies.
- **Demo:** Two simulated offline devices edit, reconnect, converge, and preserve an unsafe conflict.

### Task 6: Google Drive encrypted synchronization — complete

- **Simple purpose:** Use the user's Google Drive `appDataFolder` as the encrypted source of truth.
- **Includes:** Least-privilege OAuth, immutable uploads, change feeds, pagination, retries, quotas, token expiry/revocation, and clean-profile recovery.
- **Demo:** Two browser profiles synchronize and recover using synthetic vault data.

### Task 7: Secure browser-extension sessions — complete

- **Simple purpose:** Keep the extension safely usable across MV3 service-worker restarts while locking on browser restart or timeout.
- **Includes:** Restricted `storage.session`, trusted context/message validation, lock broadcasts, multi-popup/tab coordination, idempotency, and no persistent plaintext.

### Task 8: Origin-safe autofill and credential capture — complete

- **Simple purpose:** Fill and save credentials only on the correct website.
- **Includes in v1:** Standard forms, common SPA forms, exact-origin/IDN validation, conservative iframe/HTTP refusal, save prompts, and update prompts.
- **Deferred edge cases:** Broad related-domain matching, arbitrary shadow-DOM traversal, and every unusual multistep login.

### Task 9: Password generation, TOTP, and clipboard controls — complete

- **Simple purpose:** Generate strong credentials, store authenticator secrets, produce TOTP codes, and clear copied secrets after a timeout.
- **Includes:** Unbiased CSPRNG passwords/passphrases, RFC TOTP vectors, QR/URI import, conservative TOTP fill, and honest best-effort clipboard clearing.

### Task 10: Organization and encrypted search — complete

- **Simple purpose:** Help users find and organize a larger vault.
- **Includes:** Tags, favorites, simple folders, and a rebuildable encrypted local search index.
- **Deferred item types:** Cards, identities, addresses, attachments, payment autofill, and custom fields.

## Phase C — Product maturity

### Task 11: Focused import and encrypted backup — complete

- **Simple purpose:** Move into and out of the product without losing data.
- **Includes in v1:** Generic CSV import, one Bitwarden-compatible import, preview, validation, duplicate warnings, rollback, encrypted archive export, and clean-profile restore.
- **Deferred:** Apple/Chrome/1Password-specific importers, complex merges, and ordinary plaintext export.

### Task 12: Password-health dashboard — complete

- **Simple purpose:** Show weak, reused, old, and known-compromised passwords without exposing passwords.
- **Includes:** Local analysis, password-age recommendations, HIBP Pwned Passwords k-anonymity, padded response parsing, offline behavior, and malicious-response tests.
- **Deferred:** Continuous account-breach monitoring, paid API-key support, and complex 2FA heuristics.

### Task 13: Whole-system hardening and accessibility — complete

- **Simple purpose:** Turn the working product into defensible industry-grade engineering.
- **Includes:** Updated threat model, fuzz/property/security corpus, sync chaos, offline/provider-failure tests, parser/network limits, CSP/permission review, SBOM, dependency review, accessibility, performance profiling, KDF worker evaluation, code splitting, and documented limitations.

### Task 14: Deployment and portfolio release — in review (external gates open)

- **Simple purpose:** Produce a reproducible, reviewable, polished portfolio release.
- **Includes:** Static web deployment, minimal Worker deployment only where needed, Google OAuth configuration, Chrome/Firefox packages, production smoke tests, migration/rollback plan, SBOM, architecture walkthrough, threat-model summary, demo script, screenshots, and release checklist.

## Optional stretch work after v1

Choose at most one or two only after Task 14:

1. Ciphertext-only Secure Send.
2. SSH key vault.
3. Basic encrypted document storage with safe image/PDF preview and expiry reminders.
4. WebDAV provider adapter.

The larger document-intelligence, digital-credential, DigiLocker, software-passkey, payment, attachment, and identity-wallet plans are preserved in [`32-future-work.md`](32-future-work.md), not committed v1 deliverables.
