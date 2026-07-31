# Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Git
- Firebase project (required for auth, sync, and notifications)

### Installation

```bash
# Clone the repository
git clone https://github.com/brandonstrohmeyer/livegrid.git
cd livegrid

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

## Project Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm test             # Run tests in watch mode
npm run test:ui      # Open Vitest UI
npm run test:run     # Run tests once (CI mode)
```

Version bump options (default is patch):
```bash
npm run build --bump=patch
npm run build --bump=minor
npm run build --bump=major
```

## Logging

Logging is expected to use explicit severity and structured context. Follow the severity rules and examples in `docs/LOGGING.md`.

## Environment Variables

Frontend env is mode-specific:

- `.env.development` for the dev Firebase project
- `.env.production` for the prod Firebase project
- `.env.local` or `.env.development.local` for machine-specific overrides

Functions env is project-specific inside `functions/`:

- `functions/.env.dev`
- `functions/.env.prod`
- `functions/.env.local` for local overrides

For local Functions emulation, put `GOOGLE_SHEETS_API_KEY` in `functions/.env.local`.
Deployed functions use Secret Manager `SHEETS_API_KEY`.

Admin console access is server-enforced by `adminEvents`. Grant users with a
Firebase Auth custom claim (`livegridAdmin: true` or `admin: true`) or by
setting comma-separated Functions env vars:

```
LIVEGRID_ADMIN_UIDS=uid-1,uid-2
LIVEGRID_ADMIN_EMAILS=admin@example.com
```

Use the helper script to add or remove the `livegridAdmin` claim. It calls the
Identity Toolkit API with the active `gcloud` access token and an explicit quota
project header.

```bash
npm run admin:set -- --project dev --email user@example.com
npm run admin:set -- --project prod --email user@example.com
npm run admin:unset -- --project dev --email user@example.com
```

Project aliases `dev` and `prod` resolve to `livegrid-dev-7acfc` and
`livegrid-c33c6`. The user must sign out and sign back in after the claim
changes so their Firebase ID token includes the latest custom claims.

Frontend variables:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_FIREBASE_VAPID_KEY=...

# Optional when developing against the Functions emulator
VITE_FUNCTIONS_BASE_URL=http://localhost:5001/<project-id>/us-central1

# Optional logging control
VITE_LOG_LEVEL=debug
```

Notes:
- `VITE_FIREBASE_VAPID_KEY` is required for web push.
- `VITE_FUNCTIONS_BASE_URL` lets the frontend call the Functions emulator.
- `npm run dev` reads `.env.development`.
- `npm run build` reads `.env.production`.
- Terraform now manages the base Firebase Auth config and authorized domains. To have Terraform also manage Google sign-in, provide `TF_VAR_firebase_auth_google_client_id` and `TF_VAR_firebase_auth_google_client_secret`.
- `firebase deploy --only hosting --project dev` now builds in Vite `development` mode automatically.
- After any manual deploy that creates or updates Hosting-backed 2nd gen functions, run `npm run firebase:postdeploy:public-routes -- --project <project-id>`.
- Follow that with `npm run firebase:verify:public-routes -- --project <project-id>` to confirm the Cloud Run access state actually stuck.
- If the deployment inherits an old plain runtime key, run `npm run firebase:cleanup:legacy-sheets-env -- --project <project-id>` to remove the stale `GOOGLE_SHEETS_API_KEY` override from `sheetsApi` and `systemHealth`.
- Then run `npm run firebase:verify:sheets-runtime -- --project <project-id>` to confirm `sheetsApi` and `systemHealth` are still using Secret Manager `SHEETS_API_KEY` instead of a stale `GOOGLE_SHEETS_API_KEY`.
- That sync is required in this repo because organization policy blocks the usual `allUsers` Cloud Run invoker path for newly deployed public functions.
- Put emulator-only frontend overrides in `.env.development.local`, not `.env.development`.
- `npm run dev:full` starts the Firebase emulators against the `dev` alias and loads Functions env from `functions/.env.dev`, plus any machine-local overrides from `functions/.env.local`.
- Start from `functions/.env.local.example` when you need a local Functions override file.

## Firebase Services

### Terraform

Terraform is applied locally; there is no GitHub Actions workflow that runs `terraform plan` or `terraform apply`.

Terraform state uses the GCS backend in `terraform/backend.tf`:

```text
bucket = "stro-livegrid-tfstate"
prefix = "terraform/state"
```

Workspace names are short environment names:

- Dev: `dev`
- Prod: `prod`

Use the matching tfvars file for each workspace:

```bash
cd terraform

