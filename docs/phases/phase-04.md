# Phase 4 — Project State

**Depends on:** Phase 1 schemas; uses Phase 2 Project layout

## Build
- repository State adapter (`state:repository`)
- Task / Result / Decision / Approval / Verification stores
- Event log (append-only JSONL)
- atomic writes
- lock and lease handling
- revision checks

## Exit criteria
- State survives process restart
- conflicting writes are rejected
- stale claims can be recovered
- Events are append-only
- no partial State writes remain after failure

## Defaults (spec §8.3)
`decisions: git`; tasks/results/approvals/verifications/events: `local`; runtime: `ephemeral`.
