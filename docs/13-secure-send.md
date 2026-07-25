# Secure Send

## Model

Secure Send transfers a temporary encrypted snapshot. It does not create a persistent shared vault, shared source of truth, or revocable live permission relationship. The recipient imports a new copy into their own vault/BYOS.

## Cryptographic flow

1. Sender selects fields/items/files and sees an exact preview.
2. Client serializes a versioned transfer package.
3. Client generates an independent random transfer key.
4. Client encrypts/authenticates the package and chunks large payloads.
5. Client uploads only ciphertext to R2 through the Worker.
6. Server returns an opaque relay ID and deletion capability.
7. Client forms a URL whose fragment contains the transfer key, or sends the key out-of-band.
8. Browser fragments are never sent in HTTP requests.
9. Recipient downloads ciphertext, decrypts locally, previews, and explicitly imports.
10. TTL/deletion removes the relay copy; recipient copies remain independent.

## Package contents

- Format and crypto version.
- Sender-chosen item snapshot/fields.
- Attachment/document chunks.
- Optional sender display label that is included inside ciphertext.
- Intended expiry/purpose/recipient note inside ciphertext.
- Integrity and anti-splicing metadata.

Do not include sender account IDs or vault IDs unless essential and explicitly approved.

## Server metadata

D1 may retain relay ID, opaque R2 locator, size class, created/expiry time, one-time state, and deletion-token hash. R2 stores ciphertext. The server must not receive the transfer key in path, query, header, body, telemetry, Referer, or logs.

## Modes

- Time-limited reusable download.
- Best-effort one-time download using an atomic server state transition.
- Explicit sender deletion using a deletion capability.

“One time” means the relay serves a successful download once; it cannot prevent recipient copying, races outside the service guarantee, browser caching, screenshots, or downstream redistribution.

## Abuse and limits

- Strict encrypted payload and chunk limits.
- TTL maximum/minimum.
- Rate limits and Turnstile for suspicious/anonymous creation.
- No arbitrary URL fetching or server-side content inspection.
- Generic errors that do not expose relay existence unnecessarily.
- Automatic lifecycle cleanup.

## Recipient safety

- Treat decrypted package fields/files as untrusted.
- Preview metadata and source claims before import.
- Run file/document safety checks locally.
- Never auto-merge or auto-execute content.
- Show that sender identity is unverified unless separately authenticated.

## Exposure history

Sender records an encrypted share receipt with selected fields/items, purpose, intended recipient label, relay mode, expiry, and deletion result. Recipient records import provenance locally. Server telemetry is not the exposure ledger.

## Required tests

- Wrong/truncated/tampered key and ciphertext.
- Chunk omission/reordering/splicing.
- URL fragment absence from server logs.
- TTL boundary and cleanup.
- One-time concurrent download race.
- Deletion-token authorization.
- R2/D1 partial failure and retry.
- Oversize/abuse/rate-limit paths.
- Recipient malicious-content handling.
