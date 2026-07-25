# Digital Credential Wallet

## Architecture position

Digital credentials are stored in a format-neutral encrypted envelope. W3C VC, SD-JWT VC, ISO mdoc, signed PDFs/XML, and DigiLocker documents are not converted into one another. Original bytes/tokens remain authoritative evidence; normalized claims exist for safe display, matching, and search.

## Standards tiers

### Production-targeted browser paths

- W3C Verifiable Credentials Data Model 2.0.
- W3C VC JOSE/COSE.
- RFC 9901 SD-JWT.
- Version-pinned SD-JWT VC adapter.
- OpenID4VCI 1.0 issuance.
- OpenID4VP 1.0 presentation.
- DCQL claim queries.
- W3C Bitstring Status List and compatible IETF token-status adapter where required.

### Capability-gated paths

- BBS Data Integrity derived proofs while the profile/implementations mature.
- ISO mdoc parsing/inspection and remote fixtures.
- Digital Credentials API feature detection.
- Native holder registration, proximity, and hardware-backed attestation in future native apps.

## Credential envelope

```text
CredentialEnvelope
├── original bytes/token
├── detected format + exact profile version
├── normalized display claims
├── issuer identifier/key evidence
├── cryptographic verification evidence
├── issuer authorization/trust evidence
├── status result, source, and freshness
├── holder binding/key reference
├── portability/recovery classification
├── cached metadata/context/status references
└── disclosure and consent receipts
```

## Trust decomposition

The wallet reports separately:

1. Parsing/schema result.
2. Cryptographic integrity/authenticity.
3. Issuer identity/key resolution.
4. Issuer authorization to issue this credential type.
5. Current status/freshness.
6. Holder binding.
7. Verifier-request and purpose suitability.

Standards conformance or a valid signature does not make claims objectively true. Trust packs are explicit ecosystem policies with signed/versioned distribution and user-visible provenance.

## Remote resource policy

Credential-controlled URLs create tracking, SSRF, injection, and availability risks.

- Prebundle/hash-pin standard JSON-LD contexts.
- Cache metadata/status only after validation.
- Do not resolve remote holder-binding keys from issuer-controlled references.
- Restrict schemes, redirects, size, MIME, depth, and fetch time.
- Never render issuer HTML or active content.
- Escape and constrain all display strings/data URIs.
- Require consent before a new network lookup that could phone home.

## SD-JWT privacy

RFC 9901 selective disclosure reveals only selected disclosures, but the issuer-signed token and some metadata can remain stable and linkable. The wallet shows credential type, issuer, status identifiers, key binding, and other correlation handles before presentation. It does not label SD-JWT as fully unlinkable zero knowledge.

## OpenID4VCI

Supported flows include authorization code and pre-authorized code, PKCE, DPoP when required, transaction codes, nonce handling, encrypted credential responses, and deferred issuance. Offers are untrusted input. The wallet detects phishing/mix-up/replay and reports when issuers demand wallet or key attestations unavailable to a browser client.

## OpenID4VP and DCQL

- Validate signed/unsigned request policy, verifier identity, origin/client identifier, response URI, state, nonce, and audience.
- Match only required claims and credentials.
- Show purpose and privacy/correlation impact.
- Require user interaction for every response, including denial/error where silent behavior could leak claim matching.
- Bind presentations to verifier and transaction.
- Record encrypted disclosure receipts.

## Credential firewall

Before acquisition or presentation, the firewall displays:

- Who is asking/issuing and how that identity was established.
- Requested credential/claims.
- Why the requester says data is needed.
- Persistent identifiers and correlation handles.
- Network resources/status checks that would occur.
- Trust warnings and lower-disclosure alternatives.
- Whether keys/credentials are recoverable, hardware-bound, or require reissuance.

## Status privacy

Prefer bulk signed status lists over per-credential callbacks. Cache lists, respect signed freshness, detect suspicious unique list URLs/small anonymity sets, bound refresh intervals, and avoid silent timing-correlated requests. A direct fetch still exposes requester IP/timing; document that limitation.

## BBS

BBS can support unlinkable derived proofs, but complexity, JSON-LD/RDF canonicalization, metadata leakage, issuer support, and draft maturity prevent it from being the required v1 path. Enable only after vectors, interoperability, and implementation review pass.

## ISO mdoc and Digital Credentials API

Browser v1 may inspect fixtures and support compatible remote exchange experiments. It cannot claim native mDL proximity, secure-element protection, OS wallet registration, or universal Digital Credentials API holder behavior. Future native apps reuse the credential envelope and protocol interfaces.

## Libraries and conformance

Candidate Apache-2.0 TypeScript building blocks include OpenWallet Foundation SD-JWT, OID4VC, and DCQL packages. Wrap them behind project interfaces, pin exact versions, test official vectors, maintain malicious corpora, and run free OpenID conformance tests where profiles are available.
