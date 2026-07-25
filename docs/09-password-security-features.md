# Password and Security Features

## Vault item types

### Logins

Fields include one or more usernames, password, login origins/URLs, related-domain policy, notes, TOTP link, password history metadata, autofill policy, and custom fields. Password history values remain encrypted and retention is bounded.

### Secure notes

Structured or plain sensitive text with attachments, tags, favorite state, and optional step-up policy.

### TOTP

Issuer/account labels, encrypted secret, algorithm, digits, period, optional linked login, and import provenance. Display QR content as sensitive; do not include it in telemetry/screenshots.

### Cards, identities, and addresses

Reusable typed fields with locale-aware forms. Card-number checksum checks identify likely input errors but never claim account validity. Sensitive payment/identity fills require explicit user action.

### Attachments

Chunked encrypted objects linked to an item. Preview policy follows document-safety rules where applicable.

### Software passkeys

RP ID, credential ID, public key, encrypted private key, algorithm, counter/metadata, user handle, display data, and portability classification.

### SSH keys

Public/private key material, fingerprint, type, comment, import/generation provenance, and export history. Native SSH agent behavior is deferred.

## Password generation

- Use platform CSPRNG only.
- Support length, character groups, minimum counts, exclusions, ambiguous-character policy, and site-specific constraints.
- Support passphrases from a reviewed bundled wordlist with clear entropy calculation.
- Avoid modulo bias and misleading strength claims.
- Generated values remain transient until copied/filled/saved.

## Autofill and capture

- Default to exact approved origin matching.
- Explain related-domain matches and require explicit policy.
- Detect login, signup, password-change, TOTP, card, and identity forms conservatively.
- Never fill hidden fields or cross-origin frames silently.
- Show destination origin and fields before high-risk fill.
- Save/update prompts distinguish new credential, changed password, username change, and duplicate.

## TOTP

- Follow RFC 6238-compatible behavior and tested algorithms.
- Display countdown and adjacent-window behavior without silently accepting insecure drift.
- Autofill only into the active approved origin and field.
- Clipboard copies receive best-effort timeout clearing with an honest unsupported-platform message.

## Security dashboard

### Local checks

- Weak password estimation.
- Exact password reuse and related-account grouping.
- Old/unchanged password based on local history metadata.
- Rotation reminders configured by user/site policy—not universal forced rotation.
- Missing or inactive stored TOTP suggestions marked as heuristics.
- Unsecured HTTP origins and suspicious related-domain mappings.

### Pwned Passwords

- Compute SHA-1 locally only because the HIBP range protocol requires it.
- Send only the first five uppercase hash characters.
- Request response padding where supported.
- Compare suffixes/counts locally.
- Never store/send full SHA-1, password, or reusable lookup mapping in logs.
- Cache carefully because a prefix response contains breach information about many suffixes.

### Account breach lookup

Exact email/account breach queries are not free under the approved model. Provide a manual link to HIBP. Advanced users may supply a paid API key stored encrypted in the vault; make third-party disclosure and cost clear.

## Import

Adapters support Apple Passwords, Chrome, Bitwarden, 1Password, and generic CSV exports. Every import provides:

- File-only local parsing.
- Dry-run counts and field-loss warnings.
- Formula/control-character-safe display.
- Duplicate candidates and merge choices.
- All-or-nothing rollback boundary.
- Unsupported field report.
- No promise to import passkeys/TOTP when source export lacks them.

## Export

- Default encrypted portable archive includes format/version, key wrapping, records, chunks, and integrity manifest.
- Plaintext export requires step-up, a destination warning, explicit confirmation, and encrypted audit event.
- Never upload exports to the application server.
- Temporary export buffers are minimized and revoked promptly.

## Audit events

Record create/update/delete, autofill, copy where appropriate, export, import, share, device, recovery, and credential disclosure events. Audit content is encrypted and privacy-minimized; it must not become a detailed server activity feed.
