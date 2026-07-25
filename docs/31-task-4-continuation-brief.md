# Task 4 Continuation Brief

## Outcome

The repository is ready to begin Roadmap Task 4: encrypted login and secure-note CRUD. Tasks 1–3 provide a passing foundation for root-key lifecycle, recovery, compartment step-up, authenticated bootstrap mutation, IndexedDB persistence, and shared web/extension UI.

Task 4 must be delivered as one vertical increment: versioned domain records, independently keyed encrypted immutable local revisions, atomic persistence, CRUD through the vault client, and usable shared UI on both application surfaces. It must not start provider sync, autofill, TOTP, attachments, general import/export, or extension background sessions.

## Verified baseline

Validation on 2026-07-25:

- `pnpm lint` passed; Biome checked 63 files.
- Recursive TypeScript checking passed for all eight runnable workspace projects.
- `pnpm test` passed: 18 files and 78 tests.
- `pnpm build` produced the Worker dry run, Vite web build, and Chrome/Firefox MV3 builds.
- Wrangler attempted to write a debug log outside the workspace and reported `EPERM`, but its dry-run build itself completed successfully. This is a local sandbox logging warning, not a source/build failure.
- Vite and WXT report an approximately 792 kB uncompressed crypto-inclusive JavaScript chunk. This is known build debt, not a Task 4 blocker.
- This directory has no usable `.git` worktree metadata. Before commit/branch/PR work, restore or clone the repository with its `.git` directory; do not initialize an unrelated history over this snapshot.

## Current architecture seams

### `@zk-wallet/crypto`

Already owns random bytes, HKDF-SHA-256, XChaCha20-Poly1305, Argon2id, encoding, and best-effort byte clearing. Task 4 should reuse this provider and extend authenticated context through project-owned vault code. Application/UI code must not call primitives directly.

### `@zk-wallet/vault`

Already owns strict V1/V2 header parsing, root-session lifecycle, payload authentication, recovery/device/password mutations, compare-and-replace reconciliation, and the public `VaultClient`. The service currently assumes schema-2 empty payloads and exposes `itemCount: 0`.

Task 4 should add item/revision types, strict parsers, migration functions, and item operations here. Avoid further growth of the existing monolithic `service.ts`: extract item schema, revision crypto, and mutation logic into focused modules while keeping key ownership instance-scoped.

### `@zk-wallet/persistence`

Currently stores one mutable bootstrap header in IndexedDB database version 1/store `bootstrap`. Task 4 needs a separate immutable revision store and a small atomic local-head/index store. Bootstrap replacement and item revision/head publication must not be split into a crash-unsafe sequence.

Upgrade IndexedDB with `onupgradeneeded` and preserve existing Task 2/3 vaults. Repository interfaces belong in the vault boundary; the IndexedDB implementation belongs here. Never persist decrypted records, titles, usernames, URLs, notes, search text, or raw item keys.

### `@zk-wallet/ui`

The shared screen already handles lifecycle, recovery, step-up, and safe error states. Its duplicated structural `VaultClient`/state declarations should be replaced or extended carefully so the UI remains decoupled without drifting from `@zk-wallet/vault`.

Task 4 should add an unlocked item list, create/edit forms for login and note, delete confirmation, empty/loading/error states, and keyboard/label semantics. Secret form values must be cleared on submit, cancel, lock, conflict, and unmount.

### Applications and API

Web and extension compose the same client and screen. Both must exercise the Task 4 flow. The API remains unchanged and must continue to have no imports from crypto, vault, or persistence.

## Proposed Task 4 format

The exact serialized format is security-sensitive and must be accepted in a new ADR before production implementation. The implementation should satisfy these constraints:

### Plaintext domain schemas

- `LoginItemV1`: item ID, type `login`, title, username, password, ordered URI list, notes, created/updated timestamps.
- `SecureNoteItemV1`: item ID, type `secure-note`, title, note body, created/updated timestamps.
- Strict exact-field validation, bounded UTF-8 lengths, canonical IDs/timestamps, and no permissive unknown-field acceptance.
- Use an explicit discriminated union and schema version. A migration reads an older schema into a new immutable revision; it never mutates old ciphertext.

Do not add tags, folders, favorites, custom fields, attachments, TOTP, passkeys, cards, identities, or search indexes in this task.

### Immutable local revision

Each create, edit, or delete writes a new immutable encrypted revision:

- Random opaque item ID and random opaque revision ID.
- Random 32-byte item data-encryption key.
- The item key is wrapped by a root-derived item-key-encryption key; login and note items are in the general/root compartment.
- AEAD context binds format/version, vault ID, item ID, revision ID, parent revision ID, payload schema version, operation, and purpose.
- Create has no parent; edit/delete references exactly one current local head.
- Delete stores an authenticated tombstone, not recoverable plaintext.
- The cleartext storage projection contains only bounded opaque routing/version fields required for local retrieval. Sensitive domain fields remain ciphertext.

Task 5 will add device IDs, HLC, revision DAG convergence, provider objects, snapshots, and conflict copies. Task 4 must preserve enough ancestry to extend into Task 5 without pretending local compare-and-replace is multi-device sync.

### Atomic write contract

