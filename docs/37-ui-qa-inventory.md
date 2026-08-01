# Extension 0.10.0 UI QA inventory

This inventory is the coverage contract for the functional and visual sign-off. Synthetic data is
used throughout.

| Claim / control | Functional check | Visual state | Evidence |
| --- | --- | --- | --- |
| Unmatched pages stay quiet | Focus username/password with no exact-origin record; no “check vault” choice appears | Field at rest and focused | DOM snapshot + screenshot |
| Matching pages show usernames | Focus a credential field with one and multiple exact-origin records | Compact anchored list | DOM snapshot + screenshot |
| Credential release is protected | Choose one username; verify protected biometric/password handoff precedes fill | Inline picker then protected extension page | Runtime smoke + manual hardware gate |
| Capture is explicit | Submit a synthetic new/changed credential and choose Save/Update or Not Now | Compact save prompt that remains interactive | Component/integration test + browser fixture |
| Strong password is signup-only | Focus `new-password` on registration, then `current-password` on login | Readable strong-password row only on registration | Unit/integration test + browser fixture |
| Generated shape is readable/adaptive | Generate unconstrained and constrained samples | Grouped 6-6-6 default and compatible constrained output | Generator tests |
| Manager is separate and readable | Open Passwords; search, switch All/Security/Cloud, add/cancel/edit | Opaque library with focused progressive sheet | Desktop/mobile screenshots |
| Lock control is concise | Use manager header Lock action | Small header action without a large footer button or green status pill | DOM snapshot + screenshot |
| Identity and payment records are progressive | Add identity/payment card and expand optional fields only on demand | Focused editor, no giant always-open form | Component test + screenshots |
| Breach state is automatic and manual | Save/update/capture/import login; retry from Security | Bounded found/not-found/unavailable status | Unit/integration tests |
| Cloud/local setup is understandable | Compare recommended cloud and device-only setup paths | Clear primary and optional choices | Component tests + setup screenshot |
| Accessibility fallbacks hold | Inspect labels, focusable actions, reduced motion/transparency styles | Desktop and 390 px viewport | Semantic tests + responsive screenshots |

Exploratory checks:

1. Type a case-insensitive username prefix that matches, then a mismatching suffix; the anchored
   suggestion should filter/dismiss without obstructing the form.
2. Reload an extension while an older login page is open; the invalidated content script should
   stop cleanly, and a normal page reload should install one fresh prompt without duplicates.
3. Open the item editor at 390 px width and with a long identity/card record; the sheet must remain
   usable without horizontal overflow or clipped primary actions.

## Verification record — 2026-07-30

- Security was rebuilt as a compact sidebar + recommendation list + focused detail pane. Healthy
  logins are omitted, and each affected login appears once under its highest-priority actionable
  issue: compromised, reused, then weak.
- “Old” and password-age text were removed from the UI, analyzer result type, tests, and product
  documentation. Revision timestamps are no longer presented as password-age evidence.
- Import and encrypted backup controls were moved to Cloud & Data, leaving Security focused on
  recommendations.
- Desktop visual review passed for hierarchy, selection, spacing, contrast, action density, and
  the separated header Lock action.
- The full production check passed: lint, strict typechecking, 36 test files/217 tests, web build,
  Chrome/Firefox MV3 builds, permission/source-map/private-key/secret/archive/size/SBOM checks.
- A fresh-profile Chrome for Testing runtime smoke passed: extension load, HTTPS injection,
  idempotent fill, hidden-form exclusion, quiet unmatched username, exact-origin suggestion,
  multistep password replacement, locked-save retry preservation, service-worker restart recovery,
  navigation recovery, and PRF capability detection.
- Physical Touch ID success is not claimed by this record. Chrome for Testing lacks the macOS
  keychain entitlement required for a real Touch ID ceremony; that remains a named manual gate.
