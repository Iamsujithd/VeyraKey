# Open Questions

These questions affect the focused portfolio v1. Deferred-product questions belong in [`32-future-work.md`](32-future-work.md) and do not block current delivery.

| Question | Decision point | Current direction |
|---|---|---|
| Which Google account/client will be used for Drive integration testing? | Task 6 | Use a dedicated synthetic-data test account and least-privilege `appDataFolder` scope |
| Which browser/OS combinations are claimed for PRF? | Tasks 7/13 | Claim none until a recorded real-platform matrix passes; preserve password/Recovery fallback |
| What exact device ID/HLC representation is used? | Task 5 ADR | Choose a strict opaque device ID and bounded hybrid logical clock before implementation |
| How are unsafe sync conflicts presented? | Task 5 UX | Preserve both versions and require an explicit user choice; no silent winner |
| Which SPA/form patterns are in v1 fixtures? | Task 8 | Cover standard forms plus representative React-style dynamic forms; defer exhaustive shadow DOM |
| Which Bitwarden export version is supported? | Task 11 ADR | Pin one documented fixture/profile and report unsupported fields |
| Is ordinary plaintext export needed? | Post-v1 | No; encrypted archive only in v1 |
| Which HIBP endpoint behavior is accepted? | Task 12 | Prefix-only Pwned Passwords with padding where available; no account monitoring |
| What are the KDF worker and code-splitting decisions? | Task 13 | Decide from representative-device measurements, not assumptions |
| Will extensions be submitted to stores or distributed as build artifacts? | Task 14 | Store submission is optional; claims must match actual signing/review state |
| Is an independent review available? | Task 13/14 | Seek review, but never market the project as externally audited without it |
