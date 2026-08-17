# Phase 3 — Safe ownership and updates

**Depends on:** Phase 2

## Build
- file hashing
- `diff`
- three-way update planning
- `update`
- `remove`
- generated configuration fragments
- compatibility checks

## Exit criteria
- local edits are detected
- unchanged files update safely
- conflicting files stop the update
- modified files are not removed
- shared dependencies remain installed

## Rules
Three-way: base = installed registry version, local = user file, upstream = requested version. V1 MUST NOT silently overwrite conflicts. No destructive `--force` in V1.

Acceptance tests 7–11.
