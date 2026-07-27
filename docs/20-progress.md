# Implementation Progress

## Overall status

- **Documentation baseline:** Complete.
- **Application implementation:** V1 feature implementation complete; portfolio release in review.
- **Current implementation task:** Task 14 — local-only release; real-account/browser/store evidence open.
- **Completed implementation tasks:** 13/14.
- **Last updated:** 2026-07-25T14:23:00Z — Unlocked UI split into Vault, Tools, and Settings; cloud providers now use direct OAuth connection cards with build-time client configuration.

## Status definitions

- `Not started` — no production implementation work accepted.
- `In progress` — tests/implementation are active on the task.
- `Blocked` — cannot continue without an explicit dependency/decision/gate.
- `In review` — implementation and validation complete; evidence awaiting review.
- `Complete` — objective, tests, demo, documentation, and definition of done accepted.

## Task tracker

| # | Task | Status | Validation/evidence | Blockers |
|---:|---|---|---|---|
| 1 | Secure walking skeleton | Complete | `pnpm install --frozen-lockfile` and `pnpm check` pass; 7 test files/11 tests; web, Worker, Chrome MV3, and Firefox MV3 artifacts built | None |
| 2 | Vault crypto and unlock | Complete | TDD red run retained; frozen install and `pnpm check` pass; 13 test files/41 tests; encrypted IndexedDB create/reopen/wrong-password/unlock flow; all production targets build | None |
| 3 | Recovery, compartments, PRF unlock | Complete | TDD red evidence retained; `pnpm check` passes; 18 test files/78 tests; semantic review approved; rebuilt client artifacts scanned | Real-browser/authenticator PRF matrix remains a feature/release gate, not an implementation blocker |
| 4 | Encrypted login/note CRUD | Complete | `pnpm check` passes; 20 test files/86 tests; encrypted immutable CRUD/restart/concurrency/plaintext inspection; web and both MV3 builds | None |
| 5 | Immutable sync engine | Complete | `pnpm check` passes; 22 test files/97 tests; encrypted two-device convergence, HLC/DAG/conflicts, retry/quarantine, durable queue, snapshots/checkpoints, conflict UI | None |
| 6 | Google Drive BYOS | Complete | Real web-client OAuth/sync/restore wiring; appDataFolder-only adapter; encrypted recovery archive; provider and UI suites | User-owned OAuth client/test-account run remains external evidence |
| 6A | Microsoft OneDrive BYOS | Code complete | OAuth authorization code with PKCE; least-privilege app folder; immutable sync objects; encrypted recovery archive; provider and web tests | User-owned Entra client/test-account run remains external evidence |
| 7 | Secure MV3 extension sessions | Complete | `pnpm check`; authenticated restart resume, trusted storage/sender tests, multi-context lock | Real-browser suspension matrix remains a release gate |
| 8 | Origin-safe autofill/capture | Complete | Exact-origin/IDN policy, activeTab fill, confirmed save/update, hostile context tests | Real-browser fixture matrix remains a release gate |
| 9 | Password generation/TOTP/clipboard | Complete | RFC vectors, encrypted TOTP fields, QR/URI import, generator and clipboard tests | Native QR capability varies and fails visibly |
| 10 | Organization/encrypted search | Complete | Encrypted schema/index migration, tags/folders/favorites/search UI and tests | None |
| 11 | Focused import/encrypted backup | Complete | Strict CSV/Bitwarden preview, atomic rollback, encrypted full-history archive and clean-profile restore; `pnpm check` at 29 files/146 tests | None |
| 12 | Password-health dashboard/HIBP | Complete | Local weak/reused/age analysis; prefix-only padded HIBP client; offline/malicious/oversize tests | Live corpus availability is external and fails visibly |
| 13 | Whole-system hardening/accessibility | Complete | Property/chaos corpus, parser limits, CSP/permissions scan, SBOM, semantic UI coverage, chunk budgets/splitting, documented review | Representative-device and independent review remain release evidence, not claimed |
| 14 | Portfolio deployment/release | In review | Reproducible local builds, Chrome/Firefox ZIPs, SBOM, hashes, runbook, operational Drive setup guide | Hosting intentionally removed; Google test account, real-browser matrix, store signing |

## Completion record

### Task 1 — Secure walking skeleton

