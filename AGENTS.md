# Repository Agent Notes

## Branch Hygiene

- `main` and `develop` are integration branches, not feature branches.
- Do not modify `main` or `develop` directly.
- Before making code, test, docs, or config changes, create or switch to a feature branch.
- After an old feature branch has been merged, always open a new branch for additional work.
- Before starting or continuing feature work, rebase the feature branch from `origin/develop`.
- When opening a pull request, make sure the branch is set to be deleted after merge.
- Changes should reach `main` or `develop` through a pull request unless the user explicitly instructs otherwise.