terraform init

terraform workspace select dev
terraform plan -var-file=development.tfvars
terraform apply -var-file=development.tfvars

terraform workspace select prod
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars
```

Authenticate locally with Google Cloud before running Terraform:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project livegrid-dev-7acfc
gcloud auth application-default set-quota-project livegrid-dev-7acfc
```

For production, switch the active project and quota project to `livegrid-c33c6` before planning or applying.

### Auth + Preferences Sync

- Sign-in supports Google, Apple, and email/password.
- Preferences are stored locally when signed out.
- When signed in, preferences sync to Firestore under `users/{uid}`.

Manual Google sign-in setup after Terraform:

1. Run `terraform apply` for the target workspace first. This config now enables Firebase Auth itself, turns on email/password sign-in, and manages the authorized domains.
2. Run `terraform output firebase_auth_google_hosted_origins` and `terraform output firebase_auth_google_hosted_redirect_uris` to get the exact hosted origins and `__/auth/handler` redirect URIs for that environment.
3. In the Firebase console, open `Authentication` -> `Sign-in method` -> `Google`, enable the provider, and choose the support email.
4. If Firebase prompts for or links you to an OAuth client, use the Terraform outputs for the hosted origins and redirect URIs.
5. Retry sign-in. Once Google sign-in works, optionally capture the resulting OAuth client id/secret and feed them back into Terraform with `TF_VAR_firebase_auth_google_client_id` and `TF_VAR_firebase_auth_google_client_secret` so Terraform can manage the Google provider state too.

### Cloud Functions + Hosting

Functions power the RSS proxy and push endpoints:

- `POST /api/register-push-token`
- `POST /api/unregister-push-token`
- `POST /api/send-push-notification`

Health monitoring uses:

- `/healthz.json` for static Hosting liveness
- `/api/health` for backend readiness plus a live Sheets probe and Firebase Auth configuration checks for the deployed host

Deploy with:

```bash
firebase deploy --only functions,hosting --project dev
npm run firebase:postdeploy:public-routes -- --project livegrid-dev-7acfc
npm run firebase:verify:public-routes -- --project livegrid-dev-7acfc
npm run firebase:cleanup:legacy-sheets-env -- --project livegrid-dev-7acfc
npm run firebase:verify:sheets-runtime -- --project livegrid-dev-7acfc
```

CI already runs that post-deploy sync automatically for production.

## Notifications Overview

The notification system is client-driven. The app must remain open (foreground or background) to schedule pushes.

Flow:
1. User enables notifications in the sidebar.
2. Client registers the service worker and obtains an FCM token.
3. Token is registered with Functions and stored in Firestore.
4. While the app runs, upcoming sessions trigger push sends.

## Adding a New Schedule

1. Export schedule as CSV from your source.
2. For the debug UI, place it in `public/test-schedules/[event-name].csv`.
3. Add it to the debug dropdown in `App.jsx` if needed.
4. For automated parser tests, add the file to `src/schedule/parsers/<parserId>/fixtures/` and update the manifest.

## Adding a New Parser

1. Create a new parser module in `src/schedule/parsers/` that returns a `NormalizedSchedule`.
2. Add any organization-specific helpers in a subfolder (e.g., `src/schedule/parsers/<id>/`).
3. Register the parser in `src/schedule/parsers/registry.js`.
4. Add fixtures under `src/schedule/parsers/<id>/fixtures/` and a `manifest.json`.
5. Add a focused parser test under `src/schedule/parsers/`.
6. Document the CSV rules in `docs/PARSERS.md`.
7. Use the HOD-MA parser (`src/schedule/parsers/hodMaParser.js`) as a reference implementation.

## CSV Format Guidelines

Parser CSV formats are defined per organization. See `docs/PARSERS.md` for details.

Example (NASA-SE):

```csv
Friday,,Registration,,,
8:00 AM,30,HPDE 1,,,"On Track"
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
```

## Debug Mode

Enable via the footer button:
- Clock offset (+/- 12 hours)
- Day offset (+/- 7 days)

## Building for Production

```bash
npm run build
```

Output is generated in `dist/`.

## Deployment Options

1. Static hosting (Netlify, Vercel, GitHub Pages)
2. Web server (nginx, Apache)
3. Kiosk mode (Chrome fullscreen)

Kiosk example:

```bash
chrome --kiosk --app=http://your-url
```
