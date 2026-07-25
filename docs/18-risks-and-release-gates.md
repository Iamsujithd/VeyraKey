# Portfolio V1 Risks and Release Gates

## Gate severity

- **Blocker:** Portfolio v1 cannot be presented as complete.
- **Feature blocker:** The optional capability stays disabled; the rest of v1 may release.
- **Warning:** Release may proceed with an explicit limitation.

## V1 release gates

| Gate | Severity | Evidence required |
|---|---|---|
| Crypto/key hierarchy | Blocker | Vectors, threat review, strict migration/recovery tests, retained security regressions |
| Recovery | Blocker | Clean-profile restore with Recovery Kit; corruption and loss behavior documented |
| Immutable sync | Blocker | Model/property convergence, interruption, duplication, skew, rollback, tombstone, and conflict-copy suites |
| Google Drive | Blocker for Drive demo | OAuth configuration, fake-provider suite, test-account sync/recovery, quota/expiry/revocation behavior |
| Extension session | Blocker | Worker/browser restart, timeout, multi-context, hostile-message, and plaintext-inspection tests |
| Autofill origin security | Blocker | Look-alike, IDN, HTTP, frame, SPA, destination, and hostile-page fixtures |
| TOTP/generation | Blocker | RFC vectors, boundary cases, unbiased generation properties, malformed imports, clipboard lifecycle |
| Import/backup | Blocker | Malformed/oversize/formula fixtures, duplicate/rollback behavior, encrypted round trip |
| HIBP privacy | Blocker | Prefix-only network assertions, padded parsing, offline/malicious response handling |
| Accessibility | Blocker | Keyboard, screen reader, focus, labels, errors, and non-color state checks for core journeys |
| Client performance | Warning | Representative-device KDF profiling, responsive busy/error UX, bundle/KDF-worker decision |
| WebAuthn PRF | Feature blocker | Real browser/OS/authenticator evidence for any claimed combination; fallback always works |
| Browser store signing | Feature blocker per channel | Signed/accepted artifact before claiming store availability |
| Google OAuth public branding/domain | Blocker for public hosted Drive demo | Valid consent screen, privacy links, approved domain/client |
| Privacy/security claims | Blocker | Accurate limits for endpoint compromise, traffic metadata, HIBP, and best-effort clearing |
| Independent assessment | Warning | Required before claiming external audit, not for an honest portfolio release |

## Principal risks

### Compromised unlocked browser

Malware or a hostile extension controlling an unlocked endpoint can read active plaintext. Minimize permissions and key lifetime, validate extension boundaries, auto-lock, and state the limitation honestly.

### JavaScript secret lifetime

Typed-array overwrites and cleared form state reduce accidental retention but cannot guarantee physical erasure from engines, immutable strings, garbage collection, caches, or crash artifacts.

### Weak master passwords

Argon2id increases offline guessing cost but cannot rescue a weak password. Keep the KDF floor, encourage strong passwords, profile responsiveness, and never reduce security silently for slow devices.

### Provider inconsistency or deletion

Google Drive can reorder, duplicate, delay, corrupt, or delete objects. Immutable revisions, deterministic sync, conflict copies, snapshots, and encrypted backups mitigate this; the application server is not a backup.

### Sync data loss

Clock skew, stale snapshots, delete/edit races, retries, and interrupted uploads can silently lose data if the merge model is wrong. Task 5 model/property tests are a release blocker.

### MV3 lifecycle

Service workers terminate unpredictably. Operations must be idempotent, sessions must not become permanent plaintext, and browser restart must lock.

### Autofill phishing

Look-alike domains, IDNs, iframes, HTTP pages, dynamic forms, and page scripts can trick autofill. Exact destination validation and hostile fixtures are mandatory.

### Supply chain and bundle size

Pinned crypto dependencies increase bundle size and audit surface. Retain exact pins, SBOM, boundary checks, production artifact scans, code splitting, and dependency review.

### Free-tier and OAuth limitations

Google or Cloudflare quotas and OAuth verification may limit a public demo. Local vault operation must survive service outages, and the demo must document any account or quota constraints.

### Security-claim risk

“Zero knowledge” and “industry grade” describe architecture and engineering evidence, not immunity from endpoint compromise or an external audit. Portfolio copy must remain precise.

## Deferred-feature policy

WebDAV, Secure Send, documents, credentials, DigiLocker, software passkeys, SSH keys, payments, and other [`32-future-work.md`](32-future-work.md) items do not block portfolio v1 because they are not enabled or claimed.

## Risk ownership

Every blocker receives an owner and evidence link before the affected task is marked complete. Security/privacy blockers cannot be waived merely to meet a date. Accepted residual risks require an ADR and user-visible limitation where relevant.
