# Architecture Decisions

This is a concise decision log. During implementation, add dated ADR sections with status, context, options, consequences, and superseding links. Do not silently reverse accepted decisions.

## ADR-001: Zero-knowledge client-side encryption

- **Status:** Accepted.
- **Decision:** Clients encrypt/decrypt; server/BYOS never receive decryption keys.
- **Rejected:** Server-managed keys or server-side plaintext processing.
- **Consequence:** No server password reset; local processing and user-held recovery required.

## ADR-002: Browser/web first

- **Status:** Accepted.
- **Decision:** React/Vite web plus Chromium/Firefox WXT MV3 extensions.
- **Rejected:** Apple-native-first.
- **Consequence:** Native attestation, iCloud, Safari, mdoc proximity, and OS wallet registration deferred.

## ADR-003: Personal cloud is source of truth

- **Status:** Accepted.
- **Decision:** Google Drive plus generic BYOS; encrypted IndexedDB is cache.
- **Rejected:** Server-primary vault database.
- **Consequence:** Provider adapters and offline sync are foundational.

## ADR-004: Google Drive plus WebDAV

- **Status:** Accepted.
- **Decision:** Drive `appDataFolder` first; WebDAV first generic adapter, extension-first for CORS.
- **Rejected:** iCloud web integration in v1.

## ADR-005: Separate account identity and vault unlock

- **Status:** Accepted.
- **Decision:** Google sign-in identifies account; master password unlocks locally.
- **Consequence:** API outage cannot prevent local unlock.

## ADR-006: User-held recovery and PRF convenience

- **Status:** Accepted.
- **Decision:** Recovery Kit plus capability-gated WebAuthn PRF device unlock.
- **Rejected:** Email/server reset, escrow, security questions.

## ADR-007: TypeScript-first core

- **Status:** Accepted.
- **Decision:** Shared TypeScript packages; reviewed WASM dependencies may provide primitives.
- **Rejected:** Rust/WASM application core initially.
- **Consequence:** Faster shared web/extension delivery; runtime memory limitations documented.

## ADR-008: Hono/Cloudflare free control plane

- **Status:** Accepted.
- **Decision:** Hono Workers, D1, R2, Turnstile.
- **Rejected:** Fastify/NestJS server for initial edge deployment.
- **Consequence:** Edge-native APIs and free-tier limits; no SLA.

## ADR-009: Immutable per-item sync

- **Status:** Accepted.
- **Decision:** Immutable encrypted revisions, HLC/device IDs, tombstones, deterministic merges, conflict copies, rebuildable snapshots.
- **Rejected:** One giant mutable vault blob; full general-purpose CRDT.

## ADR-010: Snapshot sharing

- **Status:** Accepted.
- **Decision:** Temporary E2EE relay; recipient imports independent copy.
- **Rejected:** Persistent live shared vaults.

## ADR-011: Free HIBP password checks

- **Status:** Accepted.
- **Decision:** Pwned Passwords k-anonymity; account breaches via manual link or encrypted BYO paid key.
- **Rejected:** Required paid monitoring or server collection of full hashes/emails.

## ADR-012: SSH key vault only

- **Status:** Accepted.
- **Decision:** Generate/import/inspect/export SSH keys.
- **Rejected:** Browser SSH terminal and native agent in v1.

## ADR-013: Private document wallet plus optional official DigiLocker

- **Status:** Accepted.
- **Decision:** Independent encrypted document wallet ships; official connector is authorization/terms gated.
- **Rejected:** Scraping or blocking the wallet on partnership.

## ADR-014: Format-neutral credential envelope

- **Status:** Accepted.
- **Decision:** Preserve originals; adapters normalize evidence without converting formats.
- **Rejected:** Treat every file as W3C VC or transform PDFs into selective credentials.

## ADR-015: Tiered credential standards

- **Status:** Accepted.
- **Decision:** VC 2/JOSE, RFC 9901, pinned SD-JWT VC, OID4VCI/OID4VP/DCQL production targets; BBS/mdoc/DC API gated.
- **Consequence:** Capability/version UX and conformance testing required.

## ADR-016: Strict credential firewall

- **Status:** Accepted.
- **Decision:** No silent disclosure/status/metadata retrieval; explicit consent and correlation preview.
- **Rejected:** Convenience-first automatic identity presentation.

## ADR-017: Separate sensitive compartment keys

- **Status:** Accepted.
- **Decision:** Document/credential keys stay sealed after ordinary unlock and require step-up.
- **Consequence:** More key slots/recovery complexity for stronger exposure reduction.

## ADR-018: Local-only document intelligence

- **Status:** Accepted.
- **Decision:** OCR/classification/redaction/search run locally.
- **Rejected:** Cloud AI document upload.

## ADR-019: Email aliases deferred

- **Status:** Accepted.
- **Reason:** Production domain and two-way provider-agnostic mail design unresolved; all-free requirement conflicts with reliable mail operations.

