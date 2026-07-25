# Zero-Knowledge Wallet

An encrypted, browser-first password manager portfolio project. Vault content, keys, master
passwords, Recovery Kits, and Google OAuth tokens remain in the client. Google Drive receives only
authenticated ciphertext in its hidden `appDataFolder`.

## Run locally

```sh
CI=true pnpm install --frozen-lockfile
pnpm dev:web
```

Open `http://127.0.0.1:5173` in a normal Chrome or Firefox profile. The Codex in-app preview does
not expose Web Crypto or IndexedDB and therefore cannot operate the vault.

## First use

1. Create a vault with a strong master password.
2. Save and re-enter the Recovery Kit. Losing every unlock method is unrecoverable.
3. Add login and secure-note records.
4. Download an encrypted backup before clearing browser data.

## Enable Google Drive BYOS

1. Create or select a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen. During testing, add your Google account as a test user.
3. Create an OAuth client of type **Web application**.
4. Add `http://127.0.0.1:5173` as an authorized JavaScript origin.
5. Add `http://127.0.0.1:5173/oauth/google/callback` as an authorized redirect URI.
6. Copy the public client ID ending in `apps.googleusercontent.com`.
7. Unlock the vault, paste that client ID under **Google Drive encrypted sync**, and select
   **Connect and sync encrypted vault**.

The app requests only `https://www.googleapis.com/auth/drive.appdata`. The access token stays in
memory and is discarded on disconnect or page restart. Each successful sync also updates an
encrypted Recovery-Kit-protected archive so a clean browser profile can use **Restore directly from
Google Drive**.

## Enable Microsoft OneDrive BYOS

1. Register a single-page application in Microsoft Entra.
2. Add delegated Microsoft Graph permission `Files.ReadWrite.AppFolder`.
3. Add the redirect URI
   `http://127.0.0.1:5173/oauth/microsoft/callback`.
4. Allow personal Microsoft accounts if you want consumer OneDrive support.
5. Unlock the vault, paste the public application client ID under
   **Microsoft OneDrive encrypted sync**, and select **Connect and sync with OneDrive**.

The web client uses OAuth authorization code with PKCE. Access tokens are retained only in memory.
OneDrive receives authenticated ciphertext in the application's dedicated folder. A clean profile
can restore from the encrypted recovery archive using the original Recovery Kit.

Google still observes account identity, request timing, object sizes, and access patterns. This
portfolio build has not received an independent security audit; use synthetic data during review.

## Validation

`CI=true pnpm check` runs formatting/lint, strict TypeScript, tests, production builds, and artifact
checks. See [`docs/20-progress.md`](docs/20-progress.md) and
[`docs/33-v1-release-runbook.md`](docs/33-v1-release-runbook.md).
