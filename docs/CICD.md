# CI/CD

This repository uses GitHub Actions for pull request validation, release-candidate promotion, tagged releases, and Firebase deployments.

## Workflows

### PR CI

`.github/workflows/pr-ci.yml` runs on pull requests targeting `develop` or `main` and splits validation into four jobs:

- unit/component tests via `npm run test:run`
- build validation via `npm run test:build`
- emulator-backed integration tests via `npm run test:integration`
- Playwright smoke coverage via `npm run test:e2e`

## RC flow

`.github/workflows/release-rc.yml` runs on pushes to `develop`.

- The workflow resolves the merged PR for the merge commit.
- RC bump is chosen from PR labels:
  - `release:major`
  - `release:minor`
  - `release:patch`
- If no release label is present, the workflow defaults to `patch`.
- If more than one release label is present, the workflow fails without creating a tag.
- The workflow computes the next release-candidate tag using `vX.Y.Z-rc.N`.
- The RC tag triggers `.github/workflows/deploy-dev.yml`, which deploys to the Firebase `dev` environment.

## Release flow

`.github/workflows/release.yml` runs on pushes to `main`.

- The workflow finds the latest merged RC tag reachable from the promoted `main` commit.
- That RC tag is converted into the final `vX.Y.Z` release tag.
- The workflow pushes the release tag with the `RELEASE_PAT` personal access token so the tag push triggers downstream workflows such as `.github/workflows/deploy.yml`.

## Deploy flow

`.github/workflows/deploy-dev.yml` deploys Firebase on:

- a pushed RC tag such as `v0.2.25-rc.1`
- a manual `workflow_dispatch` where you provide an existing RC tag for redeploy

The dev deploy job checks out the exact RC tag, regenerates `build.json`, builds the app and functions, runs `firebase deploy --only functions,hosting`, runs `npm run firebase:postdeploy:public-routes -- --project "$FIREBASE_PROJECT_ID"`, removes any stale `GOOGLE_SHEETS_API_KEY` overrides from the Hosting-backed Sheets services, then verifies both the Cloud Run access state and the Sheets runtime config with `npm run firebase:verify:public-routes -- --project "$FIREBASE_PROJECT_ID"` and `npm run firebase:verify:sheets-runtime -- --project "$FIREBASE_PROJECT_ID"`.

`.github/workflows/deploy.yml` deploys Firebase on:

- a pushed semver tag such as `v0.2.25`
- a manual `workflow_dispatch` where you provide an existing tag for rollback or redeploy

The deploy job checks out the exact tag, regenerates `build.json`, builds the app and functions, runs `firebase deploy --only functions,hosting`, runs `npm run firebase:postdeploy:public-routes -- --project "$FIREBASE_PROJECT_ID"`, removes any stale `GOOGLE_SHEETS_API_KEY` overrides from the Hosting-backed Sheets services, then verifies both the Cloud Run access state and the Sheets runtime config with `npm run firebase:verify:public-routes -- --project "$FIREBASE_PROJECT_ID"` and `npm run firebase:verify:sheets-runtime -- --project "$FIREBASE_PROJECT_ID"`.

That post-deploy sync applies Cloud Run's `--no-invoker-iam-check` setting to the functions referenced by `firebase.json` Hosting rewrites. This is a required part of deployment for this repo, because Firebase alone cannot make those Hosting-backed 2nd gen functions reachable in projects where organization policy blocks granting `allUsers` the Cloud Run invoker role.

For local manual deploys, treat that sync step as part of the deploy contract too:

```bash
firebase deploy --only functions,hosting --project <alias>
npm run firebase:postdeploy:public-routes -- --project <project-id>
npm run firebase:verify:public-routes -- --project <project-id>
npm run firebase:cleanup:legacy-sheets-env -- --project <project-id>
npm run firebase:verify:sheets-runtime -- --project <project-id>
```

## Required GitHub configuration

Branch protection cannot be stored in the repo. Configure it in GitHub:

- create and protect `main`
- create and protect `develop`
- require pull requests before merging
- require the PR CI workflow checks to pass before merge
- block direct pushes to `develop` and `main`

## Required GitHub environments

The deploy workflows use GitHub environments named `dev` and `prod`.

Each environment should define these as environment `vars` with environment-specific values:

- `FIREBASE_PROJECT_ALIAS`
- `FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIREBASE_VAPID_KEY`

Each environment should define these as environment secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

## Required secrets

Add these repository-level secrets before enabling release tagging:

- `RELEASE_PAT`

`SHEETS_API_KEY` should remain managed in Firebase / Google Secret Manager for the deployed functions.

## Local version commands

Builds no longer auto-increment on every `npm run build`.

- `npm run build` ensures `build.json` exists and builds without bumping
- `npm run build:patch` bumps patch and builds
- `npm run build:minor` bumps minor and builds
- `npm run build:major` bumps major and builds
