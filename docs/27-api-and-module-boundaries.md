# API and Module Boundaries

## Proposed monorepo shape

Names are architectural guidance; Task 1 may refine them without changing boundaries.

```text
apps/
├── web/                 React/Vite client
├── extension/           WXT Chromium/Firefox extension
└── api/                 Hono Cloudflare Worker
packages/
├── contracts/           versioned safe schemas and API types
├── crypto/              crypto envelopes/key hierarchy interfaces
├── vault/               domain items/revisions/migrations
├── persistence/         encrypted IndexedDB repositories
├── sync/                provider-neutral revision engine
├── provider-drive/      Google Drive adapter
├── provider-webdav/     WebDAV adapter
├── documents/           ingest, safe preview, OCR abstractions
├── credentials/         envelope, formats, trust, status, protocols
├── import-export/       migration adapters/archive
├── security/            password analysis, origin policies
├── ui/                  accessible shared components/tokens
└── test-fixtures/       synthetic providers, sites, issuers, documents
```

## Dependency direction

- `contracts` contains data-only schemas and no app/runtime dependency.
- `crypto` does not depend on UI, providers, API, or domain-specific rendering.
- `vault` depends on contracts/crypto interfaces, not concrete BYOS/network implementations.
- `sync` depends on vault/contracts and a provider interface.
- Provider adapters depend inward on sync contracts; core never imports provider SDK details.
- Documents/credentials depend on vault/crypto through interfaces and expose sanitized evidence models.
- Apps compose packages; packages do not import apps.
- API cannot import client decryption/key-handling modules.

CI enforces boundaries.

## Project-owned interfaces

### Crypto provider

Random bytes, KDF, HKDF, AEAD, key wrap, hash, signature verify/sign as approved. Algorithms/versions are explicit. Domain code never calls a third-party crypto package directly.

### Sync provider

Authenticate, capabilities, immutable put/get/list/change cursor, snapshot candidate, delete eligible object, quota/error classification. No decrypted domain values.

### Credential format adapter

Detect, parse safely, normalize display, verify cryptographic integrity, enumerate disclosures/correlation data, create presentation where supported, preserve original. Trust/status/purpose are separate services.

### Trust resolver

Resolve issuer identity/key evidence and authorization under a named/versioned trust policy. No universal boolean trust API.

### Status resolver

Fetch/cache/verify status resources under strict URL/privacy policy and return result plus source/freshness/evidence.

### Document verifier

Inspect immutable original bytes and return decomposed signature/provenance evidence. Does not mutate source or produce a universal verified flag.

### OCR/classification worker

Accept bounded bytes/bitmap through an isolated channel, make no network calls, return untrusted candidates/confidence/provenance, support cancellation.

## Control-plane API rules

- Versioned `/v1`-style routes and shared request/response schemas.
- Explicit field allowlists; reject unknown input on sensitive routes.
- Separate account session from vault state.
- No generic proxy/fetch endpoint.
- No endpoint accepts passwords, vault headers, key slots, BYOS tokens, plaintext items, documents, or credentials.
- Relay upload/download operates on opaque bounded ciphertext.
- Stable machine error codes plus non-sensitive messages.

## Browser message rules

- Discriminated/versioned message schemas.
- Per-operation nonce/request ID and timeout.
- Sender context validation.
- Minimum payload disclosure.
- No raw exceptions/stack/content returned to page.
- MAIN-world bridge supports only explicitly approved WebAuthn operations.

## Adapter versioning

Every provider/format/protocol implementation reports adapter version, supported exact profile versions, algorithms, capabilities, and migration needs. Capability negotiation is data-driven and user-visible.

## Avoided coupling

- No global singleton containing unwrapped keys.
- No React component performing crypto/network parsing directly.
- No server SDK imported into client core.
- No provider-specific file ID in domain item schema.
- No credential-library-specific object persisted as canonical data without original bytes/version.
- No parser output rendered without normalization/escaping.
