# Portfolio V1 Release Runbook

## Reproducible validation

Use Node 24.11.0 and pnpm 11.10.0.

1. `CI=true pnpm install --frozen-lockfile`
2. `CI=true pnpm check`
3. Hash the lockfile, web output, Worker output, and extension archives.
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
7. In the unpacked extension, verify exact-origin fill/capture, HTTP/look-alike/frame refusal, TOTP,
   worker restart, timeout, and browser-restart lock.
8. With a configured test OAuth client only, verify Drive sync, clean-profile recovery, quota,
   offline, expiry, and revocation states.

## Migration and rollback

- IndexedDB migrations are forward-only and versioned. Before upgrading, export an encrypted
  archive and verify the Recovery Kit.
- Roll back deployment by restoring the previous immutable static build and Worker version. Never
  downgrade or rewrite a migrated user database in place.
- If a release is withdrawn, preserve the encrypted backup/restore path and publish the affected
  artifact hashes. Users can restore into a corrected clean profile.

## External gates that cannot be manufactured locally

- The private production URL exists at
  `https://zero-knowledge-wallet-v1.abhigurkar3303.chatgpt.site`; its authenticated application
  smoke still requires the owner to authorize ChatGPT sign-in.
- Google OAuth consent/domain/client configuration and a real test-account matrix.
- Chrome/Firefox store signing or acceptance.
- Representative-device/browser/OS WebAuthn PRF and KDF measurements.
- Independent security or accessibility review.

Until evidence is attached, describe outputs as local reproducible artifacts—not deployed,
store-published, audited, or universally compatible.
