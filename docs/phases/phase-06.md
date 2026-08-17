# Phase 6 — Delegation and concurrency

**Depends on:** Phase 5

## Build
- `agent_delegate`
- delegation graph validation
- maximum depth / maximum child count
- Task claims
- process isolation
- worktree isolation
- Project concurrency pool
- idempotency protection

## Exit criteria
- unauthorized delegation fails
- cycles fail
- parallel coding Runs use separate worktrees
- the same exclusive Task cannot run twice
- duplicate external events do not duplicate work

Acceptance tests 20–21, 25–30.
