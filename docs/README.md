# Documentation Index

This directory is the approved design and delivery context for the focused zero-knowledge password-manager portfolio v1. Feature implementation is complete through Roadmap Task 13; Task 14 release evidence is in review with external gates explicitly open.

The authoritative v1 scope is defined by `00`, `01`, `17`–`21`, `29`, and `30`. Earlier subsystem documents for documents, digital credentials, DigiLocker, Secure Send, WebDAV, software passkeys, SSH, payments, and other broad capabilities are retained as future-design research; they are not current v1 commitments. See [`32-future-work.md`](32-future-work.md).

## Product and architecture

1. [`00-project-overview.md`](00-project-overview.md) — mission, users, value, and scope.
2. [`01-product-requirements.md`](01-product-requirements.md) — functional and non-functional requirements.
3. [`02-system-architecture.md`](02-system-architecture.md) — system components and trust boundaries.
4. [`03-trust-and-threat-model.md`](03-trust-and-threat-model.md) — assets, adversaries, threats, and mitigations.
5. [`04-cryptography-and-key-management.md`](04-cryptography-and-key-management.md) — algorithms, key hierarchy, recovery, and rotation.
6. [`05-vault-data-model.md`](05-vault-data-model.md) — records, revisions, manifests, and schema evolution.
7. [`06-byos-sync-protocol.md`](06-byos-sync-protocol.md) — convergence and provider contracts.
8. [`07-cloud-control-plane.md`](07-cloud-control-plane.md) — zero-knowledge server responsibilities.
9. [`08-browser-extension-architecture.md`](08-browser-extension-architecture.md) — MV3 processes, permissions, and autofill boundaries.

## Future capability research

10. [`09-password-security-features.md`](09-password-security-features.md) — partly in focused v1.
11. [`10-document-wallet.md`](10-document-wallet.md) — deferred research.
12. [`11-digital-credential-wallet.md`](11-digital-credential-wallet.md) — deferred research.
13. [`12-digilocker-integration.md`](12-digilocker-integration.md) — deferred research.
14. [`13-secure-send.md`](13-secure-send.md) — optional stretch research.

## Engineering and operations

15. [`14-testing-and-quality-strategy.md`](14-testing-and-quality-strategy.md)
16. [`15-infrastructure-and-deployment.md`](15-infrastructure-and-deployment.md)
17. [`16-privacy-and-compliance-notes.md`](16-privacy-and-compliance-notes.md)
18. [`17-constraints-and-non-goals.md`](17-constraints-and-non-goals.md)
19. [`18-risks-and-release-gates.md`](18-risks-and-release-gates.md)
20. [`19-implementation-roadmap.md`](19-implementation-roadmap.md)
21. [`20-progress.md`](20-progress.md)
22. [`21-architecture-decisions.md`](21-architecture-decisions.md)
23. [`22-research-sources.md`](22-research-sources.md)
24. [`23-glossary.md`](23-glossary.md)
25. [`24-agent-working-agreement.md`](24-agent-working-agreement.md)
26. [`25-data-classification.md`](25-data-classification.md)
27. [`26-security-invariants.md`](26-security-invariants.md)
28. [`27-api-and-module-boundaries.md`](27-api-and-module-boundaries.md)
29. [`28-ux-and-accessibility.md`](28-ux-and-accessibility.md)
30. [`29-open-questions.md`](29-open-questions.md)
31. [`30-definition-of-done.md`](30-definition-of-done.md)
32. [`31-task-4-continuation-brief.md`](31-task-4-continuation-brief.md) — implementation-ready scope, seams, tests, and handoff plan for encrypted login/note CRUD.
33. [`32-future-work.md`](32-future-work.md) — deferred expansion ideas outside the focused portfolio v1.
34. [`33-v1-release-runbook.md`](33-v1-release-runbook.md) — reproducible validation, smoke, migration, rollback, and external gates.
35. [`34-hardening-evidence.md`](34-hardening-evidence.md) — security, resilience, accessibility, performance, and dependency evidence.

## Source of truth hierarchy

If documents conflict, use this order:

1. [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) and security invariants.
2. Approved product requirements and architecture decisions.
3. Relevant subsystem architecture.
4. Implementation roadmap.
5. Progress tracker and task-specific notes.

Any intentional change to a higher-level decision must be recorded as a new architecture decision and reflected in all affected documents.
