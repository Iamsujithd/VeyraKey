# Release evidence

Run `CI=true pnpm release:verify` from the repository root. The command creates
`release-manifest.json` only after lint, strict typechecking, the full automated suite, all
production builds, and artifact/security validation pass.

The manifest records the product version, source revision and working-tree state, artifact sizes,
SHA-256 hashes, automated gates, and external gates. It intentionally labels the result a local
release candidate: OAuth consent with a release-owner account, browser-store signing, physical
biometric testing, and independent security/accessibility assessment cannot be manufactured by a
local build.