- **Status:** Complete.
- **Owner/session:** Kiro, Task 1 implementation and validation session.
- **Scope delivered:** A strict pnpm/TypeScript monorepo with a shared locked-state React UI, Vite web shell, WXT Chromium/Firefox MV3 popup shells, a Hono Worker exposing only the versioned health route, shared contracts, package-boundary enforcement, CI, and reproducible root commands.
- **Test-first evidence:** The initial red run recorded the expected missing-implementation failures before the production modules were added. The retained suite covers the health contract, shared locked screen, web shell, extension popup, extension manifests, API behavior, and forbidden server-side package imports.
- **Test files:** `packages/contracts/src/health.test.ts`, the original Task 1 shared UI test, `apps/web/src/App.test.tsx`, `apps/api/src/index.test.ts`, `apps/extension/src/manifest.test.ts`, `apps/extension/entrypoints/popup/App.test.tsx`, and `tooling/boundaries.test.ts`.
- **Modified components:** Root workspace/tooling and CI configuration; `packages/contracts`; `packages/ui`; `apps/web`; `apps/extension`; `apps/api`; and module-boundary tests. No Task 2 cryptography, vault persistence, or unlock implementation was added during Task 1.

#### Validation evidence

- `pnpm install --frozen-lockfile` — passed with the lockfile already up to date under pnpm 11.10.0.
- `pnpm typecheck` — passed across contracts, UI, web, extension, and API workspaces after explicitly configuring React JSX for the extension.
- `pnpm test` — passed independently with 7 test files and 11 tests.
- `pnpm check` — passed the complete lint → typecheck → test → build sequence. Biome checked 39 files; all 11 tests passed; Vite produced `apps/web/dist`; Wrangler completed the Worker dry-run into `apps/api/dist`; WXT produced Chromium and Firefox Manifest V3 artifacts.

#### Demo evidence

1. The original shared locked screen rendered through both the web shell and extension popup tests, with honest copy that unlock arrived in Task 2.
2. The API test exercises `GET /v1/health` and verifies the shared versioned response contract.
3. Generated Chromium and Firefox manifests are Manifest V3, request no permissions or host permissions, and enforce the restrictive extension CSP.
4. The Firefox artifact additionally declares `data_collection_permissions.required: ["none"]` and the development extension ID.

#### Security, privacy, and limitations

- Extension permissions remain empty, production source maps are disabled, CSP excludes inline/eval execution, and the Worker has no secret-bearing client module imports.
- Dependencies are pinned exactly and dependency build scripts remain constrained by the pnpm allowlist.
- No user secrets, vault keys, cryptography, plaintext persistence, BYOS integration, telemetry, or later product behavior existed in this increment.
- Task 1 provided buildable local artifacts and automated smoke evidence; it did not claim store signing, production deployment, external security review, or vault unlock capability.

### Task 2 — Vault creation, encryption, lock, and unlock

- **Status:** Complete.
- **Owner/session:** Kiro, Task 2 implementation, security review, and validation session.
- **Scope delivered:** Project-owned browser crypto, strict versioned vault bootstrap, atomic encrypted IndexedDB persistence, instance-scoped session/key lifecycle, and one accessible shared create/prepare/failure/locked/unlocked UI wired into web and extension surfaces. Recovery Kits, compartment keys, WebAuthn PRF, revocation, password change, auto-lock, item CRUD, and sync were not implemented in Task 2.
- **Architecture decision:** [ADR-021](21-architecture-decisions.md) records exact dependencies, Argon2id policy, key hierarchy, envelope/AAD format, persistence, session ownership, rejected alternatives, and residual limitations.
- **Test-first evidence:** The red run failed on the intentionally absent crypto/vault/persistence/UI modules. A later security-review red run failed all six new strict-bound, authoritative-lock, duplicate-race, initialization-failure, and unmount-lock assertions before hardening was added. A final red run then failed the HKDF raw-copy and stale-setup preflight assertions before those remediations.
- **Modified components:** `packages/crypto`, `packages/vault`, `packages/persistence`, shared `packages/ui` vault flow, web/extension application wiring, workspace dependency pins, package-boundary tests, ADR/open-question records, and progress/context documentation.

#### Test and validation evidence

