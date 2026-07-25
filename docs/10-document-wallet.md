# Document Wallet

## Purpose

Provide a private DigiLocker-like repository for critical files on the same user-controlled BYOS while adding local intelligence, safe sharing, and conservative authenticity evidence.

## Categories

Extensible schemas cover:

- Government identity and residence documents.
- Driving, vehicle, and transport documents.
- Passport, visa, ticket, and travel records.
- Education and professional certificates.
- Employment records.
- Insurance policies and claims.
- Legal agreements and certificates.
- Medical records.
- Financial and tax records.

Medical and financial records default to stricter compartments/policies. Categories help UX and extraction but never alter original bytes.

## Ingestion pipeline

1. Require document-compartment step-up.
2. Enforce file and total-resource limits.
3. Inspect magic bytes/MIME independently of extension.
4. Hash and preserve original bytes.
5. Encrypt in authenticated ordered chunks.
6. Parse/preview in a network-disabled isolated worker/context.
7. Offer local OCR/classification.
8. Ask the user to confirm extracted fields.
9. Store confirmed metadata and indexes encrypted.
10. Synchronize only ciphertext and opaque locators.

## Safe preview

- Disable document JavaScript, forms, embedded files, external links, remote fonts/images, and network access.
- Use a sandboxed origin/context with no access to vault keys beyond the selected decoded output.
- Render static pages/images with strict pixel/resource limits.
- Do not persist plaintext thumbnails.
- Treat extracted text, filenames, and metadata as hostile strings.
- Provide download/open-externally warnings because an external viewer leaves the application trust boundary.

## Local OCR and classification

- Run entirely on device in isolated workers.
- Bundle or explicitly download language models with integrity and consent; do not silently fetch based on document content.
- Extract candidates with confidence and provenance.
- Require confirmation for identifiers, names, dates, categories, and reminders.
- Support encrypted full-text search after confirmation/policy.
- Handle worker cancellation, memory limits, and malformed media.

## Duplicate detection

- Exact duplicate: original cryptographic hash.
- Near duplicate: local perceptual/structural signal used only as a suggestion.
- Never expose cross-user document fingerprints to a central service.
- Do not auto-delete duplicates.

## Expiry and document health

- Confirmed issue/expiry dates and reminder policy.
- Missing/uncertain expiry remains unknown, not inferred as valid.
- Health status may include expiring, expired, duplicate candidate, signature unknown/failed, damaged, or missing expected fields.
- Health is an organizational aid, not legal advice.

## Signature and provenance verification

Adapter-based checks may include PDF CMS/PAdES, XML signatures, trusted QR/source formats, and future credential bindings. Results are decomposed into:

- File bytes covered by signature.
- Cryptographic signature validity.
- Signer certificate identity and chain.
- Trust-anchor policy.
- Timestamp evidence.
- Revocation/status result and freshness.
- Unsupported algorithms/transforms.

Network revocation checks require explicit consent or an approved cached policy. A valid signature proves integrity/authorship under a trust policy, not that every statement is true or currently accepted.

## Redacted derivatives

- User chooses fields/regions to remove.
- Output is flattened so removed text/pixels/metadata are not recoverable.
- Strip metadata and embedded content.
- Add optional recipient, purpose, and expiry watermark.
- Preserve source and derivative hashes and a local derivation receipt.
- Clearly label derivative as user-created, not the issuer's original.

## Exposure map and consent receipts

Encrypted graph edges connect source/derivative, disclosed fields, recipient/verifier, purpose, channel, time, expiry, and share/presentation result. Users can answer which entities received a particular identifier or document. Expiry means intended access ended; it does not prove recipient deletion.

## Travel mode

Travel mode withholds selected compartment key slots from the active device/session and requires a defined recovery path. It must not claim hidden ciphertext is nonexistent or offer a deceptive duress vault. Activation/deactivation is explicit and tested before travel.

## Authenticity UX vocabulary

Use precise states: original preserved, hash matches, signature valid/invalid, signer trusted/untrusted/unknown, status fresh/stale/unavailable, source imported manually/official connector, OCR confirmed/unconfirmed. Avoid a universal “verified document” badge.
