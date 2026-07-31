# Repository Agent Notes

## Branch Hygiene

- `main` and `develop` are integration branches, not feature branches.
- Do not modify `main` or `develop` directly.
- Before making code, test, docs, or config changes, create or switch to a feature branch.
- After an old feature branch has been merged, always open a new branch for additional work.
- Before starting or continuing feature work, rebase the feature branch from `origin/develop`.
- Before pushing commits to an existing pull request branch or updating pull request metadata, check the pull request status.
- If the pull request is already merged or closed, do not update it; create a fresh branch from `origin/develop` and open a new pull request.
- When opening a pull request, make sure the branch is set to be deleted after merge.
- Changes should reach `main` or `develop` through a pull request unless the user explicitly instructs otherwise.

## Communication

- Let success be quiet. Do not include validation details in chat responses, pull request descriptions, merge request descriptions, or release-style notes unless the user explicitly asks for them.
- Mention validation only when a check fails, cannot be run, is incomplete, or materially changes the risk of the work.