- `pnpm install --frozen-lockfile` — passed; all 9 workspace projects were already up to date under pnpm 11.10.0.
- `pnpm typecheck` — passed across all 8 runnable workspace projects, including WXT type generation.
- `pnpm lint` — passed; Biome checked 57 files with no fixes or suppressions.
- `pnpm test` — passed independently with 13 test files and 41 tests.
- `pnpm check` — passed the complete lint → recursive typecheck → 41-test suite → production build sequence.
- Production builds passed for the Cloudflare Worker dry run, Vite web application, WXT Chrome MV3, and WXT Firefox MV3.
- Generated extension manifests remained permissionless (`permissions: []`, `host_permissions: []`) with self-only script CSP; web CSP remained restrictive. Web and extension builds emitted no source maps. Wrangler emitted a local Worker dry-run map for diagnostics, but source-map upload was disabled and the map was not a deployed client artifact.

#### Retained security coverage

- RFC 5869 HKDF-SHA-256, XChaCha20-Poly1305 draft, and fixed Argon2id 1.3 vectors.
- KDF floor and V1 upper bounds, nonce uniqueness sampling, length-prefixed AAD ambiguity resistance, tamper/truncation/context-substitution rejection, and property round trips.
- Strict unknown/version/algorithm/length/schema parsing; exact V1 minimum-client marker; collapsed wrong-password, malformed-ciphertext, and authenticated-decryption failures.
- Create → explicit lock → wrong-password rejection → correct unlock, Unicode password properties, and distinct envelope nonces.
- Explicit lock generation prevents an in-flight unlock or create from reinstalling root-key material; unmount calls lock.
- IndexedDB reopen and duplicate creation behavior; both a duplicate race loser and a stale setup client reread the winning vault and transition to locked state.
- HKDF overwrites its controllable raw-key import copy in `finally`, including exceptional exits.
- Initialization failure is non-sensitive, visible, and retryable.
- Cross-package fake-IndexedDB integration verifies persisted serialization excludes the synthetic master password, `zk-wallet-empty-vault` plaintext marker, and captured raw root-key base64url encoding, then reopens, rejects a wrong password, and unlocks correctly.
- Module boundaries prevent server/API imports of client crypto, vault, or persistence code.

#### Demo evidence

1. On an empty local database, the shared web/extension flow presents accessible vault setup and creates a random-root-key encrypted empty vault.
2. Explicit lock drops the instance-held root-key reference best effort and returns to the password form.
3. Reopening the same IndexedDB record initializes locked; a wrong password produces only the safe combined error; the correct password unlocks an empty vault.
4. Local persistence inspection shows only the strict encrypted bootstrap header, never the tested password, decrypted empty-payload marker, or captured root-key encoding.
5. The same production code bundles through Vite and both WXT Manifest V3 targets.

#### Security review and residual limitations

- A behavior-level review identified excessive pre-authentication KDF/ciphertext work and lock-versus-unlock races; both high-severity findings were fixed and regression-tested. Duplicate-create preflight/race recovery, initialization UX, strict minimum-client parsing, HKDF raw-copy wiping, and controllable-array cleanup were also hardened.
- Argon2id V1 accepts only 19,456–65,536 KiB, exactly two operations, one lane, and a 32-byte output; fixed envelope lengths are checked before base64 decoding.
- Root, password-byte, KDF, wrapping, payload, and temporary plaintext arrays are overwritten best effort on controlled exits. JavaScript cannot guarantee physical erasure, and no UI text claims otherwise.
- At Task 2 completion the crypto-inclusive web/popup chunk was approximately 747 kB uncompressed and KDF work occurred on the client thread. Task 3 retains the main-thread limitation and updates the current bundle evidence below.
- Task 2 did not claim external audit, store review, or production deployment. Tasks 3–4 have since completed; Task 5 is now next.

### Task 3 — Recovery Kit, compartments, and device unlock

- **Status:** Complete.
- **Owner/session:** Kiro, Task 3 design, test-first implementation, behavior-level security review, remediation, and final validation session.
- **Scope delivered:** A checksummed 256-bit Recovery Kit and explicit drill; strict authenticated `VaultHeaderV2`; independent random root/document/credential keys with master, recovery, and active PRF wrapper sets; deterministic authenticated V1 migration; clean-profile encrypted bootstrap restore; root-bound short-lived compartment step-up; capability-gated WebAuthn PRF enrollment/unlock; wrapper-free revocation tombstones; password-only rewrap; idle/compartment expiry; compare-and-replace persistence; conflict/replay/rollback locking; and one shared accessible web/extension UI.
- **Architecture decision:** [ADR-022](21-architecture-decisions.md) records the Recovery Kit format, key hierarchy, complete-header authentication, migration/restore boundary, PRF gates, revocation, password change, CAS conflict behavior, session/error policy, UI secret lifecycle, rejected alternatives, and residual limits.
- **Scope boundary:** No encrypted item model or login/note CRUD (Task 4), immutable sync (Task 5), Google Drive/WebDAV provider (Tasks 6–7), MV3 session bridge (Task 9), generic import/export (Task 14), or later feature code was added.

