# Repository Agent Notes

## Branch Hygiene

- `main` and `develop` are integration branches, not feature branches.
- Do not modify `main` or `develop` directly.
- Before making code, test, docs, or config changes, create or switch to a feature branch.
- Changes should reach `main` or `develop` through a pull request unless the user explicitly instructs otherwise.
