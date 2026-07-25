# Trust and Threat Model

## Security objectives

- Confidentiality and integrity of vault content at rest and in transit.
- User-controlled recovery without operator escrow.
- Deterministic, loss-resistant multi-device synchronization.
- Origin-bound autofill and passkey operations.
- Safe processing of hostile files and credential metadata.
- Minimal and informed identity disclosure.
- Accurate separation of cryptographic validity from institutional trust.

## Protected assets

- Master password and derived key material.
- Recovery Kit and WebAuthn PRF outputs.
- Root, compartment, item, attachment, and holder private keys.
- Passwords, TOTP seeds, passkey private keys, SSH private keys, notes, identities, cards, and attachments.
- Documents, OCR text, extracted attributes, credential originals, presentations, and disclosure history.
- BYOS OAuth tokens and provider credentials.
- Import/export files and Secure Send transfer keys.

## Adversaries

- Compromised application server, D1, R2, BYOS provider, or network path.
- Malicious website interacting with the extension.
- Malicious browser extension or endpoint malware.
- Malicious document, image, PDF, XML, credential, metadata server, issuer, or verifier.
- Attacker possessing encrypted vault data or an expired share link.
- Lost or stolen enrolled device.
- Curious/colluding issuer and verifier performing correlation.
- Insider or dependency/supply-chain attacker.
- User error, provider inconsistency, and accidental deletion.

## Out-of-scope protections

The product cannot guarantee secrecy on an already-unlocked, fully compromised endpoint; deterministic erasure of secrets from a JavaScript runtime; detection of a self-consistent historical vault presented without any trusted newer checkpoint; concealment of all traffic metadata from providers; revocation of plaintext already copied by a recipient or compromised device; legal truth from cryptographic signatures; or hardware attestation from browsers that lack it. These limits must remain visible in product and release documentation.

## Threats and mitigations

| Threat | Primary mitigations | Residual risk |
|---|---|---|
| Offline master-password guessing | Argon2id floor, per-vault salt, strong-password UX, no server verifier | Weak user password remains guessable with stolen vault header |
| Server/BYOS breach | Client E2EE, independent item keys, authenticated envelopes | Size/timing/account metadata remains visible |
| Local V2 header tampering or component replay | Root-derived security tag authenticates the complete canonical mutable V2 header; strict parsing; payload/wrapper context binding | A self-consistent historical header cannot be identified as stale on a fresh client without a trusted newer checkpoint |
| Active-session header rollback | Monotonic authenticated revision, tag verification before privileged reads, payload authentication on forward reconciliation, fail-closed lock | A provider controlling all history can deny or selectively hide newer data outside the active checkpoint |
| Concurrent bootstrap mutation | Atomic compare-and-replace; stale writer locks, clears compartments, reloads the winner's locked summary, and reports a conflict | Availability can be interrupted by contention or malicious local storage behavior |
| Compartment substitution | Independent random compartment keys; fresh step-up unwraps the same slot's root and requires equality with the active root before opening the requested compartment | A fully compromised unlocked endpoint can read keys while their bounded session is active |
| Sync data loss | Immutable revisions, deterministic merge, conflict copies, tombstones | Quota exhaustion and total provider deletion require backups/recovery exports |
| Extension page attack | Isolated worlds, strict message schemas, origin/frame/RP checks, least privilege | Browser/extension zero-days remain possible |
| Autofill phishing | Exact origin matching, IDN display, user gesture for ambiguity, no insecure/cross-frame default | User can explicitly approve a malicious site |
| Password-exposure lookup | Local SHA-1, five-character range prefix only, padded response request, strict bounded parser, explicit per-item action | HIBP/network observers still see IP, timing, and a prefix anonymity set |
| Passkey interception abuse | RP ID/origin/challenge validation, scoped MAIN-world bridge, fallback to native authenticator | Browser behavior and compatibility vary |
| Malicious file | MIME sniffing, limits, sandbox workers, no active content/network, fuzzed parsers | Parser vulnerabilities can still exist |
| Credential metadata tracking | Pinned/cached resources, consent before network retrieval, no remote holder keys | Status timing and issuer identifiers can remain correlatable |
| Credential over-request | Credential firewall, purpose display, disclosure simulator, privacy budget, explicit consent | Coercive verifier policy cannot be solved cryptographically |
| Share-link leak | High-entropy transfer key in fragment/out-of-band, TTL, one-time option | Anyone with full link can decrypt before deletion |
| Lost device | Auto-lock, PRF/user verification, remote key-slot revocation after sync | An unlocked stolen device can expose current session data; revocation cannot erase previously extracted keys |
| Malicious dependency | Exact pins, lockfile review, SBOM, provenance, restricted interfaces, audits | Upstream compromise can evade automated detection |
| Recovery loss | Checksummed Recovery Kit, recovery drill, encrypted bootstrap restore | No server recovery if all user recovery material is lost |

## Task 3 local-bootstrap security boundary

- Ordinary unlock authenticates the V2 security header and encrypted payload but installs only the root key. Document and credential keys remain sealed.
- Password, Recovery Kit, and device compartment step-up authenticate the selected slot's root wrapper against the active root session before opening that same slot's compartment wrapper.
- Every privileged mutation rereads and authenticates persisted state. A newer valid revision is reconciled only after payload authentication and clears existing compartment sessions; a lower, malformed, replayed, or unauthenticated revision locks the client and fails with a write conflict.
- Compare-and-replace losers never continue with stale keys or stale unlocked UI. They lock, wipe controllable compartment buffers best effort, and publish the committed winner as locked when it can be reloaded safely.
- The five-minute sliding root idle timer and 60-second non-sliding compartment timer reduce exposure but are availability/session controls, not defenses against endpoint malware or clock/runtime control.

## Credential-specific privacy threats

- Stable issuer signatures and identifiers can link presentations.
- SD-JWT selective disclosure does not provide complete issuer/verifier unlinkability.
- Status URLs and indices can identify a credential; request timing/IP can reveal presentation.
- Metadata and rendering URLs can phone home.
- Error responses can leak whether a claim exists or matches.
- Government identity convenience can lead to unnecessary identity requests.

Mitigations include cached bulk status lists, strict resource policy, disclosure warnings, indistinguishable denial/mismatch behavior where protocols allow, no silent presentations, and an exposure graph.

## Security review triggers

Re-run threat analysis when changing cryptographic formats, key hierarchy, persistence, extension permissions, document parsers, credential protocol versions, trust/status retrieval, OAuth/token handling, share-link construction, telemetry, or any release gate.

## V1 implementation review

The implemented v1 has no server route that accepts vault data, credentials, HIBP queries, or OAuth
tokens. The remaining highest-risk boundaries require real-environment evidence: compromised
unlocked endpoints, browser/extension lifecycle behavior, Google OAuth configuration and provider
metadata, JavaScript secret retention, supply-chain compromise, and public deployment controls.
Local tests and artifact scans reduce risk but are not an independent audit.