#### Test-first and remediation evidence

- Before production implementation, the discovered suite had 18 files/68 tests. `pnpm test` failed as intended with 6 failing files and 27 failing Task 3 tests while all 41 retained Task 1–2 tests passed.
- Red coverage exercised Recovery Kit round-trip/corruption, independent wrappers, drill/restore, sealed compartments/expiry, root idle lock, PRF capability/enrollment/output/fallback, revocation, password rewrap invariants, strict context rejection, V1 migration, lock-operation races, CAS conflicts, encrypted persistence, and accessible shared UI.
- Subsequent security red tests covered malformed credential enrollment rollback, generated-header validation, same-slot root-bound step-up, authenticated revision reconciliation, full mutable-header component replay/rollback, CAS loser lock/reload, crypto-unavailable preservation, temporary PRF cleanup, and UI secret/ceremony abandonment paths.
- Final retained coverage is 18 files/78 tests. The increase from the initial red run reflects regression tests added during behavior-level review and remediation.

#### Implementation and security evidence

- The Recovery Kit is exactly 32 random bytes encoded by pinned `@scure/base@2.2.0` as version-word-1 `zkwr` Bech32m, with canonical mixed-case/prefix/version/length/checksum rejection and uppercase grouped display.
- Each master, recovery, and active device slot wraps root, document, and credential keys independently. Ordinary unlock installs root only; step-up unwraps and compares that same slot's root to the active root before accepting the requested compartment key.
- V2 stores a monotonic local revision and a canonical 40-byte `securityTag`: fresh 24-byte XChaCha20-Poly1305 nonce plus 16-byte tag over empty plaintext, with the complete canonical mutable V2 security header as AAD under a root-derived key. Every generated V2 header is strictly parsed before persistence.
- Unlock, restore, and privileged reads verify the complete-header tag. Lower revisions, component replay, invalid forward payloads, and rollback relative to the active authenticated session lock and fail with `VAULT_WRITE_CONFLICT`; valid forward reconciliation clears compartment sessions.
- Compare-and-replace is conditioned on vault ID, version, and revision. A loser locks, wipes controllable session/compartment buffers best effort, and reloads the winner's locked summary rather than continuing stale.
- `CRYPTO_UNAVAILABLE` remains distinguishable through password/device/recovery unlock, restore, and verification; wrong-secret/authenticated-corruption failures stay method-collapsed.
- UI tests cover Recovery Kit/password/device step-up, explicit multi-device selection, operational crypto guidance, and clearing submitted/abandoned secret state across failures, method/context changes, auto/conflict lock, and unmount.

#### Final validation evidence

- `pnpm test` — passed independently: 18 test files, 78 tests.
- `pnpm lint` — passed: Biome checked 63 files with no fixes.
- `pnpm typecheck` — passed across all 8 runnable workspace projects, including WXT type generation.
- `pnpm build` — passed for the Cloudflare Worker dry run, Vite web, WXT Chrome MV3, and WXT Firefox MV3.
- `pnpm check` — passed the complete lint → typecheck → 78-test suite → production build sequence.
- Current production sizes: web JavaScript 791.92 kB uncompressed/267.15 kB gzip; Chrome and Firefox popup JavaScript 791.93 kB uncompressed; Vite emits the expected warning above 500 kB.
- Final behavior-level semantic review: `semantic-review/2026-07-25-160825-pr-3.md`, verdict `APPROVED`, with no actionable findings. Earlier reports remain as remediation history.

#### Artifact and persistence inspection

