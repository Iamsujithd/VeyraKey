# Vault Data Model

## Principles

- Persist immutable encrypted revisions, not mutable plaintext objects.
- Keep provider-visible names opaque and random.
- Preserve unknown supported-version data during synchronization/import where safe.
- Validate decrypted content at every trust boundary.
- Separate original evidence from locally derived/display data.
- Make snapshots and indexes rebuildable.

## Conceptual entities

### Vault header

Task 3 persists exactly one strict bootstrap object. `VaultHeaderV1` remains read-only for authenticated one-way migration. `VaultHeaderV2` contains:

```text
VaultHeaderV2
├── format, version=2, minimumClientVersion=2
├── vaultId (canonical 16-byte base64url)
├── revision (integer >= 1)
├── masterPasswordSlot
│   ├── id, type/version, bounded Argon2id parameters and salt
│   └── wrappedKeys { root, document, credential }
├── recoverySlot
│   ├── id, type/version
│   └── wrappedKeys { root, document, credential }
├── deviceSlots[] (maximum 16)
│   ├── active: id, credentialId, PRF input, three wrapped keys
│   └── revoked: id, type/version, status only (no wrappers)
├── encryptedPayload
│   └── authenticated schema-v2 empty item list + Recovery Kit drill state
└── securityTag (canonical base64url of 24-byte nonce + 16-byte tag)
```

The parser requires exact fields, canonical fixed-length encodings, accepted algorithms/versions, bounded KDF parameters, unique slot IDs, unique active credential IDs, valid envelope shapes, and a positive revision. Unknown fields and versions fail closed. Every generated V2 header is run through this parser before create or replacement persistence.

The root-derived `securityTag` authenticates the complete canonical mutable V2 security header except itself, including revision, all slot records/wrappers, encrypted payload, and format markers. Unlock and restore verify the tag after obtaining the root key. Privileged live-session operations reread and verify it; revision regression, component replay, invalid forward state, or full-header rollback relative to the authenticated session locks and fails as a write conflict.

The encrypted Task 3 payload intentionally contains no Task 4 items. Its exact plaintext schema is `{ format: "zk-wallet-empty-vault", schemaVersion: 2, items: [], recoveryKitVerified: boolean }` and is accepted only after authenticated decryption and strict schema validation.

The header must not contain a plaintext password/recovery verifier, Recovery Kit secret, PRF output, vault/compartment key, document name, account name, URL, credential claim, or item plaintext.

### Atomic bootstrap mutation

Local replacement is one IndexedDB compare-and-replace conditioned on the current vault ID, format version, and revision. Drill completion, Recovery Kit replacement, device enrollment/revocation, password change, and V1 migration commit a complete next header with incremented revision and fresh security tag. A stale writer cannot merge or overwrite the winner: it locks, clears compartment/session material best effort, reloads the committed locked summary when safe, and returns `VAULT_WRITE_CONFLICT`.

A valid newer header encountered during an active session is adopted only after security-tag and encrypted-payload authentication; both compartment sessions are cleared before publication. This local monotonic checkpoint does not replace the immutable sync ancestry and trusted-history work planned for later tasks.

### Item

Supported domain types include:

- Login, secure note, TOTP, software passkey.
- Card, identity, address.
- Attachment and SSH key.
- Document and document derivative.
- Digital credential and presentation receipt.
- Folder/tag metadata and encrypted settings.

Common encrypted fields include item ID, type, title, timestamps, favorite state, tags/folders, custom fields, and domain-specific payload. Provider filenames use separate opaque identifiers.

### Immutable revision

```text
RevisionEnvelope
├── opaque revision locator
├── authenticated format/version
├── encrypted payload
│   ├── item ID and type
│   ├── device ID
│   ├── hybrid logical clock
│   ├── parent revision IDs
│   ├── item-key wrapper/version
│   ├── schema-valid item content or tombstone
│   └── merge/audit metadata
└── authentication tag
```

Sensitive identifiers remain inside ciphertext unless a minimal opaque value is required for retrieval.

### Tombstone

An immutable deletion revision with ancestry and HLC. Tombstones remain until compaction proves all active device checkpoints have observed them. A later valid edit based on a deleted ancestor becomes an explicit conflict rather than silently resurrecting data.

### Snapshot/manifest

Encrypted acceleration structures containing known revision heads, provider cursors, device checkpoints, and compacted state references. They are untrusted hints and can be discarded/rebuilt.

### Audit event

Encrypted append-only event containing category, local time/HLC, affected opaque item reference, client/device, decision, and redacted evidence. Audit chains detect local omission/reordering but are not a public transparency ledger.

### Document record

- Original encrypted chunks and original cryptographic hash.
- User-confirmed metadata and category.
- Untrusted OCR/classification candidates with confidence.
- Expiry/reminder data.
- Signature/provenance evidence and freshness.
- Derived redacted-copy lineage.
- Exposure/consent edges.

Original and derivative bytes are distinct items; a derivative never replaces the source.

### Credential envelope

- Original credential bytes/token.
- Detected format and exact profile version.
- Normalized display claims.
- Cryptographic verification result.
- Issuer identity and authorization evidence.
- Status result/freshness and resource cache references.
- Holder key reference and portability class.
- Disclosure/presentation receipts.

## Indexes

Search, duplicate, expiry, security-dashboard, and exposure indexes are local encrypted derived data. They can be rebuilt after unlock from canonical items and are never authoritative.

## Schema evolution

- Every encrypted payload includes a schema version.
- Migrations are deterministic and tested with golden fixtures.
- Original credential/document bytes are never rewritten by a metadata migration.
- A migration writes a new immutable revision; it does not mutate provider history.
- Unknown future versions fail closed without destructive downgrade.
- Rollback is allowed only while the old readable revisions and key wrappers remain.

## Size and quota policy

- Enforce configurable item, attachment, document, chunk, and total-cache limits.
- Stream large imports and document processing.
- Warn before provider quota exhaustion.
- Do not expose exact filenames/types in provider object names.
- Compaction cannot remove the last recoverable copy of required data.
