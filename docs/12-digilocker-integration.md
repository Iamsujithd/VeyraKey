# DigiLocker Integration

## Product decision

The project supports both:

1. A fully independent, zero-knowledge DigiLocker-like private document wallet on user BYOS.
2. An optional official DigiLocker/API Setu connector when authorized access and retention rules are verified.

The private wallet is not blocked by the official connector.

## Current verification status

API Setu is verified as an official platform for discovering and consuming government/enterprise APIs. Publicly accessible material reviewed during planning did not establish DigiLocker-specific requester eligibility, onboarding, production credentials, scopes, consent details, or whether a third-party app may retain imported documents as encrypted ciphertext. Official partner pages/specification links were unreachable during research.

Therefore the production connector remains a release-gated capability, not an assumed API.

## Prohibited approaches

- Screen scraping or browser automation against private DigiLocker pages.
- Asking users for DigiLocker passwords, OTPs, or reusable authentication credentials.
- Calling undocumented/private endpoints.
- Misrepresenting manual uploads as official DigiLocker retrieval.
- Converting retrieved PDFs/XML into W3C credentials without issuer-backed proof.
- Retaining or redistributing documents beyond official terms/consent.

## Connector abstraction

A government-document-source adapter should expose:

- Capability/availability and environment.
- Authorized OAuth/consent initiation.
- Callback/token handling entirely within approved boundaries.
- Document listing with minimal metadata.
- Explicit user-selected retrieval.
- Original byte/media/signature preservation.
- Source receipt/provenance capture.
- Token revocation/disconnect.
- Clear retention/deletion semantics.

DigiLocker tokens remain client-side/encrypted unless official architecture explicitly requires a backend and the zero-knowledge/privacy review approves it.

## Required verification before production work

- Official partner/requester eligibility for this product/operator.
- Sandbox and production onboarding process.
- Approved redirect/domain/application requirements.
- User-consent UX and permitted scopes.
- Token storage and backend/client requirements.
- Whether local/BYOS encrypted retention is allowed.
- Permitted document categories, caching, and redisclosure.
- Branding and attribution requirements.
- Security incident, audit, and compliance obligations.
- Rate limits, SLA, error semantics, and revocation.

## Integration behavior

- Display manual uploads and official imports distinctly.
- Preserve original bytes and signatures.
- Store connector provenance/receipt encrypted.
- Detect duplicates without deleting either source automatically.
- Disconnect/revoke provider authorization independently of deleting imported user-held copies, subject to official rules.
- Never claim official freshness after a stored document's retrieval time unless revalidated.

## Signature and QR verification

Existing signed PDF/XML/QR evidence may be inspected locally through document-verification adapters. Results must distinguish signature validity, certificate trust, timestamp/status freshness, and official source provenance. The product does not issue CCA eSign signatures in free v1; CCA describes eSign as an API subscription service.

## Test strategy before official access

Use synthetic/sanitized contract fixtures and a mock adapter to validate UI and zero-knowledge boundaries. The production feature remains disabled unless approved configuration and release-gate evidence exist. Mock success must never be presented as proof of real DigiLocker interoperability.

## Open actions

Track unresolved items in [`29-open-questions.md`](29-open-questions.md) and production blockers in [`18-risks-and-release-gates.md`](18-risks-and-release-gates.md). Re-run legal/privacy/security review when official materials become available; this document is technical planning, not legal advice.