- Fresh `apps/web/dist`, `apps/extension/.output/chrome-mv3`, and `apps/extension/.output/firefox-mv3` contain one client JavaScript chunk and CSS/HTML/manifest assets per target; no client `.map` files were found.
- Production-artifact scan found no matches for the known test-password/Recovery Kit/credential literals or `sourceMappingURL`/`sourcesContent` markers.
- Chrome and Firefox MV3 manifests retain `permissions: []`, `host_permissions: []`, and `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Firefox also declares no required data collection. The web HTML retains restrictive CSP and no-referrer policy.
- Wrangler's local `apps/api/dist/index.js.map` may exist for dry-run diagnostics; source-map upload remains disabled and this is not a deployed client artifact.
- Fake-IndexedDB integration verifies that serialized persistence excludes test passwords, Recovery Kit plaintext, raw key encodings, and decrypted payload markers while supporting authenticated reopen/restore behavior. Static bundles necessarily contain product labels and identifiers; minification is not treated as secrecy.

#### Demo evidence

1. Create a V2 vault in the shared web/extension flow, record the one-time Recovery Kit, fail a bad drill, then complete the correct drill without persisting the secret.
2. Lock and unlock the root using password or Recovery Kit; when runtime capability exists, enroll/select a PRF device and unlock with a fresh UV-required assertion.
3. Show that ordinary unlock leaves document/credential compartments sealed, then step up either compartment with password, Recovery Kit, or an explicitly selected active device and observe hard expiry.
4. Revoke a device into a wrapper-free tombstone, change the master password without changing payload/recovery/device ciphertext, and observe stale concurrent writers lock/reload rather than overwrite.
5. Restore a strict tagged V2 encrypted bootstrap into a clean repository with Recovery Kit plus a new master password; malformed wrapper/header/payload input creates no local vault.
6. Unlock the deterministic V1 fixture to atomically migrate into tagged V2 and receive the one-time Recovery Kit drill, with no partially committed format.

#### Residual limitations and release gates

- Real-browser/OS/authenticator WebAuthn PRF matrix evidence is unavailable. No PRF compatibility claim is made; web remains runtime-gated and extension PRF remains unsupported without the production RP/host-permission and Task 9 lifecycle design.
- JavaScript, immutable Recovery Kit/password strings, garbage collection, browser/authenticator internals, caches, and crash artifacts prevent guaranteed zeroization. Cleanup is best effort and product claims must remain explicit.
- Argon2id still runs on the client main thread. The approximately 791.9 kB crypto-inclusive client chunk exceeds the 500 kB warning threshold; worker isolation, representative-device profiling, and code splitting remain recorded follow-ups rather than hidden Task 3 scope.
- The authenticated local revision detects rollback relative to an active session but cannot prove freshness when a fresh client is presented only a complete older self-consistent header. Immutable sync ancestry/trusted checkpoints remain later work.
- The semantic review is internal behavior-level review, not an independent security audit. No store signing/review, real-browser built-artifact automation, external assessment, production deployment, or provider interoperability is claimed.
- Git commit/PR evidence could not be produced because this workspace reported no Git repository metadata.
- No unresolved implementation blocker remains for Task 3. Roadmap Task 4 is next and has not started.

## How to update this file

For an active task, add:

- Owner/session and start date.
- Test files written first.
- Modified components.
- Validation commands and outcomes.
- Demo steps/evidence.
- Security/privacy review notes.
- New decisions, risks, or known limitations.

Do not mark a task complete because code compiles. Apply [`30-definition-of-done.md`](30-definition-of-done.md).

## Documentation progress

Created baseline context documents `00` through `30`, `docs/README.md`, and root `PROJECT_CONTEXT.md`. Application implementation is complete through Roadmap Task 4; Task 5 and all later tasks remain governed by the roadmap, security invariants, release gates, and definition of done.

### Task 4 — Encrypted login and secure-note CRUD

- **Status:** Complete.
- **Scope delivered:** Strict bounded V1 login and secure-note schemas; independently keyed XChaCha20-Poly1305 immutable create/update/delete revisions; root-derived item-key wrapping; authenticated vault/item/revision/parent/operation/purpose context; encrypted tombstones; IndexedDB version-2 migration with atomic revision/head compare-and-set; unlocked vault-client CRUD; and one shared accessible item UI wired into web and extension surfaces.
- **Architecture decision:** [ADR-023](21-architecture-decisions.md) records schema bounds, envelope context, key hierarchy, storage transaction semantics, Task 5 boundary, rejected alternatives, and limitations.
- **Test evidence:** Added strict schema/boundary tests, encrypted round trips, plaintext sentinel inspection, context substitution and deterministic ciphertext-tamper rejection, tombstone behavior, IndexedDB v1-to-v2 bootstrap preservation, concurrent local edit winner/loser behavior, complete CRUD/restart integration, and UI login creation/secret-field clearing.

#### Validation evidence

- `pnpm lint` — passed; Biome checked 66 files.
- `pnpm typecheck` — passed across all eight runnable workspace projects.
- `pnpm test` — passed with 20 test files and 86 tests.
- `pnpm check` — passed the complete lint, recursive typecheck, test, and production-build sequence.
- Vite web, WXT Chrome MV3, WXT Firefox MV3, and Cloudflare Worker dry-run builds completed. Wrangler could not write its optional debug log outside the sandbox (`EPERM`) but completed the dry-run artifact.
- Generated web and extension bundles contain encrypted-item support and no source maps. The crypto-inclusive client chunk is approximately 806 kB uncompressed and remains known optimization debt.

#### Demo evidence

1. An unlocked verified vault creates a login or secure note through the shared form.
2. Reloading/reopening starts locked; correct local unlock decrypts the current immutable heads.
3. Editing publishes a child revision; deletion publishes an authenticated tombstone.
4. Concurrent editors sharing one expected head produce one committed winner and one conflict.
5. Stored head serialization does not contain tested usernames, passwords, URLs, titles, or note bodies.

#### Security, privacy, and limitations

- Item keys are random and re-created per revision; neither passwords nor domain values are stored in cleartext routing/index fields.
- CRUD requires an authenticated active root session and preserves existing lock/conflict/session lifecycle behavior.
- Task 4 does not claim multi-device convergence, HLC/device ancestry, provider sync, snapshots, conflict copies, encrypted search, autofill, attachments, or import/export. Those remain later roadmap tasks.
- JavaScript secret erasure remains best effort. Current listing decrypts bounded current records; rebuildable encrypted search/index projections remain Task 12.
- Roadmap Task 5 has since completed; Task 6 Google Drive synchronization is next.

### Task 5 — Immutable offline sync engine

- **Status:** Complete.
- **Scope delivered:** Provider-neutral immutable-object interfaces; strict sync-revision parsing; hybrid logical clocks; deterministic revision DAG resolution; idempotent union; bounded retry; corrupt, collision, and recursively missing-parent quarantine; rebuildable snapshots; active-device checkpoints; conservative tombstone eligibility; root-key-encrypted vault sync envelopes; IndexedDB version-4 durable sync objects/quarantine/conflicts; Task 4 revision import/head publication; and visible persistent conflict summaries.
- **Architecture decision:** [ADR-025](21-architecture-decisions.md) records the revision model, provider/codec boundary, HLC policy, convergence rules, encrypted vault bridge, durable persistence, conflict behavior, and rejected alternatives.

#### Validation and demo evidence

- `pnpm check` passed: Biome checked 72 files; all nine runnable workspace projects typechecked; 22 test files/97 tests passed; Worker dry run, Vite web, and Chrome/Firefox MV3 builds completed.
- Property coverage verifies convergence independent of ordering and duplication.
- Two offline encrypted item stores sharing one ancestor create independent password edits, upload through an opaque fake provider, pull both histories, retain all three item revisions, choose the same presentation head, and report the same two-revision conflict.
- Provider serialization contains none of the tested passwords or URL.
- Delete/edit races remain conflicts; missing ancestry, corrupt objects, and different authenticated content under one locator are quarantined without discarding unrelated valid history.
- Transient upload failures retry within a strict bound; repeat synchronization is idempotent.
- Conflict summaries persist in IndexedDB and render through the shared unlocked UI after restart.

#### Security, privacy, and limitations

- The fake JSON codec exists only in tests. Production-facing vault synchronization uses a root-derived authenticated envelope, so the provider sees opaque locators, ciphertext size, and timing—not item fields or DAG metadata.
- Google Drive authentication, change feeds, pagination, quota handling, and real cross-profile provider tests remain Task 6.
- Snapshots are rebuildable model outputs and are not trusted as canonical history.
- Tombstone collection is only declared eligible when every active device checkpoint observed it; Task 5 does not perform destructive provider garbage collection.
- The application still needs explicit conflict-resolution editing in a later UX refinement; Task 5 preserves and visibly reports every version rather than silently resolving it.

### Task 6 — Google Drive encrypted synchronization

- **Status:** Complete.
- **Scope delivered:** A project-owned fetch adapter restricted to the Google Drive `appDataFolder`; the exact non-sensitive `drive.appdata` scope constant; memory-only access-token provider boundary; token refresh/revocation handling; immutable multipart uploads; idempotent name checks; paginated listing/download; bounded response sizes; paged change cursors; retry classification; and separate quota, authorization, transient, corrupt-response, and invalid-input failures.
- **Architecture decision:** [ADR-026](21-architecture-decisions.md) records the least-privilege boundary, opaque naming, upload semantics, retry/error policy, change-feed role, and remaining public OAuth release gate.

#### Validation and demo evidence

- The focused suite verifies appDataFolder-only pagination, opaque download, immutable multipart parent metadata, repeat-upload idempotency, lost-response retry, expired-token replacement, persistent revocation, quota exhaustion, transient service retry, change-cursor progression, unsafe locator rejection, and oversized-response rejection.
- A synthetic encrypted revision is uploaded from one profile through the production Drive adapter and recovered into an empty second profile. Fake Drive serialization contains no tested plaintext secret.
- The full repository check validates lint, every workspace typecheck, all tests, and every production build.

#### Security, privacy, and limitations

- The adapter receives only already encrypted sync envelopes. OAuth access tokens are requested per operation, retained only by the caller-owned in-memory token provider, and never sent to the application API.
- Drive can observe object names, sizes, timing, account identity, and access patterns. Users can revoke access or delete the hidden app data, so independent encrypted exports remain necessary.
- Drive does not provide the immutable compare-and-swap primitive required for correctness. A lost upload response may produce a duplicate object; authenticated revision identity and deterministic union make duplicate delivery safe.
- Sync object names include an opaque root-derived vault namespace. Multiple vaults may use the same
  Google account without attempting to decrypt or quarantine one another's revisions; the encrypted
  recovery archive remains separately discoverable for clean-profile restoration.
- The web client uses a project-configured OAuth web client ID, opens consent for the exact
  `drive.appdata` scope, keeps access tokens only in memory, runs the production encrypted sync
  coordinator, uploads a Recovery-Kit-protected archive after successful sync, and supports direct
  clean-profile Drive restore. A localhost Google Cloud OAuth client is registered in project
  `gothic-module-490620-f4`, the Drive API and `drive.appdata` scope are enabled, and
  `vvce23cseaiml0078@vvce.ac.in` is registered as a test user. The public client ID lives only in
  the ignored `apps/web/.env.local`; production publishing, independent accounts, and quota
  behavior remain external release gates.

### Task 7 — Secure MV3 extension sessions

- **Status:** Complete.
- **Scope delivered:** A short-lived root-session export/resume boundary that re-authenticates the current encrypted V2 header; volatile `storage.session` serialization; mandatory `TRUSTED_CONTEXTS` access restriction; strict expiry and record parsing; extension sender-origin validation; multi-context unlock/lock broadcasts; popup lifecycle integration; native `browser.identity` Google OAuth; and root-namespaced encrypted Drive synchronization limited to `https://www.googleapis.com/*`.
- **Architecture decision:** [ADR-027](21-architecture-decisions.md) records why volatile root session material is permitted, how restart resume fails closed, and why item plaintext and compartment keys remain excluded.

