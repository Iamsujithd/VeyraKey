# UX and Accessibility

## UX principles

1. Secure defaults with explicit, understandable override.
2. Separate facts, warnings, recommendations, and unsupported states.
3. Progressive disclosure: plain-language summary first, technical evidence available.
4. Never use fear, fake urgency, or dark patterns for identity/security decisions.
5. Preserve user agency for imports, merges, fills, disclosures, exports, and deletion.
6. Do not train users to approve repetitive meaningless prompts; prompts must identify concrete risk/action.

## Core states

Every surface has defined locked, unlocking, unlocked, sensitive-compartment locked, offline, syncing, conflict, provider disconnected, degraded capability, error, and recovery states. Avoid indefinite spinners; expose safe retry/cancel.

## Onboarding

- Explain Google sign-in versus master password.
- Explain BYOS and what providers/server can observe.
- Calibrate Argon2id transparently without exposing confusing parameters by default.
- Require Recovery Kit acknowledgement and a verification step.
- Offer PRF device unlock only after capability detection.
- Warn that loss of all recovery methods is permanent.

## Security language

Use precise labels:

- “Encrypted in your storage,” not “invisible everywhere.”
- “Signature valid,” not automatically “document genuine.”
- “Issuer trusted by [policy],” not universal “trusted.”
- “Selective disclosure; presentations may remain linkable,” not blanket “anonymous.”
- “Relay copy deleted,” not “recipient access revoked.”
- “Official connector unavailable,” not fake/manual official import.

## Autofill

Show account identity and destination domain. Highlight scheme and suspicious IDN/look-alike differences. Avoid automatic high-risk field fill. Keep keyboard navigation fast for normal use. Save/update prompts identify exact origin and changed fields.

## Recovery and destructive actions

Use step-by-step scope confirmation for vault/provider/account deletion, plaintext export, device revocation, and Recovery Kit replacement. Explain what remains in provider versions/backups or recipient copies. Do not use ambiguous “delete everything.”

## Document UX

- Separate original, extracted candidates, confirmed metadata, and derivative copies.
- Show OCR confidence and require confirmation.
- Signature panel separates coverage, cryptographic validity, signer, trust, timestamp, and status freshness.
- Redaction preview marks all retained fields and warns that visual overlays are insufficient until flattened output passes checks.
- Medical/financial defaults communicate stricter policy without stigmatizing content.

## Credential firewall UX

Before consent show:

- Issuer/verifier and evidence of identity.
- Purpose statement.
- Requested and actually released claims.
- Stable identifiers/correlation handles.
- Network/status lookups.
- Trust/status/freshness warnings.
- Lower-disclosure alternatives.

Denial is a first-class action. Avoid revealing claim-match results silently to the verifier.

## Exposure map

Offer views by field/document, recipient/verifier, purpose, time, and expiry. Clearly distinguish user-recorded intent from proof of recipient deletion. Support local correction/annotation without rewriting original share/presentation receipt evidence.

## Accessibility target

WCAG 2.2 AA for core flows:

- Complete keyboard operation and visible focus.
- Semantic labels, landmarks, headings, tables, dialogs, and live regions.
- Screen-reader-friendly secret reveal/copy controls.
- Non-color-only success/warning/failure states.
- Contrast, zoom/reflow, text spacing, reduced motion.
- Accessible QR alternatives: copy/paste/deep link/manual code where protocol permits.
- Countdown/TOTP information not dependent on animation alone.
- Timeouts warn and allow extension where safe.

## Internationalization

- Locale-aware dates/addresses without altering canonical values.
- Unicode-safe display and spoofing defenses.
- Bidirectional-text isolation for identifiers/domains.
- Credential/document language direction support.
- No string concatenation that prevents translation.

## UX testing

Combine automated accessibility checks with keyboard/screen-reader/manual tests. Use synthetic participants/tasks for recovery, conflict resolution, autofill warning, document signature interpretation, and credential consent. Security comprehension is an acceptance criterion, not cosmetic polish.
