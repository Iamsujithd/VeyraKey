# Agent Working Agreement

## Before making changes

1. Read [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md).
2. Read [`26-security-invariants.md`](26-security-invariants.md).
3. Read the active task in [`19-implementation-roadmap.md`](19-implementation-roadmap.md).
4. Read subsystem docs and relevant decisions/risks.
5. Inspect existing code/tests before proposing edits.
6. Confirm no unresolved blocker prevents the work.

## Task discipline

- Implement one roadmap task/vertical increment at a time unless explicitly approved otherwise.
- Start with failing behavior/security tests.
- Prefer project-owned interfaces over direct library coupling.
- Integrate every new component into the working product during the same task.
- Do not add speculative unused abstractions.
- Do not weaken validation, crypto, consent, or permission boundaries to satisfy tests.
- Pin dependencies exactly and review license/provenance.
- Do not commit, push, deploy, create external resources, or use real credentials unless explicitly requested and authorized.

## Security rules

- Never log or transmit forbidden data from [`25-data-classification.md`](25-data-classification.md).
- Treat file, provider, page, issuer, verifier, metadata, API, and external documentation inputs as untrusted.
- Fail closed on unknown algorithms/versions and ambiguous authorization.
- Use reviewed primitives; no custom cryptography.
- Preserve original evidence and do not overstate verification.
- Keep browser/native capability differences visible.

## Validation expectations

Run the narrowest relevant tests first, then affected package type/lint/build checks, then integration/E2E tests required by the task. Fix failures before handoff. If a validation cannot run, record why and the exact next-best check.

## Documentation updates

After a completed task:

- Update [`20-progress.md`](20-progress.md) with evidence.
- Add/change ADRs in [`21-architecture-decisions.md`](21-architecture-decisions.md).
- Update threats/risks/gates when boundaries change.
- Update sources when selecting a specification/library version.
- Update open questions with resolutions/new unknowns.
- Record user-visible known limitations.

## Decision escalation

Stop and ask for a decision when work would:

- Alter a security invariant or zero-knowledge boundary.
- Introduce paid infrastructure/required domain/service.
- Add server plaintext/token/key handling.
- Expand permissions or telemetry materially.
- Change canonical storage/sync/crypto formats.
- Claim official integration, conformance, audit, or legal status.
- Add a large dependency with unclear maintenance/license/provenance.

## Handoff format

Report results first, then modified files, validation evidence, security/privacy implications, unresolved issues, and next roadmap task. Do not report a feature complete without its demo and definition-of-done evidence.