#### Validation and demo evidence

- A service instance creates and verifies a vault, exports a copied 32-byte root lease, locks, and a fresh service instance resumes only after verifying vault ID, expiry, complete header authentication, and encrypted payload authentication. Consumed key copies are overwritten best effort.
- Fake MV3 storage verifies trusted-only access configuration, restart load, malformed/expired removal, successful-unlock persistence, second-context resume, lock broadcast, and rejection of page, tab, foreign-extension, and lookalike senders.
- Extension OAuth tests verify the exact hidden app-data scope, redirect/state binding, bearer validation, and narrowly scoped identity/API manifest permissions. Chrome MV3 and Firefox MV3 production builds complete.

#### Security, privacy, and limitations

- The volatile lease contains the root key because an MV3 worker can terminate unpredictably. It is stored only in browser-managed session memory, is cleared on browser restart/explicit lock/expiry, is restricted to trusted extension contexts, and never includes master passwords, item plaintext, item collections, Recovery Kit material, or compartment keys.
- Resume is not trust-by-deserialization: the key must authenticate the currently persisted vault header and payload. A wrong vault, expired record, tampered key, or changed header fails closed and clears the lease.
- JavaScript and browser session storage cannot guarantee physical erasure. Real Chrome/Firefox worker-suspension, crash, and browser-restart automation remains a release gate.

