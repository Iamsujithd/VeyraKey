# Definition of Done

## Per roadmap task

A task is complete only when all applicable conditions hold.

### Objective and integration

- The stated objective works through a real application surface.
- New code is wired into the existing vertical flow.
- Scope matches the focused 14-task roadmap and does not pull future work into v1.
- Capability and unsupported states are accurate.

### Tests and validation

- Failing tests precede or accompany behavior.
- Relevant unit, vector, property, integration, browser, accessibility, performance, fuzz, and chaos tests pass.
- Typecheck, lint, affected builds, and retained security regressions pass.
- Commands and evidence are recorded in [`20-progress.md`](20-progress.md).

### Security, data, and privacy

- Applicable [`26-security-invariants.md`](26-security-invariants.md) remain true.
- Persistent sensitive data is authenticated ciphertext.
- Unknown/corrupt/unsupported inputs fail closed.
- Schemas and migrations are versioned, strict, tested, and recoverable.
- Permissions, scopes, network calls, and logs remain minimal.
- Dependencies are exactly pinned and isolated behind project boundaries.

### UX and documentation

- Locked, offline, loading, error, cancel, retry, conflict, and unsupported states exist where relevant.
- Core workflows are keyboard and screen-reader accessible.
- Security language is precise.
- ADRs, risks, progress, limitations, and demo evidence are updated.

## Portfolio v1 release definition

Using clean browser profiles and synthetic data, the release must demonstrate:

1. Create a vault and complete the Recovery Kit drill.
2. Lock, unlock, change the password, revoke a device, and demonstrate PRF fallback.
3. Create, edit, delete, restart, and recover login and secure-note revisions.
4. Make offline edits on two simulated devices and converge without silent data loss.
5. Synchronize and recover two browser profiles through Google Drive.
6. Preserve a conflicting edit as a visible conflict copy.
7. Demonstrate an authorized extension session surviving worker restart and locking on browser restart/timeout.
8. Save, update, and autofill a login on fixture sites while refusing look-alike, HTTP, and unsafe-frame cases.
9. Generate a password/passphrase, store TOTP, fill a current code, and clear the clipboard best effort.
10. Organize items with tags/favorites/folders and rebuild encrypted search.
11. Preview and import CSV/Bitwarden fixtures with duplicate warnings and rollback.
12. Export an encrypted archive and restore it on a clean profile.
13. Detect weak, reused, and fixture-compromised passwords through local/HIBP-safe analysis.
14. Pass the final security, accessibility, performance, offline, provider-failure, and production smoke suites.

## Release validation

- Full CI and supported-browser matrix pass.
- Sync model/property and provider-chaos suites pass.
- Hostile-origin/frame/message fixtures pass.
- No unresolved critical/high security findings; accepted lower findings are documented.
- Google OAuth/domain configuration is valid for the intended local or published distribution and is recorded as external evidence before a public-release claim.
- Reproducible web and extension artifacts, SBOM, dependency lock, migration plan, and rollback plan exist.
- Privacy notices accurately explain zero knowledge, Google Drive metadata, HIBP requests, endpoint compromise, and best-effort memory/clipboard clearing.
- Independent review is required before claiming an external audit, not before honestly publishing a portfolio demonstration.

## Documentation consistency

- Root `PROJECT_CONTEXT.md` exists.
- `docs/README.md` indexes the documentation set.
- The 14-task roadmap and progress table align.
- Deferred work is clearly separated in [`32-future-work.md`](32-future-work.md).
- Progress, tests, and product claims reflect actual implementation.
