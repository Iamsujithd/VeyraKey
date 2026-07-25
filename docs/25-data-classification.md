# Data Classification

## Classes

### Class S0 — Public

Product documentation, public capability metadata, public keys/trust anchors, specification identifiers, release versions, public status pages, and non-sensitive static assets.

### Class S1 — Operational metadata

Pseudonymous account ID, coarse timestamps, endpoint/status/latency, rate-limit state, relay size class/expiry, client version/capabilities, and aggregate health. Minimize and retain briefly.

### Class S2 — Encrypted user ciphertext

Encrypted vault headers, revisions, snapshots, tombstones, attachments, documents, credentials, audit history, search indexes, and Secure Send payloads. Still sensitive because sizes/timing/access patterns leak information.

### Class S3 — Sensitive plaintext

Usernames, URLs, notes, cards, identities, addresses, audit details, OCR, document metadata, credential claims, presentation requests/receipts, filenames, and provider configuration. Allowed only in trusted client memory for an active operation.

### Class S4 — Secret/key material

Master password, KDF output, Recovery Kit, PRF output, vault/compartment/item/chunk/transfer keys, passwords, TOTP seeds, passkey/SSH/holder private keys, BYOS tokens/credentials, plaintext exports, and share decryption secrets. Highest restrictions.

## Location policy

| Location | S0 | S1 | S2 | S3 | S4 |
|---|:---:|:---:|:---:|:---:|:---:|
| Public static assets | Yes | No | No | No | No |
| Worker memory | Yes | Limited | Relay only | No | Server integration secrets only; never user vault/BYOS keys |
| D1 | Yes | Minimal | No vault ciphertext; relay metadata only | No | No |
| R2 | No | Locator metadata elsewhere | Temporary relay ciphertext only | No | No |
| BYOS | No | Opaque provider metadata | Yes | No | Wrapped keys only as S2, never unwrapped S4 |
| Encrypted IndexedDB | No | Encrypted | Yes | No | Wrapped keys/session policy only; no master password |
| `storage.session` | No | Minimal | Minimal sealed/session state | Avoid | Short-lived approved session material only under trusted-context policy |
| Trusted client memory | Yes | Yes | Yes | Active-operation only | Minimum lifetime only |
| Logs/telemetry | Yes | Allowlist only | No payload | No | No |
| Test fixtures | Synthetic public/ciphertext | Synthetic | Synthetic | Synthetic only | Test-only non-production secrets |

## Data-flow rules

- Downgrading classification requires encryption, irreversible aggregation, or explicit redaction review.
- Encryption changes S3/S4 payload to S2 only if keys remain separate and metadata is minimized.
- Hashes of low-entropy identifiers/passwords remain sensitive and must not be treated as anonymous.
- Document fingerprints remain user-local; no cross-user central duplicate service.
- URL fragments carrying transfer keys must not enter Referer, logs, analytics, or server requests.
- Error messages are classified according to embedded content, not error type.

## Server allowlist

Server schemas use explicit approved fields. Unknown fields are rejected rather than logged/stored. Request/response body logging is disabled on identity, relay, and future integration routes.

## Client persistence review

Every new persistence field documents classification, encryption/key, reason, retention, migration, deletion behavior, sync behavior, and whether it appears in export. Security tests inspect browser/provider stores for known plaintext canaries.

## Deletion and retention

- S1 operational data has a documented short retention.
- R2 S2 relay content expires automatically and through application cleanup.
- BYOS S2 history follows tombstone/compaction policy and provider-version caveats.
- Local S3/S4 memory deletion is best effort in JavaScript runtimes.
- Encrypted audit/exposure data has user-configurable/defined retention without breaking required security evidence.