### Tasks 8–10 — Safe browser use, secret tools, and organization

- **Status:** Complete.
- **Scope delivered:** Exact HTTPS-origin and punycode-aware matching; explicit `activeTab`/`scripting` main-frame fill; standard/SPA input events; conservative HTTP/opaque/cross-frame refusal; confirmed save/update capture; exact-origin TOTP fill; strict otpauth parsing and RFC vectors; capability-gated local QR import; unbiased CSPRNG password and 2048-token passphrase generation; best-effort clipboard clearing that preserves newer clipboard content; encrypted TOTP, tag, folder, and favorite fields; local search UI; and a root-derived authenticated rebuildable search index in IndexedDB version 5.
- **Validation:** `pnpm check` passes with 27 test files and 139 tests. The suites cover lookalikes, IDNs, frames, ambiguity, form events, capture decisions, explicit confirmation, generator rejection sampling, RFC TOTP vectors, QR payloads, clipboard replacement races, encrypted item plaintext inspection, encrypted search/tamper handling, persistence migration, manifests, and production builds.
- **Limitations:** Broad related-domain matching, arbitrary shadow DOM, unusual multistep login capture, automatic background capture, and camera QR fallback without native `BarcodeDetector` remain intentionally unsupported. Real hostile-site Chrome/Firefox automation remains a release gate.

