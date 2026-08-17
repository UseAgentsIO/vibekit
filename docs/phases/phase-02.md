# Phase 2 — Registry and CLI foundation

**Depends on:** Phase 1
**Unlocks:** Phase 3, Phase 8 catalog install path

## Build
- registry index
- Module loader
- dependency graph
- conflict detection
- capability resolution
- file target validation
- `init`, `add`, `list`
- installed manifest

## Exit criteria
- a clean Pi fixture can be initialized
- one Component can be installed
- one Agent can install required dependencies
- ownership is recorded
- failed installation rolls back

## CLI (spec §16.1–16.3)
`vibekit init` · `vibekit add <type> <name>` · `vibekit list`

## Notes
Official registry lives in-repo at `registry/`. Atomic staging (spec §17.4). Show requested permissions before apply. Secrets are references only.

Acceptance tests 1–6, 12–16 are the Phase 2 gate (as far as they do not require later runtime).
