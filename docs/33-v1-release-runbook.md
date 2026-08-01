# Portfolio V1 Release Runbook

## Reproducible validation

Use Node 24.11.0 and pnpm 11.10.0.

1. `CI=true pnpm install --frozen-lockfile`
2. `CI=true pnpm release:verify`
3. Review `release/release-manifest.json`, including its source-tree state and SHA-256 hashes.
4. Test with synthetic credentials in clean Chrome and Firefox profiles.

The final gate includes lint, strict TypeScript, unit/property/integration/chaos tests, all
production builds, source-map/secret scanning, exact extension-permission review, a 900 kB
per-JavaScript-chunk ceiling, and CycloneDX SBOM validation.

## Production smoke script

1. Create a vault, save the Recovery Kit, pass the recovery drill, lock, and unlock.
2. Add/edit/delete a login and secure note; restart and verify encrypted persistence.
3. Create offline conflicts on two synthetic devices, reconnect, and verify convergence plus a
   conflict copy.
4. Import the CSV and Bitwarden fixtures, verify duplicates are unselected, and test rollback.
5. Export an encrypted archive and restore it into a clean profile.
6. Run local password health and one fixture HIBP check while online; repeat offline.
7. In the unpacked extension, verify exact-origin fill/capture, case-insensitive username matching,
   prompt suppression after a mismatch, HTTP/look-alike/frame refusal, TOTP, worker restart,
   timeout, and browser-restart lock.
8. On synthetic registration, login, and checkout fixtures, verify signup-only strong-password
   generation, confirmation-field parity, explicit encrypted save, identity-profile selection,
   and no profile/password confusion.
9. With a configured test OAuth client only, verify cloud-first setup, explicit local-only setup,
   later migration, clean-profile recovery, quota, offline, expiry, and revocation states.
10. Verify automatic breach status on save/update plus manual online and offline rechecks.

## Local Google OAuth configuration

Enable the Google Drive API, configure an OAuth consent test user, and create a Web application
client. Register `http://127.0.0.1:5173` as the JavaScript origin,
`http://127.0.0.1:5173/oauth/google/callback` as the web redirect, and the pinned extension
`chromiumapp.org` redirect. The application owner compiles the public client ID through
`VITE_GOOGLE_CLIENT_ID`; end users choose **Connect Google Drive** and never enter OAuth
application credentials. No client secret belongs in either browser application.

## Migration and rollback

- IndexedDB migrations are forward-only and versioned. Before upgrading, export an encrypted
  archive and verify the Recovery Kit.
- Roll back deployment by restoring the previous immutable static build and Worker version. Never
  downgrade or rewrite a migrated user database in place.
- If a release is withdrawn, preserve the encrypted backup/restore path and publish the affected
  artifact hashes. Users can restore into a corrected clean profile.

## External gates that cannot be manufactured locally

- Hosted deployment is intentionally disabled. The current portfolio release is run locally.
- Google OAuth consent/domain/client configuration and a real test-account matrix.
- Chrome/Firefox store signing or acceptance.
- Representative-device/browser/OS WebAuthn PRF and KDF measurements.
- Independent security or accessibility review.

Until evidence is attached, describe outputs as local reproducible artifacts—not deployed,
store-published, audited, or universally compatible.

## Release candidate output

The automated command aligns the root, extension-package, Chrome-manifest, and Firefox-manifest
versions; builds the web, Worker, and both MV3 targets; recreates every browser/source archive;
verifies the reviewed extension boundary; and hashes the lockfile, SBOM, deploy entry points,
browser archives, and source archive. CI retains
the three extension archives together with the SBOM and machine-readable release manifest.

The source state is recorded as `clean` or `modified`. A public tag must be cut only from a clean,
reviewed commit, after the applicable external evidence above is attached.
