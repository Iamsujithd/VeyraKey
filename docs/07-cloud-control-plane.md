# Cloud Control Plane

## Purpose

The Cloudflare control plane supports account identity, capabilities, abuse prevention, and temporary encrypted transfer. It is not the vault database, key service, OCR service, credential repository, or recovery authority.

## Components

- **Hono Worker:** HTTP API and authentication boundary.
- **D1:** Minimal account, rate-limit, capability, relay-lifecycle, and operational metadata.
- **R2:** Temporary opaque Secure Send ciphertext.
- **Turnstile:** Abuse controls on unauthenticated/high-cost relay actions.
- **Static web hosting:** Public application, policy pages, and OAuth branding pages.

## Permitted server data

- Pseudonymous internal account ID and verified identity-provider subject.
- Account creation/status and accepted policy version.
- Public client capability/version data.
- Rate-limit counters and abuse signals.
- Relay object locator, size class, creation/expiry, one-time state, and deletion-token hash.
- Aggregate operational metrics that contain no vault identifiers or user content.

## Forbidden server data

- Master password or password-derived verifier.
- Recovery Kit or WebAuthn PRF output.
- Vault, compartment, item, attachment, document, credential, transfer, or holder private keys.
- Decrypted vault content, filenames, URLs, claims, OCR, disclosure history, or search terms.
- Google Drive refresh/access tokens or WebDAV credentials.
- Secure Send decryption secrets.
- Raw credential offers/presentations except opaque encrypted relay content explicitly chosen by the user.

## Authentication boundary

Google account authentication establishes an application account and permits control-plane operations. It does not unlock the vault. Identity tokens are validated for issuer, audience, signature, expiry, and replay-sensitive state. Browser OAuth uses PKCE where applicable. A control-plane outage must not prevent local unlock or local/BYOS operations that do not require the relay.

## API capability groups

- Health/version/capability discovery.
- Account session establishment and logout.
- Public configuration and minimum-supported versions.
- Secure Send create/upload/finalize/download/delete metadata operations.
- Abuse challenge verification and rate limiting.
- Optional future public status-list cache only after privacy/security design approval.

Exact endpoint contracts belong in the implementation API schema and must follow [`27-api-and-module-boundaries.md`](27-api-and-module-boundaries.md).

## Secure Send server behavior

- Accept ciphertext with strict size/type-independent limits.
- Never receive the decryption secret in path, query, header, or body.
- Return an opaque relay ID and deletion capability.
- Enforce expiry and best-effort one-time state atomically.
- Delete R2 object and D1 lifecycle metadata after expiry/deletion.
- State clearly that one-time download cannot prevent client copying or simultaneous races without a durable state transition.

## Logging and observability

- Structured allowlisted fields only.
- No request/response bodies for sensitive routes.
- Redact authorization headers, cookies, URL fragments, tokens, relay deletion capabilities, and upstream errors.
- Use coarse endpoint/status/latency/size-class metrics.
- Sample only explicitly safe errors.
- Keep retention minimal and documented.

## Availability and limits

Free Workers, D1, and R2 tiers have quotas and no production SLA. Clients must handle 429, 5xx, network timeout, relay unavailability, and capability downgrade without risking vault integrity. Recheck current limits before release rather than encoding planning-time numbers as permanent assumptions.

## Security controls

- Strict request schemas and response types.
- Authenticated account routes and capability-based relay deletion.
- Turnstile/rate limits for abuse-prone actions.
- CORS allowlist and secure headers.
- D1 parameterization and migration tests.
- R2 lifecycle policies and object-size limits.
- SSRF avoidance: the control plane does not fetch arbitrary user URLs.
- No secret values in static web assets other than public OAuth client identifiers.
