# CI/CD

This repository uses GitHub Actions for pull request validation, tagged releases, and Firebase deployments.

## Workflows

### PR CI

`.github/workflows/pr-ci.yml` runs on pull requests targeting `main` and splits validation into four jobs:

- unit/component tests via `npm run test:run`
- build validation via `npm run test:build`
- emulator-backed integration tests via `npm run test:integration`
- Playwright smoke coverage via `npm run test:e2e`

## Release flow

`.github/workflows/release.yml` runs on pushes to `main`.

- The workflow resolves the merged PR for the merge commit.
- Release bump is chosen from PR labels:
  - `release:major`
  - `release:minor`
  - `release:patch`
- If no release label is present, the workflow defaults to `patch`.
- If more than one release label is present, the workflow fails without creating a tag.
- The next version is calculated from the latest `vX.Y.Z` git tag. If no matching tag exists yet, version bootstrap falls back to `0.2.24`.
- The workflow pushes the release tag with the `RELEASE_PAT` personal access token so the tag push triggers downstream workflows such as `.github/workflows/deploy.yml`.

## Deploy flow

`.github/workflows/deploy.yml` deploys Firebase on:

- a pushed semver tag such as `v0.2.25`
- a manual `workflow_dispatch` where you provide an existing tag for rollback or redeploy

The deploy job checks out the exact tag, regenerates `build.json`, builds the app and functions, then runs `firebase deploy --only functions,hosting`.

## Required GitHub configuration

Branch protection cannot be stored in the repo. Configure it in GitHub:

- create and protect `main`
- require pull requests before merging
- require the PR CI workflow checks to pass before merge
- block direct pushes to `main`

## Required secrets

Add these repository or environment secrets before enabling deploys:

- `RELEASE_PAT`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIREBASE_VAPID_KEY`

`SHEETS_API_KEY` should remain managed in Firebase / Google Secret Manager for the deployed functions.

The deploy workflow uses the GitHub environment named `prod`, so environment-scoped deploy secrets must be stored there.

## Local version commands

Builds no longer auto-increment on every `npm run build`.

- `npm run build` ensures `build.json` exists and builds without bumping
- `npm run build:patch` bumps patch and builds
- `npm run build:minor` bumps minor and builds
- `npm run build:major` bumps major and builds
