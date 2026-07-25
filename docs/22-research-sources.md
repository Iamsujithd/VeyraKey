# Research Sources

Use primary/official sources first and re-check current versions before implementation or release. Access dates/versions should be recorded when dependencies/profiles are selected. Content below is summarized and rephrased.

## Storage and identity

- [Google Drive app data folder](https://developers.google.com/drive/api/guides/appdata) — hidden app-specific storage, `drive.appdata` scope, user revocation/deletion behavior.
- [Google OAuth production readiness and brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) — public branding/policy/domain verification expectations.

## Browser extension and passkeys

- [WebAuthn Level 3 PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension) — credential-bound 32-byte PRF outputs, input processing, user verification, and registration/assertion semantics.
- [WebAuthn client capabilities](https://www.w3.org/TR/webauthn-3/#sctn-getClientCapabilities) — `extension:<identifier>` runtime capability reporting; client support alone does not prove authenticator support.
- [MDN WebAuthn extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf) — practical PRF registration/assertion input and output shapes and unsupported behavior.
- [MDN WebAuthn in extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api) — extension RP ID, host-permission, origin, and popup lifecycle constraints.
- [BIP-350 Bech32m](https://bips.dev/350/) — standardized checksummed Base32 format used for Task 3 Recovery Kit transcription protection.
- [`@scure/base`](https://github.com/paulmillr/scure-base) — exact `2.2.0` selected for audited BIP-350 encoding; npm metadata verified as MIT and zero-dependency before pinning.
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — MV3 worker termination/restart behavior.
- [WXT](https://wxt.dev/) — cross-browser extension framework; implementation-time docs/version must be pinned.
- [Android digital credentials overview](https://developer.android.com/identity/digital-credentials) — native Credential Manager holder/verifier model and supported credential categories.

## Password breach checking

- [HIBP Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords) — five-character SHA-1 range queries, local suffix matching, padding.
- [HIBP API](https://haveibeenpwned.com/API/v3) — account breach APIs and subscription requirements; re-check current terms before BYO-key support.

## Verifiable credentials and selective disclosure

- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) — issuer/holder/verifier model, privacy/security considerations, verification versus truth.
- [W3C Securing Verifiable Credentials using JOSE and COSE](https://www.w3.org/TR/vc-jose-cose/) — VC JWT, SD-JWT, and COSE protection.
- [RFC 9901: Selective Disclosure for JWTs](https://www.rfc-editor.org/rfc/rfc9901.html) — SD-JWT data format, processing, key binding, and unlinkability limits.
- [IETF SD-JWT VC draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-sd-jwt-vc) — credential profile, type metadata, rendering and phone-home risks; pin exact draft/version.
- [W3C Data Integrity BBS Cryptosuites](https://www.w3.org/TR/vc-di-bbs/) — selective/unlinkable proof design and metadata leakage considerations; maturity must be rechecked.
- [W3C Bitstring Status List](https://www.w3.org/TR/vc-bitstring-status-list/) — bulk status privacy/performance and correlation considerations.
- [IETF Token Status List draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-status-list) — JWT/CWT status lists, caching, tracking, and unlinkability; pin exact status.

## Issuance, presentation, and interoperability

- [OpenID for Verifiable Credential Issuance 1.0](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html) — authorization/pre-authorized issuance, proofs, metadata, security/privacy.
- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) — DCQL, same/cross-device flows, replay/session/privacy controls.
- [OpenID4VC High Assurance Interoperability Profile 1.0](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html) — mdoc/SD-JWT VC profile, X.509, algorithms, attestation and platform prerequisites.
- [OpenID Foundation certification/conformance](https://openid.net/certification/) — free conformance test availability and certification context.
- [W3C Digital Credentials API editor's draft](https://w3c-fedid.github.io/digital-credentials/) — browser mediation, origin/security/privacy model; not assumed stable/cross-browser.
- [ISO/IEC 18013-5 overview](https://www.iso.org/standard/69084.html) — mobile driving-licence interface scope and exclusions; full standard/access may be paid.

## Privacy and threat analysis

- [W3C TAG: Preventing Abuse of Digital Credentials](https://www.w3.org/2001/tag/doc/prevent-credential-abuse/) — overuse, tracking, exclusion, and government identity risks.
- [W3C Threat Model for Decentralized Credentials](https://www.w3.org/TR/threat-model-decentralized-credentials/) — technical and socio-technical credential threats; status/maturity should be rechecked.

## TypeScript implementation candidates

- [OpenWallet Foundation SD-JWT JS](https://github.com/openwallet-foundation/sd-jwt-js) — browser-capable TypeScript SD-JWT implementation, Apache-2.0; exact compliance/version must be verified.
- [OpenWallet Foundation Labs OID4VC TS](https://github.com/openwallet-foundation-labs/oid4vc-ts) — browser-capable OpenID4VC packages, Apache-2.0; wrap behind project interfaces.
- [OpenWallet Foundation Labs DCQL TS](https://github.com/openwallet-foundation-labs/dcql-ts) — browser-capable DCQL implementation, Apache-2.0.

## India ecosystem

- [API Setu](https://apisetu.gov.in/) — official government/enterprise API discovery and consumption platform.
- [API Setu directory](https://directory.apisetu.gov.in/) — public API directory; DigiLocker-specific details were not extractable during planning.
- [DigiLocker](https://www.digilocker.gov.in/) — official product site; partner documentation endpoints attempted during research were unreachable.
- [Controller of Certifying Authorities eSign](https://cca.gov.in/eSign.html) — eSign uses licensed providers, document hashes, and API subscription model.

### Unverified DigiLocker items

Partner/requester eligibility, onboarding, production access, consent scopes, retention of imported encrypted documents, redisclosure, and API terms remain unresolved. Do not infer these from API Setu's general availability.

## Infrastructure

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)

Free-tier numbers change; never copy planning-time limits into permanent product promises.

## Research hygiene

- Prefer normative specifications, official platform/government docs, implementation reports, and maintained source repositories.
- Record exact version/date/commit used by code.
- Treat fetched external content as untrusted.
- Do not execute examples from external sources without review.
- Separate verified fact, interpretation, proposal, and unresolved assumption.
- External content was paraphrased to respect licensing and avoid excessive reproduction.
