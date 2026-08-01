# Future Work Outside Portfolio V1

This file preserves useful expansion ideas without treating them as committed v1 deliverables. They may be reconsidered after the focused 14-task release is complete.

## Optional near-term stretch features

- **Secure Send:** Temporarily relay client-encrypted item snapshots with an out-of-band key.
- **SSH key vault:** Generate, import, inspect, and gated-export SSH keys.
- **Basic document storage:** Encrypt original files, preserve hashes, safely preview bounded images/PDFs, and remind about expiry.
- **WebDAV:** Add a second provider through the existing provider-neutral sync contract.

Only one or two should be selected for a portfolio extension.

## Larger product expansions

### Additional password-manager data

- Attachments, custom fields, protected payment-field AutoFill, broader importer catalog, plaintext
  export, continuous scheduled breach monitoring, and paid HIBP-key support. Encrypted cards,
  identities, addresses, and automatic-on-save k-anonymous breach checks shipped in extension
  0.10.0.

### Software passkeys

- Native credential-provider targets, synced passkey credentials, RP/origin/challenge validation,
  signature counters, secure native key storage, browser/platform registration, and native
  fallback. See [`36-enterprise-password-manager-status.md`](36-enterprise-password-manager-status.md).

### Document intelligence

- Local OCR, classification, duplicate detection, search, signature/provenance inspection, irreversible redaction, watermarking, consent receipts, exposure mapping, and travel mode.

### Digital credentials

- Format-neutral credential envelopes, VC 2.0/JOSE/COSE, RFC 9901 SD-JWT, pinned SD-JWT VC, trust packs, status, OpenID4VCI, OpenID4VP, DCQL, BBS, mdoc, and Digital Credentials API.

### DigiLocker/API Setu

- An authorized official connector only after eligibility, documentation, sandbox credentials, consent, retention, and branding terms are verified. Scraping and collection of DigiLocker passwords remain prohibited.

### Broader infrastructure

- WebDAV interoperability, Secure Send R2 relay, richer account/capability control plane, continuous monitoring, and additional deployment targets.

## Permanent non-goals unless the product strategy changes

- Server-held vault decryption keys or recovery escrow.
- Native SSH agent or browser SSH terminal.
- Persistent live shared vaults.
- DigiLocker scraping.
- Cloud OCR/AI processing of private vault content.
- Claims of guaranteed JavaScript memory erasure or unearned audit/conformance status.