### Tasks 11–12 — Portable encrypted data and password health

- **Status:** Complete.
- **Scope delivered:** Strict bounded CSV and Bitwarden login preview/import, duplicate warnings and opt-in selection, atomic encrypted batch persistence, a full immutable-history encrypted archive, clean-profile Recovery Kit restore, local weak/reused/old password analysis, and user-triggered padded Pwned Passwords range checks.
- **Validation:** The Task 11 acceptance run passed 29 test files/146 tests. Added Task 12 tests assert that only the five-character SHA-1 prefix reaches the network and cover offline, malformed, oversized, unsafe-count, match, and not-found responses. Archive integration proves plaintext exclusion, authenticated round trip, new master wrapping, and rollback on corruption.
- **Limitations:** Import intentionally excludes encrypted/unsupported Bitwarden records and ordinary plaintext export. Password age is estimated from the item revision timestamp. HIBP k-anonymity does not hide IP, timing, or the prefix anonymity set.

### Task 13 — Whole-system hardening and accessibility

- **Status:** Complete for local implementation evidence.
- **Scope delivered:** Retained cryptographic property, sync chaos, hostile-origin, provider-failure, parser-limit, migration, race, and malicious-response suites; production CSP/permission/source-map/private-key scanners; exact dependency pins; CycloneDX SBOM; semantic accessible UI coverage; a 900 kB per-chunk ceiling; React/crypto runtime code splitting; security policy; updated threat model; and explicit performance/accessibility limitations.
- **Evidence:** [`34-hardening-evidence.md`](34-hardening-evidence.md), `release/sbom.cdx.json`, and `tooling/verify-artifacts.mjs`.
- **Limitations:** Representative-device KDF measurements, manual assistive-technology/browser checks, and independent assessment remain external release evidence and are not claimed.

### Task 14 — Portfolio release

- **Status:** In review.
- **Local deliverables:** Static web and Worker dry-run outputs; reproducible Chrome and Firefox MV3 ZIPs; validated SBOM; release/security documentation; smoke/demo script; migration and rollback plan; and artifact checks integrated into CI.
- **Artifact evidence:** Chrome ZIP SHA-256 `dcfd72fe51cb42a7e5734db51e9a143fc82a8a330495a53560ac310c6030b5a9`; Firefox ZIP SHA-256 `bc6b5ca7ad14b780e325a50ca818bb949144f05dcdd1ac01910021dd761b9f36`; lockfile SHA-256 `910e7b1aaffe0b201afb55772adf07987d0d303985647562a02d2bcddeb2654e`.
- **Latest validation:** `CI=true pnpm check` passes with 31 test files and 156 tests, all production targets, and artifact verification.
- **Open external gates:** Hosting was intentionally removed in favor of localhost. Google OAuth
  is registered for localhost and its configured test account. The pinned Chrome extension ID is
  `lnabfclakgdolgcfallnnhkeeoclfkcf`; its
  `https://lnabfclakgdolgcfallnnhkeeoclfkcf.chromiumapp.org/oauth/google` redirect is registered
  on the Google OAuth client. Microsoft OAuth is blocked until the current account has an Entra
  tenant/directory. The real installed-extension Chrome/Firefox/PRF matrix has not run, and neither
  extension ZIP is store-signed. Task 14 must not be marked complete until the applicable evidence
  is attached.