Use one IndexedDB read-write transaction to:

1. Read the current head for the item.
2. Verify the caller's expected head (or absence for create).
3. Add the immutable revision with a unique key.
4. Update the local head/index projection.

Concurrent editors using the same expected head must produce one winner and one `ITEM_WRITE_CONFLICT`; never last-write-wins. A failed transaction must leave neither a published head nor an orphan accepted as current.

Bootstrap header mutations remain governed by their existing revision/security-tag CAS. Item revisions should not be embedded back into the bootstrap encrypted payload, because that would recreate a mutable whole-vault blob and impede Task 5.

## Public operations

Add minimal operations to the vault client:

- `listItems()` returns decrypted, schema-validated summaries/records only while unlocked.
- `createLogin(input)` and `createSecureNote(input)`.
- `updateLogin(expectedRevisionId, input)` and `updateSecureNote(expectedRevisionId, input)`.
- `deleteItem(itemId, expectedRevisionId)`.

Every operation must reconcile the authenticated bootstrap/root session before using keys, reject locked or expired sessions, serialize with existing exclusive session operations where applicable, and collapse ciphertext/schema failures to a non-sensitive item-corruption error. The UI should not receive raw crypto, IndexedDB, or parser exceptions.

## Required test-first sequence

### 1. Domain and crypto red tests

- Strict login/note schema acceptance and rejection.
- Bounds for IDs, fields, URI counts/lengths, note size, and timestamps.
- Round-trip item encryption and independent random item keys/nonces.
- AAD substitution tests for vault, item, revision, parent, operation, schema, and purpose.
- Wrong wrapper, truncated/non-canonical data, unknown algorithm/version, and corrupt plaintext schema fail closed.
- Stored serialization contains none of synthetic title, username, password, URI, note body, raw item key, or decrypted JSON marker.

### 2. Repository red tests

- Upgrade an existing database containing only the Task 3 bootstrap without data loss.
- Immutable add/read/list and unique revision rejection.
- Atomic head compare-and-set with two concurrent writers.
- Interrupted/aborted transaction rolls back revision and head together.
- Corrupt/unknown stored records are returned as untrusted input for strict vault parsing, not normalized silently.

### 3. Vault integration red tests

- Create/list/read/update/delete login and note.
- Restart with the same IndexedDB: locked initially, then correct unlock restores current items.
- Wrong password cannot expose item metadata or plaintext.
- Edit/delete stale expected revision returns conflict and preserves the winner.
- Tombstone survives restart and deleted item does not reappear.
- Large note at the accepted bound round-trips; over-bound input fails before encryption/persistence.
- Lock during in-flight CRUD cannot publish a stale unlocked result or leak decrypted state.
- Existing recovery, password change, PRF root unlock, and Task 3 header mutations continue to open items because random root/item keys are not password-derived.
- Migration fixture writes a new immutable revision and preserves the readable old revision on failure.

### 4. UI/application red tests

- Accessible create/edit/delete flows for both types.
- Empty, saving, corruption, conflict, retry, and locked transitions.
- Inputs clear on submit/cancel/lock/unmount.
- Item count and list update only after committed writes.
- Web and extension composition tests use the same client contract.

### 5. Final validation

Run narrow package tests first, then:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

Inspect IndexedDB with synthetic sentinel values and scan generated client artifacts for those sentinels and source maps. Record exact file/test counts and demo evidence in `20-progress.md`.

## Implementation order

1. Record ADR-023 with the accepted item/revision envelope, limits, AAD, repository transaction model, error policy, and Task 5 compatibility.
2. Add failing item schema, encryption, storage-inspection, and migration tests.
3. Implement focused vault item/revision modules using the existing crypto provider.
4. Add failing IndexedDB upgrade/atomicity/concurrency tests, then implement repository version 2.
5. Add the client CRUD contract and lifecycle/concurrency integration tests.
6. Implement shared UI flows and both-surface tests.
7. Run plaintext/artifact inspection and the full validation chain.
8. Update ADRs, progress, project context, known limitations, and demo evidence; only then mark Task 4 complete and move Task 5 to current.

## Decisions to resolve in ADR-023

These are implementation decisions, not blockers to beginning red tests:

- Exact maximum byte lengths for title, username, password, URI, login notes, and secure-note body.
- Whether listing decrypts complete small records or a separately encrypted summary projection. For Task 4 simplicity, decrypting bounded complete records is preferable; a rebuildable encrypted search/index projection belongs to Task 12.
- Whether item-key wrappers live inside each encrypted revision envelope or as an authenticated sibling field. Either choice must bind the wrapper to the same vault/item/revision identity.
- Canonical opaque identifier encoding and collision handling.
- The minimal cleartext routing fields needed for efficient IndexedDB access and Task 5 migration.

## Known non-blocking debt

- `packages/vault/src/service.ts` is large and should not absorb the entire Task 4 domain.
- UI and vault public contracts are structurally duplicated and can drift.
- There is no browser E2E harness or real authenticator PRF matrix yet.
- Crypto-inclusive web/extension chunks trigger size warnings.
- No usable Git metadata is present in this workspace snapshot.

None of these justify weakening the Task 4 security or test gates.