## ADR-020: No emergency access

- **Status:** Accepted.
- **Decision:** Skip entirely rather than introduce escrow/delegation complexity.

## ADR-021: Task 2 browser cryptography and vault bootstrap format

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 2; requires re-review before changing any algorithm, parameter floor, or serialized format.
- **Context:** Task 2 needs interoperable browser cryptography, a password-independent random root key, fail-closed versioning, and an encrypted local bootstrap that works in both Vite and WXT clients without involving the control plane.
- **Decision — primitive provider:** Pin `libsodium-wrappers-sumo@0.8.4` and force its `libsodium-sumo` transitive dependency to `0.8.4`. Use libsodium's Argon2id 1.3 and XChaCha20-Poly1305-IETF implementations behind `@zk-wallet/crypto`; use platform Web Crypto HKDF-SHA-256 and `crypto.getRandomValues`. Domain/application code never imports these primitive APIs directly.
- **Decision — KDF policy:** Persist a 16-byte random salt, 32-byte output length, Argon2id version 1.3, one lane, at least 19,456 KiB memory, and at least two operations. Creation measures candidates from 19,456 KiB through a 65,536 KiB cap and keeps the first candidate reaching the 350 ms client target; unlock uses the persisted accepted parameters exactly. The floor is never reduced for a slow device. Tests may inject a lower-cost provider/profile, but persisted production headers reject below-floor values.
- **Decision — key hierarchy:** Generate a random 32-byte root vault key. Derive a master-password base key with Argon2id, then derive the root-wrap KEK with HKDF-SHA-256 and the label `zk-wallet/v1/master-password/root-wrap`. Derive the empty-vault payload key independently from the root key with the label `zk-wallet/v1/vault-payload`. Password-derived material never directly encrypts vault content.
- **Decision — serialization:** Store one strict `VaultHeaderV1` object containing format/version, opaque 16-byte vault ID, minimum client version, one master-password slot, and one encrypted empty-vault payload. The slot contains an opaque 16-byte slot ID, exact KDF parameters/salt, and a versioned XChaCha20-Poly1305 envelope wrapping only the root key. The encrypted payload validates to the exact schema `{ format: "zk-wallet-empty-vault", schemaVersion: 1, items: [] }`; no plaintext password verifier or user metadata is stored.
- **Decision — authenticated context:** Every envelope uses a 24-byte random nonce and deterministic length-prefixed AAD binding envelope/algorithm version, purpose, vault ID, slot or payload identity, and content schema version. Unknown fields, versions, algorithms, non-canonical encodings, malformed lengths, below-floor KDF settings, authentication failures, and invalid decrypted schemas fail closed.
- **Decision — persistence/session:** `@zk-wallet/persistence` stores the complete header as one atomic IndexedDB record under an opaque fixed bootstrap key. `@zk-wallet/vault` owns the repository interface and an instance-scoped unlocked session; it exposes state but never root key bytes. Explicit lock overwrites held key buffers best-effort and drops references. Wrong-password and authenticated-ciphertext failures share one non-sensitive unlock error.
- **Rejected:** Direct password encryption of vault data; a plaintext password verifier; custom primitives; noble's current pure-JavaScript Argon2 path because its documentation identifies a performance disadvantage and excludes Argon2 from the earlier independent audit; obsolete `argon2-browser`; server-assisted KDF/unlock; persistent global key singletons; and implementing Task 3 recovery/PRF/compartment wrappers early.
- **Consequences:** The initial cryptographic bundle is larger because the established libsodium sumo build supplies password hashing. KDF work may briefly occupy the current client thread in Task 2; worker isolation remains a measured hardening follow-up if profiling shows unacceptable responsiveness. JavaScript cannot guarantee key erasure, so UI/security text must not claim deterministic zeroization.
- **Task 2 hardening evidence:** The v1 parser caps persisted Argon2 memory at 65,536 KiB, requires exactly two operations, validates fixed envelope lengths before base64 decoding, and requires the exact v1 minimum-client marker. Explicit lock/unmount advances a session generation so an in-flight create or unlock cannot reinstall key material afterward. Duplicate-create race and stale-setup preflight paths reread the winning header and move to locked state; initialization failures expose a safe retry path; HKDF wipes its controllable raw-key import copy in `finally`.
- **Residual limitations:** Vite and WXT production builds prove that the pinned libsodium package bundles for web, Chrome MV3, and Firefox MV3, but no built-artifact real-browser automation exists yet. The crypto-inclusive JS chunk is approximately 747 kB uncompressed, and JavaScript zeroization remains best effort. These are recorded limitations, not external audit evidence.
- **Evidence:** [Libsodium password hashing](https://libsodium.gitbook.io/doc/password_hashing/) documents Argon2id support; [libsodium AEAD guidance](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305) documents authenticated additional data and random-nonce XChaCha20-Poly1305; [OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) provides the selected minimum Argon2id work factors; [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) defines Argon2 version 1.3 and vectors. Package metadata was verified from the npm registry before pinning.

Content from external sources was rephrased for compliance with licensing restrictions.

## ADR-026: Google Drive appDataFolder provider boundary

- **Date:** 2026-07-25.
- **Status:** Accepted and implemented for Task 6.
- **Context:** The production v1 provider must synchronize authenticated ciphertext through the user's Google Drive without granting access to ordinary Drive files, persisting OAuth secrets in the application server, or treating provider ordering and mutable metadata as correctness primitives.
- **Decision — authorization:** The provider publishes only the exact `https://www.googleapis.com/auth/drive.appdata` scope. A caller-owned token provider supplies short-lived access tokens per request and may invalidate an expired token once. Tokens are neither persisted nor logged by the adapter, and master-password unlock remains separate from Google authorization.
- **Decision — storage:** Every immutable sync object is a bounded multipart upload whose parent is `appDataFolder`. A strict opaque locator maps to a namespaced filename. Listing always specifies `spaces=appDataFolder`, follows every page, ignores unrelated filenames, and downloads file bytes with `alt=media`.
- **Decision — reliability:** Existing names produce idempotent success. Network failures, rate limits, and server failures retry within a caller-bounded budget. Quota exhaustion, expired/revoked authorization, corrupt provider responses, and invalid local input remain distinct typed failures. A response lost after a committed upload can create duplicates; the Task 5 authenticated immutable-union model accepts identical duplicate delivery safely.
- **Decision — discovery:** The adapter exposes start cursors and paged appDataFolder change delivery as an optimization. Cursors are advanced only from Drive responses; full listing remains the correctness and clean-profile recovery path.
- **Decision — validation:** The fake HTTP provider suite exercises pagination, duplicate-safe interrupted upload, token replacement/revocation, quota/rate/server behavior, change feeds, input/response bounds, and encrypted clean-profile recovery. Public OAuth consent and a real synthetic-data Google account run remain release gates.
- **Rejected:** Full Drive scope, server-side refresh-token storage, mutable single-file vaults, trusting change feeds as the only recovery mechanism, logging bearer tokens, unbounded responses/retries, and claiming provider CAS semantics.
- **Consequences:** Google can observe account and ciphertext traffic metadata but not authenticated vault content. Users can revoke the app or delete app data; encrypted exports remain required. The provider package has no Google SDK dependency and keeps protocol behavior behind a project-owned interface.

## ADR-027: Restricted volatile MV3 root sessions

- **Date:** 2026-07-25.
- **Status:** Accepted and implemented for Task 7.
- **Context:** Manifest V3 runtimes can terminate while a browser session is active. Requiring the master password after every worker or popup restart is unusable, but persistent local storage of plaintext vault data or long-lived keys would violate the threat model.
- **Decision:** An unlocked trusted extension context may copy the 32-byte root key into a strict, expiring V1 lease in browser-managed `storage.session`. Access is explicitly set to `TRUSTED_CONTEXTS`; the extension requests only `storage` and no host permission. The lease excludes passwords, Recovery Kits, item plaintext/collections, document keys, and credential keys.
- **Decision — resume:** A new service instance consumes a copied lease only before its wall-clock expiry and only when the vault ID matches. It then authenticates the complete current V2 header and encrypted payload with the root key before publishing unlocked state. Invalid, expired, mismatched, or malformed state is removed and remains locked.
- **Decision — coordination:** Unlock lease changes and locks carry monotonic epochs over the extension runtime bus. Explicit lock clears session storage and broadcasts to every popup/context. Message senders must match the exact extension ID and scheme/host and must not originate from a tab.
- **Consequences:** Browser restart clears the lease while MV3 runtime restart can recover it. Browser and JavaScript erasure are best effort, and compromised trusted extension code can read an active root key; CSP, minimal permissions, dependency controls, and release testing remain essential.
- **Rejected:** `storage.local`, plaintext item caches, permanent sessions, password persistence, compartment-key persistence, trusting serialized state without cryptographic re-authentication, broad host permissions, and accepting tab/page-originated session management.

## ADR-028: Exact-origin browser credential boundary

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 8.
- **Decision:** Autofill and capture require an explicit extension action, HTTPS, the top frame, one exact canonical origin, and one unambiguous credential. Unicode hostnames are compared in URL-canonical punycode form. The extension uses temporary `activeTab` plus `scripting`, never permanent host access. Save/update candidates require a destination-host confirmation and remain only in popup memory until accepted or canceled.
- **Rejected:** HTTP fill, related-domain inference, cross-origin frames, silent account selection, automatic background capture, and installation-time all-site access.

## ADR-029: Encrypted authenticator and secret-tool policy

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 9.
- **Decision:** Authenticator URIs remain inside encrypted login payloads. Parsing is strict and bounded; HMAC TOTP supports SHA-1/256/512 and six/eight digits. QR decoding is local and capability-gated with URI paste fallback. Generators use rejection sampling; the built-in six-token passphrase draws from 2048 unique combinations. Clipboard clearing checks that the copied secret is still present before overwriting and is described as best effort.
- **Rejected:** Modulo-biased randomness, remote QR decoding, plaintext TOTP indexes, background code fill, and guaranteed clipboard erasure claims.

## ADR-030: Encrypted organization and rebuildable search

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 10.
- **Decision:** Optional tags, folder, favorite, and TOTP URI fields are inside strict encrypted item payload schema 2 while schema 1 remains readable. A root-derived XChaCha20-Poly1305 local search index stores only ciphertext in IndexedDB version 5, authenticates vault/purpose context, and is rebuilt from decrypted current heads. Search covers titles, usernames, folders, and tags without provider-visible projections.
- **Rejected:** Plaintext indexes, provider-side search, password/TOTP token indexing, unbounded tags, and treating the index as canonical data.

## ADR-031: Atomic import and recovery-bound encrypted archive

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 11.
- **Decision:** Generic CSV and Bitwarden login imports are strictly bounded, previewed, validated, duplicate-warned, explicitly selected, encrypted before persistence, and committed as one IndexedDB transaction. The archive carries a visible strict vault header plus a root-derived authenticated encrypted payload containing every immutable revision and selected head; clean-profile restore authenticates all content with the Recovery Kit before one atomic commit and creates a new master wrapper.
- **Rejected:** Plaintext export, partial row commits, automatic duplicate merges, importer-specific persistence, unauthenticated ZIP/JSON backups, and overwriting a non-empty target profile.

## ADR-032: User-triggered k-anonymous password exposure checks

- **Date:** 2026-07-25.
- **Status:** Accepted for Task 12.
- **Decision:** Weakness, exact-password reuse, and age are computed locally after explicit analysis. Age uses the item revision update time as an honest estimate. A breach check is separately user-triggered per login, hashes locally with SHA-1, sends only the first five uppercase hash characters to the Pwned Passwords range endpoint, requests padding, and strictly bounds/parses the response. Offline or malicious responses produce an unavailable result without weakening local analysis.
- **Rejected:** Uploading passwords or full hashes, automatic background checks, account monitoring, storing exposure-query history, accepting malformed counts, and claiming that k-anonymity hides timing/IP metadata.

## ADR-033: Reproducible local release with honest external gates

- **Date:** 2026-07-25.
- **Status:** Accepted for Tasks 13–14.
- **Decision:** CI adds production artifact, permission, CSP, source-map, embedded-key, chunk-budget, and CycloneDX SBOM checks. React and libsodium are split into bounded cacheable chunks. Chrome and Firefox MV3 ZIPs, static web output, Worker dry-run output, a smoke/demo runbook, migration/rollback instructions, security policy, and hardening evidence form the reproducible local release.
- **Consequences:** Local feature implementation can be accepted through Task 13, but Task 14 remains in review until actual hosted URLs, OAuth/domain/test-account evidence, the real-browser matrix, and any claimed store signing exist. Independent review is never implied.
- **Rejected:** Fabricated deployment/OAuth/store evidence, calling local fixtures an external audit, weakening security parameters for performance scores, production source maps, and unbounded monolithic entry chunks.

## ADR-034: Memory-only Google OAuth and Drive recovery archive

- **Date:** 2026-07-25.
- **Status:** Accepted for the completed Task 6 application wiring.
- **Decision:** The localhost web client accepts a public Google OAuth web client ID, uses an exact localhost callback with a random state, requests only `drive.appdata`, and retains the bearer token only in the live page. An explicit unlocked-vault action exports a copied root session, encrypts and merges immutable revisions through the production sync codec, overwrites the controllable root copy, and uploads an authenticated encrypted full-history recovery archive. A clean profile can fetch that archive and authenticate it with the Recovery Kit before atomic restore and rewrapping under a new master password.
- **Consequences:** Local vault operation remains independent of Google. Disconnect or page restart removes the memory token. Google observes account, traffic, size, and timing metadata. The fixed recovery archive is a convenience backup, not sync truth; immutable revisions remain canonical. OAuth consent and real-account behavior require the user’s Google Cloud project.
- **Rejected:** OAuth tokens in localStorage/IndexedDB, broad Drive scope, application-server token exchange or vault relay, plaintext Drive exports, treating the mutable recovery archive as canonical history, silent background consent, and server recovery escrow.

## ADR-035: Field-level authenticated AutoFill

- **Date:** 2026-07-27.
- **Status:** Accepted and hardened through extension version 0.6.7.
- **Decision:** A compact field-anchored Passwords chooser is triggered by trusted focus and pointer events and is refreshed for page restoration, visibility changes, autofocus, and dynamically replaced login steps. A local-only rebuildable suggestion index stores only credential ID, username, and canonical HTTPS origins so a locked chooser can present accounts before secret release; it is never synced and contains no password, note, title, tag, or key material. Every credential selection requires a fresh WebAuthn PRF ceremony when enrolled or a fresh master-password confirmation, even if a longer-lived manager root session is already unlocked. Showing an indexed account label never authorizes password release. The selected credential ID and fill/submit choice are bound into the authenticated extension-origin handoff. The master password is collected only in that protected window, never in content-script or page DOM. Both methods select only exact-HTTPS-origin logins, deliver one explicitly selected credential to the originating tab, and relock immediately. Fill-and-submit remains an explicit choice and requires one unambiguous login submitter.
- **Security boundary:** Background handlers strictly parse exact message schemas, validate the sender tab against the requested top-level HTTPS origin, and bind the extension sheet to that tab and URL. Indexed metadata is structurally validated before use and is treated only as an untrusted suggestion: the authenticated path reopens the encrypted vault and repeats exact-origin and credential-ID checks before releasing a password. The local browser profile and other trusted extension contexts can observe indexed usernames and origins; users who require those labels to remain encrypted can clear extension storage and forgo locked recommendations until the next authenticated rebuild. The receiving content script accepts credential delivery only from its own extension without a sender tab and rechecks the exact origin. Cross-origin frames, opaque/HTTP origins, overwritten fields, password-creation forms, and ambiguous submit controls fail closed. If Chrome invalidates an already-injected content script during an extension reload, synchronous and asynchronous runtime failures are contained: the stale prompt is removed, its observer is disconnected, and that script stops issuing extension requests.
- **Rejected:** Treating an existing unlocked manager session as AutoFill authorization, direct plaintext selection messages, master-password fields inside the visited page, keyboard interception, silent filling, automatic submission, related-domain guessing, keeping the manager unlocked after transient AutoFill, copying Apple branding or proprietary artwork, and claiming Chrome can render Safari's system-owned Password AutoFill UI.

## ADR-025: Task 5 provider-neutral deterministic sync core

- **Date:** 2026-07-25.
- **Status:** Accepted and implemented for Task 5.
- **Context:** Task 5 must prove deterministic convergence independently of Google Drive and without assuming provider ordering, uniqueness, transactions, or trustworthy snapshots.
- **Decision — provider boundary:** `@zk-wallet/sync` accepts only opaque provider objects through `list` and idempotent `putIfAbsent`. A caller-supplied codec authenticates/decodes objects before the core sees revision metadata. The fake JSON codec is test-only and is not an approved persistent production format.
- **Decision — revision model:** A strict V1 revision has a bounded opaque revision ID, item ID, device ID, parent set, value/tombstone kind, and hybrid logical clock. Unknown fields, duplicate/self parents, invalid clocks, and malformed IDs fail closed.
- **Decision — convergence:** The engine unions local and remote immutable objects idempotently, quarantines corrupt objects and descendants with missing parents, constructs the DAG, removes causal ancestors from the head set, and sorts concurrent heads only for deterministic presentation. It never discards concurrent heads. Multiple heads, including delete/edit races, produce an explicit conflict result.
- **Decision — clocks:** HLC advancement uses the maximum of local, observed, and current wall time plus a logical counter. Wall-clock rollback cannot move the clock backward and clocks are not authorization evidence.
- **Decision — reliability:** Retryable immutable uploads use a bounded attempt count; non-retryable or exhausted operations return a stable provider error. Rebuildable snapshots contain known opaque revision IDs and deterministic head sets. Tombstones are eligible for collection only after every active device checkpoint records observation.
- **Decision — encrypted vault bridge:** A root-derived XChaCha20-Poly1305 envelope authenticates the complete sync revision under vault/revision-bound AAD. It carries the already encrypted Task 4 item envelope as payload, so provider serialization reveals neither domain values nor DAG metadata. Legacy parentless Task 4 revisions receive deterministic migration metadata; subsequent local child revisions receive the current device HLC before their first upload.
- **Decision — durable integration:** IndexedDB version 4 adds immutable opaque sync objects, quarantine records, and conflict summaries while retaining all item revisions. Unsynced local item revisions are discoverable pending work; the coordinator writes their opaque sync objects durably before network upload. Imported revisions are collision-checked before deterministic heads are published.
- **Decision — conflicts:** Every concurrent head remains stored. A deterministic head supports stable presentation only; conflict summaries persist across restart and the shared UI explicitly reports how many versions require review.
- **Consequences:** The model is property-tested under arbitrary order/duplication and reused by Task 6. Provider ciphertext can be randomized for the same authenticated revision; duplicate locators are accepted only when decoded revisions are identical. Different authenticated content under one locator and its dependent chain are quarantined.
- **Rejected:** Provider-order dependence, mutable remote blobs, ETag-as-correctness, last-write-wins, wall-clock authorization, deleting one side of a conflict, accepting missing ancestry as current, and treating fake-provider JSON as production ciphertext.

## ADR-024: Focused 14-task industry-grade portfolio v1

- **Date:** 2026-07-25.
- **Status:** Accepted; supersedes the previous broad 30-task v1 scope while preserving Tasks 1–4 and their formats.
- **Context:** The previous roadmap combined a password manager, document wallet, standards-based credential wallet, government connector, secure-sharing service, multiple providers, software passkeys, SSH, payments, and release engineering. That scope was closer to several products and made a deeply tested, demonstrable portfolio release unlikely.
- **Decision:** V1 is a zero-knowledge password manager delivered through 14 sequential tasks. After the completed secure foundation and encrypted login/note CRUD, it includes immutable sync, Google Drive, secure MV3 sessions, exact-origin autofill/capture, password generation/TOTP/clipboard controls, tags/favorites/folders/encrypted search, CSV plus one Bitwarden importer, encrypted backup/restore, password-health/HIBP analysis, hardening/accessibility, and portfolio deployment.
- **Deferred:** WebDAV, cards/identities/addresses/attachments/payment fill, software passkeys, SSH, Secure Send, document storage/intelligence/authenticity/redaction, digital credentials/protocols, DigiLocker, and a richer account control plane. They remain documented future work and do not block v1.
- **Consequences:** Google Drive is the single production v1 provider. Existing document/credential key compartments remain reserved security foundations but do not imply shipped document/credential features. The smaller release raises the completion standard: every included feature requires migrations, failure states, security tests, accessible UX, reproducible artifacts, and an honest demo.
- **Rejected:** Continuing all 30 tasks as one portfolio v1; deleting historical design research; weakening security gates to retain breadth; and renumbering or rewriting completed Task 1–4 evidence.

## ADR-023: Task 4 encrypted immutable local item revisions

- **Date:** 2026-07-25.
- **Status:** Accepted and implemented for Task 4; multi-device ancestry, HLC, snapshots, provider projection, and conflict copies remain Task 5.
- **Context:** The first useful vault slice needs persistent login and secure-note CRUD without embedding a mutable item collection in the bootstrap header, deriving data keys from the password, exposing sensitive routing fields, or weakening the authenticated root-session lifecycle delivered by Tasks 2–3.
- **Decision — schemas and bounds:** Task 4 supports exact version-1 login and secure-note schemas only. Titles are non-empty and bounded to 512 UTF-8 bytes; usernames to 2,048 bytes; passwords and individual URIs to 8,192 bytes; URI lists to 32 entries; login notes to 65,536 bytes; and secure-note bodies to 1,048,576 bytes. Unknown fields, types, versions, malformed IDs, and over-bound values fail closed. Tags, folders, favorites, custom fields, search projections, TOTP, attachments, and other item types remain deferred.
- **Decision — immutable encryption:** Every create, update, and delete generates random opaque 16-byte item/revision identifiers, a new random 32-byte item key, independent 24-byte payload/wrapper nonces, and an immutable encrypted revision. A root-derived HKDF-SHA-256 key with label `zk-wallet/v1/general-item-key-wrap` wraps each item key. XChaCha20-Poly1305 AAD binds vault ID, item ID, revision ID, parent revision ID, operation, schema/envelope versions, algorithm, and purpose independently for the wrapper and payload. Deletes are authenticated tombstone payloads. Only opaque routing/version/envelope fields remain outside ciphertext.
- **Decision — storage and concurrency:** IndexedDB advances from database version 1 to 2 by adding `item-revisions` and `item-heads` stores while preserving the Task 3 `bootstrap` store. A single read-write transaction verifies the expected current head, adds the immutable revision, and publishes the new head. A stale editor loses with a conflict; last-write-wins is forbidden. Current local heads are acceleration state, not Task 5 sync snapshots.
- **Decision — service lifecycle:** Item operations are available only through an unlocked instance-scoped root session. Before key use they reconcile the authenticated bootstrap. Decrypted payloads are strict-schema validated, remain in client memory only, and are never returned as raw parser/crypto/persistence errors. Item counts are published only after committed head reads. Lock or a superseding lifecycle change prevents stale unlocked results.
- **Decision — UI:** Web and extension reuse one accessible item list and create/edit/delete flow. Password inputs are masked and cleared after save failure/success, cancel, lock, context loss, and unmount through the existing lifecycle. Deletion requires a scoped confirmation. The UI reports safe corruption/conflict guidance and never renders storage exceptions.
- **Rejected:** Password-derived item encryption; a mutable encrypted whole-vault blob; plaintext title/username/URI indexes; deterministic item keys/nonces; mutable-in-place revisions; last-write-wins; starting sync/device/HLC/provider behavior in Task 4; and direct cryptography from React.
- **Consequences:** Listing bounded Task 4 records decrypts each current head; encrypted rebuildable search/index projections remain Task 12. Local immutable ancestry is deliberately simpler than Task 5’s multi-device DAG but preserves parent and opaque revision identity for extension. JavaScript memory erasure remains best effort.
- **Evidence:** Strict schema/bounds tests, round-trip and plaintext-inspection tests, AAD substitution/ciphertext tamper tests, tombstone tests, IndexedDB v1-to-v2 preservation, concurrent CAS winner tests, CRUD/restart integration, generated-storage sentinel inspection, and shared UI creation/secret-clearing coverage. Full validation evidence is recorded in `20-progress.md`.
## ADR-022: Task 3 recovery, compartment, PRF, and authenticated session format

- **Date:** 2026-07-25.
- **Status:** Accepted and implemented for Task 3; independent assessment and real-browser/authenticator PRF compatibility remain release gates.
- **Context:** Task 3 extends the strict Task 2 bootstrap without bulk-encrypting data under passwords, loading sensitive compartment keys during ordinary unlock, adding server escrow, or starting item/sync/provider work. Existing V1 vaults require recoverable fail-closed migration, and mutable V2 wrappers/revisions require root-authenticated integrity rather than relying on independently authenticated envelopes alone.
- **Decision — Recovery Kit:** Generate 32 random bytes with the approved platform CSPRNG. Encode them with exact `@scure/base@2.2.0` Bech32m using human-readable prefix `zkwr`, first data word `1`, and the BIP-350 checksum. Display an uppercase grouped print representation once and normalize only ASCII spaces/hyphens plus whole-string case; mixed case, wrong prefix/version/length/checksum, and non-canonical values fail closed. The secret and any plaintext verifier are never persisted or logged. Creation/migration remains recovery-incomplete until re-entry authenticates all wrappers; an interrupted drill requires password-authenticated replacement rather than recovery-secret retrieval.
- **Decision — V2 key hierarchy and root-bound step-up:** `VaultHeaderV2` uses independent random 32-byte root, document, and credential keys. Master-password, Recovery Kit, and active WebAuthn PRF device slots each contain three independently authenticated XChaCha20-Poly1305 wrappers. HKDF-SHA-256 labels follow `zk-wallet/v2/<slot-kind>/<key-kind>-wrap`; wrapper AAD binds purpose, vault ID, slot ID, envelope/algorithm version, and schema. Ordinary unlock unwraps only root. Fresh compartment step-up must unwrap the selected slot's root, compare it with the active session root, and only then open that same slot's requested compartment wrapper. Compartment material is bounded to its short session.
- **Decision — strict V2 serialization and migration:** V2 has an integer revision of at least one, exactly one master slot, exactly one recovery slot, at most 16 active/revoked device records, a strict encrypted schema-v2 empty payload with Recovery Kit drill state, and a canonical 40-byte security tag. Exact fields, canonical fixed lengths, bounded KDF settings, unique slot/active-credential IDs, accepted algorithms, and decrypted schemas are mandatory. Every generated V2 create/replacement header is strictly parsed before persistence. V1 is read-only; authenticated password unlock generates compartment keys and Recovery Kit, then atomically migrates. Interrupted/conflicting migration leaves committed state authoritative.
- **Decision — root-authenticated complete header:** Derive a 32-byte key from the root and vault ID with HKDF label `zk-wallet/v2/header-authentication`. Canonically serialize every mutable V2 security field except `securityTag`—device slots, encrypted payload, format, master slot, minimum client version, recovery slot, revision, vault ID, and version—and authenticate it as XChaCha20-Poly1305 AAD over empty plaintext using a fresh 24-byte nonce. Store canonical base64url of `nonce || 16-byte tag` (40 bytes). This binds revision, payload, all wrappers/tombstones, and format markers without rewriting payload ciphertext during password rotation. V2 unlock, restore, and privileged reconciliation verify the tag.
- **Decision — freshness and reconciliation:** The active root session tracks its authenticated revision. A lower revision, invalid tag, replayed payload/slot/header component, or unauthenticated newer payload locks and fails with `VAULT_WRITE_CONFLICT`. A valid newer revision is adopted only after tag and payload authentication; document and credential sessions are cleared. A self-consistent old header on a fresh client remains indistinguishable from current state without a trusted external checkpoint, so immutable sync ancestry is still required later.
- **Decision — Recovery restore boundary:** Clean-profile restore accepts a strict tagged V2 bootstrap through a provider-neutral encrypted input plus Recovery Kit and new master password. It authenticates all three recovery wrappers, complete header, and payload before local creation, then replaces only the master slot and authenticated payload/drill revision. It does not implement export, immutable sync, Google Drive, or WebDAV; those remain Tasks 5–7 and 14.
- **Decision — WebAuthn PRF:** Use native WebAuthn Level 3 `prf` behind a project-owned provider. Offer enrollment only when `getClientCapabilities()` reports `extension:prf === true`; require PRF-enabled creation evidence and a fresh assertion returning exactly 32 bytes. Ceremonies use random challenges, random per-slot 32-byte input, `userVerification: "required"`, generic local-vault metadata, and no attestation. Creation-time output is not assumed. Rejected/malformed outputs and controllable PRF inputs are wiped best effort. A signature is never a PRF substitute. Unsupported/canceled/incompatible clients retain password and Recovery Kit paths.
- **Decision — target surfaces and compatibility:** HTTPS web and secure browser-extension origins may offer PRF only through runtime gates. Chromium extension pages use their stable extension origin and leave RP ID fields unset so the browser applies its extension-specific default; no broad host permission or third-party biometric service is required. A transient AutoFill ceremony may unlock, release one exact-origin login, and immediately relock without leaving the manager session open. Multiple devices require explicit slot selection. Unsupported platforms fall back to the master password or Recovery Kit, and no browser/authenticator combination is claimed compatible until the release matrix is exercised with real platform evidence.
- **Decision — revocation and password change:** Revocation atomically replaces an active device slot with a wrapper-free tombstone and rejects it before ceremony. It is prospective after state propagation, not retroactive erasure. Password change authenticates the current slot and active root, calibrates a new KDF/salt, and rewraps unchanged random root/document/credential keys. Payload, recovery, and device wrapper ciphertext remain unchanged; the revision and full-header tag change.
- **Decision — persistence and conflict losers:** Compare-and-replace is conditioned on vault ID, format version, and revision. Drill completion, Recovery Kit replacement, device enrollment/revocation, password change, and migration increment revision and create a fresh tag. A CAS loser locks immediately, wipes compartment/session buffers best effort, reloads the winner's locked summary when safe, and returns a non-sensitive conflict; stale unlocked continuation and last-write-wins are forbidden.
- **Decision — session and error policy:** Root idle auto-lock defaults to five minutes (accepted bounds one to 60 minutes). Document/credential sessions have a non-sliding 60-second hard expiry (accepted bounds 15 seconds to five minutes) and never outlive root. Lock, unmount, expiry, reconciliation, conflicts, and superseding operations advance generation/cancel timers so in-flight work cannot reinstall keys. UI activity resets only root idle time. Wrong-secret/corruption errors collapse by method, but operational `CRYPTO_UNAVAILABLE`, KDF-policy, and unsupported-version failures remain distinguishable through password/device/recovery unlock, restore, and verification.
- **Decision — shared UI secret lifecycle:** Web and extension use one accessible flow for password, Recovery Kit, and explicit-device unlock/step-up. Submitted secrets and abandoned ceremony state are cleared on submission, failure, method switch, auto/conflict lock, recovery-context change, and unmount. Crypto-unavailable guidance is retryable and does not falsely label the credential as incorrect.
- **Rejected:** BIP-39 word lists; custom checksum/MAC/hash constructions; HKDF with the entire header as oversized `info`; plaintext recovery verifiers; persisted Recovery Kit/PRF output; ordinary compartment unlock; step-up without same-slot root authentication; signature-derived fake PRF; broad extension host permissions; unauthenticated mutable header fields; old payload-only authentication without revision/wrapper binding; last-write-wins; stale-session continuation after CAS loss; guaranteed JavaScript zeroization claims; password-derived payload keys or bulk payload re-encryption; and early Drive/WebDAV/item work.
- **Consequences:** Header authentication adds one root-key verification operation and fresh nonce/tag per mutation while preserving payload ciphertext where required. Capability/browser/authenticator behavior remains variable. JavaScript erasure and UI string cleanup are best effort; Recovery Kit display necessarily creates immutable runtime strings. Timers are exposure controls, not protection against a compromised unlocked endpoint. V2 migration is one-way after atomic commit while V1 remains parseable for retry before commit.
- **Implementation evidence:** Task 3 tests cover strict Recovery Kit handling, independent wrappers, V1 migration, clean-profile restore/corruption rollback, complete-header tamper/replay/rollback, root-bound step-up, compartment/root expiry, PRF capability/output/races, tombstone revocation, password rewrap invariants, CAS loser lock/reload, encrypted persistence, and shared accessible UI lifecycle. The final behavior-level semantic review reported no actionable findings. This is not external audit or real-authenticator evidence.
- **Sources:** [WebAuthn Level 3 PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [WebAuthn client capabilities](https://www.w3.org/TR/webauthn-3/#sctn-getClientCapabilities), [MDN WebAuthn extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf), [MDN WebAuthn in extensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api), and [BIP-350](https://bips.dev/350/) support the selected boundaries. Exact `@scure/base@2.2.0` npm metadata was checked for version, MIT license, repository, integrity, zero dependencies, conformance records, and audit history.

Content from external sources was rephrased for compliance with licensing restrictions.
