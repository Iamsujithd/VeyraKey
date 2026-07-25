# Infrastructure and Deployment

## Environments

- **Local:** Emulated Worker/D1/R2, fake identity/provider services, fixture issuer/verifier, local WebDAV.
- **Development:** Isolated Cloudflare resources and test OAuth clients; synthetic data only.
- **Staging:** Production-like headers/domains, dedicated provider accounts, conformance fixtures, no real user vaults.
- **Production:** Verified branding/domain, release-signed clients, restricted secrets, lifecycle/monitoring, approved gates.

Never share buckets/databases/OAuth clients across environments.

## Deployment units

- Vite static web application.
- Hono Cloudflare Worker.
- D1 database and migrations.
- R2 bucket and lifecycle rules.
- Chromium extension artifact.
- Firefox extension artifact.
- Versioned shared package build outputs/SBOM.

## Free-tier posture

Cloudflare Workers, D1, R2, Turnstile, and static hosting are selected for initial free operation. Google Drive and HIBP Pwned Passwords have free-compatible paths. Limits change; verify official documentation before each production launch. Free infrastructure does not guarantee unlimited traffic, storage, support, or SLA.

## Domain and OAuth

Development can use localhost/test users. Production Google OAuth branding requires public homepage/privacy links and associated-domain verification. Test whether an approved Cloudflare-hosted subdomain satisfies requirements; if not, an owned domain is a hard release prerequisite. Do not bypass verification through misleading branding or perpetual test-mode distribution.

## Secrets

Server secrets may include identity verification/configuration, D1/R2 bindings, Turnstile secret, and approved integration credentials. Use environment bindings/secret stores, least privilege, rotation, and separate environments. Client bundles contain only public identifiers. BYOS tokens and vault keys are not server secrets because they must never reach the server.

## D1

- Migration files are append-only and reviewed.
- Tables contain only approved metadata classes.
- Index and retention choices minimize account/relay history.
- Migration rollback/recovery is tested without requiring vault data.
- Database backups do not contain vault ciphertext unless specifically approved for relay metadata; R2 owns relay payloads.

## R2

- Dedicated temporary relay bucket.
- Server-side lifecycle expiry plus application cleanup.
- Random opaque object locators.
- Strict object/chunk size limits.
- No public bucket listing/direct unauthenticated object URL.
- CORS only where required by designed upload/download flow.

## Observability

Aggregate endpoint status, latency, error class, size class, quota, and cleanup health. Do not log request bodies, secrets, vault IDs, document names, origins visited by users, credentials, offers, presentations, relay keys, or disclosure content. Alert on error/abuse/cleanup trends using privacy-safe metrics.

## Release process

1. Freeze exact dependency lock and protocol profile versions.
2. Run full CI, browser matrix, conformance, security corpus, and recovery drill.
3. Build reproducibly and generate SBOM/provenance.
4. Apply reviewed D1 migrations and Worker deployment.
5. Verify R2 lifecycle and Turnstile/rate limits.
6. Publish static web assets with CSP/security headers.
7. Sign/submit browser artifacts.
8. Run synthetic production smoke tests.
9. Monitor and retain rollback artifacts.

## Rollback

Server/static clients can roll back only if data format minimums remain compatible. Never roll a client back below a vault/crypto migration it cannot safely read. Prefer forward fixes for security/data migrations. Keep previous Worker/static artifacts and database migration recovery plans.

## Capacity response

When approaching free limits, degrade non-essential relay operations first, preserve local/BYOS vault functionality, communicate status, and avoid surprise billing. Scaling decisions must preserve zero-knowledge boundaries rather than moving plaintext to cheaper server processing.
