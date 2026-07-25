# BYOS Sync Protocol

## Objective

Converge encrypted vault state across intermittently connected clients without depending on strong provider transactions or a mutable monolithic vault file.

## Provider contract

A provider adapter exposes capabilities similar to:

- Authenticate/disconnect locally.
- Probe capabilities and quota.
- Put immutable object if absent/idempotently.
- Get object by opaque locator.
- List objects or changes with pagination/cursors.
- Read/write replaceable snapshot candidates as optimizations.
- Delete eligible compacted objects where supported.
- Report retryable, authorization, quota, and corruption errors distinctly.

Provider-specific ETags or versions may optimize writes but are not a correctness requirement.

## Local write path

1. Validate the decrypted domain object.
2. Advance the device hybrid logical clock.
3. Reference current parent revision head(s).
4. Encrypt/authenticate the new immutable revision.
5. Commit ciphertext and pending-upload state atomically to encrypted IndexedDB.
6. Update the local derived view and audit chain.
7. Upload the immutable object idempotently.
8. Publish an encrypted snapshot candidate after required revisions exist remotely.

## Pull and merge path

1. Read provider change feed/listing from the last safe cursor.
2. Download unseen opaque revisions with bounded concurrency.
3. Authenticate envelope and validate decrypted schema.
4. Reject or quarantine corrupt/unknown revisions without discarding valid state.
5. Build the revision DAG and detect missing parents/rollback indications.
6. Apply deterministic merge rules.
7. Create a visible conflict copy when semantic merging is unsafe.
8. Update the local snapshot/cursor only after durable local commit.

## Merge policy

- Identical/replayed revisions are idempotent.
- Causally later revisions replace ancestors.
- Independent edits to merge-safe metadata may merge deterministically.
- Competing secret values, body text, files, credentials, key material, or delete/edit races create conflicts.
- Tie-breaking determines presentation/order only; it must never discard an independent revision.
- Clients converge from the same valid revision set regardless of delivery order.

## Device IDs and clocks

Each enrolled client receives a random device ID stored inside encrypted vault metadata. A hybrid logical clock combines observed time and a logical counter. Wall-clock values are never trusted for authorization or safe deletion.

## Tombstones and compaction

- Deletion creates a tombstone revision.
- Active devices publish encrypted checkpoints.
- Compaction creates a new verified snapshot/compaction marker after all referenced revisions are present.
- Old revisions/tombstones are removed only when the retention policy and every non-revoked device checkpoint make it safe.
- Long-inactive devices require re-bootstrap rather than forcing indefinite retention.
- Interrupted compaction leaves old history valid.

## Google Drive adapter

- Use the least-privilege `drive.appdata` scope.
- Store immutable encrypted objects in `appDataFolder`.
- Use change feeds and file versions for efficient discovery.
- Do not assume `files.update` offers strong compare-and-swap correctness.
- Keep OAuth tokens client-side.
- Handle revoked access, quota, pagination, retries, and duplicate change delivery.

## WebDAV adapter

- Use user-configured HTTPS endpoints and opaque paths.
- Probe methods, ETags, listing behavior, and quota where available.
- Treat inconsistent/missing ETags as normal degraded capability.
- Use extension optional host permission when web CORS prevents access.
- Keep WebDAV credentials/tokens out of the control plane.

## Failure behavior

- Offline: accept local encrypted writes and queue uploads.
- Quota exhausted: stop remote writes, retain local pending state, warn clearly, and offer export/provider cleanup.
- Provider corruption: quarantine corrupt objects and rebuild from valid history.
- Authorization revoked: lock provider sync but not local vault use.
- Missing revisions: preserve partial state and retry; do not invent data.
- Total provider deletion: recover from encrypted export/other provider only; the application server has no backup.

## Required tests

Property/model tests must exercise arbitrary delivery ordering, duplication, retries, stale cursors, clock skew, conflicts, delete/edit races, missing parents, corrupt objects, interrupted compaction, device revocation, and provider-specific inconsistent behavior.
