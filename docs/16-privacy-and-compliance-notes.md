# Privacy and Compliance Notes

## Scope

This document captures technical privacy requirements and review prompts. It is not legal advice. Jurisdiction-specific counsel/review may be required before production, especially for identity, government, medical, financial, and child-related data.

## Data minimization

- The control plane stores only account, capability, abuse, and relay-lifecycle data needed to operate.
- Vault content and behavioral history remain encrypted in user storage.
- Telemetry uses allowlisted aggregate fields.
- Imports, OCR, search, classification, password analysis, document parsing, and credential matching run locally.
- Retention schedules exist for account metadata, operational logs, and relay metadata.

## User control

Users can export encrypted data, disconnect BYOS/control-plane identity, revoke devices, delete relay copies, delete local/provider vault data, and understand limits caused by provider versions/backups. Destructive deletion requires clear scope confirmation; server deletion cannot delete user BYOS without an explicit client-side provider operation.

## Transparency

Privacy notices must explain:

- What remains only on the client/BYOS.
- What Google Drive/WebDAV and Cloudflare can observe.
- Google identity versus vault unlock.
- HIBP prefix queries and optional paid API disclosure.
- Secure Send metadata and recipient-copy limitations.
- Credential issuer/verifier/status correlation.
- Crash/operational telemetry.
- Compromised unlocked-device and traffic-analysis limits.

## Identity and credential privacy

- Government credentials should be requested only when necessary.
- Credential firewall shows purpose, requester, requested claims, identifiers, and network activity.
- No silent presentation or background credential probing.
- Status and metadata retrieval is cached/consented to reduce issuer phone-home behavior.
- Exposure history is user-local encrypted data, not centralized analytics.
- SD-JWT selective disclosure is not described as fully unlinkable.
- Trust and truth are not inferred solely from valid signatures.

## Document privacy

- No cloud OCR/AI upload.
- Plaintext previews/thumbnails are not persisted.
- Redaction outputs are tested for recoverable hidden content.
- Medical/financial documents default to stricter compartments.
- External viewers/downloads are marked as leaving the app's trust boundary.

## Third-party services

### Google

Google identity and Drive access have separate purposes/scopes. Request least privilege, provide verified branding/policies, and keep Drive tokens client-side.

### Cloudflare

Cloudflare processes network/account/relay metadata and temporary ciphertext. Data location, retention, subprocessors, and production terms require release review.

### HIBP

Pwned Passwords receives a five-character SHA-1 prefix, not the full password/hash. Exact account APIs are optional and user-supplied/paid.

### WebDAV

The selected provider observes user identity, endpoint access, ciphertext size/timing, and storage names. Use HTTPS and opaque paths; provider terms are the user's/provider's relationship.

### Credential actors

Issuers, verifiers, trust registries, and status providers receive protocol-required information. The wallet minimizes disclosure but cannot control downstream retention.

## India-specific review prompts

Before official DigiLocker/API Setu integration, verify eligibility, consent, scope, data retention/redisclosure, encryption/BYOS storage, incident/audit, localization, and branding obligations. Review applicable Indian data-protection/security requirements for actual deployment. Do not assume official API access from public branding alone.

## Sensitive telemetry prohibition

Never collect passwords, secrets, full hashes, vault/item/document/credential IDs, filenames, OCR, claims, origins visited/autofilled, presentation content, BYOS tokens, transfer keys, or raw parser errors containing user content.

## Privacy review triggers

Any new server endpoint, third-party SDK, analytics/crash service, remote resource fetch, identifier, status mechanism, sharing mode, AI feature, official integration, or policy automation requires documented privacy review and updates to data classification and threat model.
