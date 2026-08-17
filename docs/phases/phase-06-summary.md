# Phase 6 summary — Delegation and concurrency

Phase 6 adds `agent_delegate`, delegation-graph checks, Task claims, process/worktree isolation, the Project concurrency pool, and idempotency keys under `packages/pi`. Verifiers, apply, and Approval stay in Phase 7.

`pnpm typecheck` and `pnpm test` both pass in this workspace.

## Test results

```text
pnpm typecheck          → tsc -b  (pass)
pnpm test               → 36 files, 198 tests passed
```

| File | Tests |
| --- | ---: |
| `tests/runtime/delegate.test.ts` | 10 |
| `tests/runtime/concurrency.test.ts` | 5 |
| `tests/runtime/worktree.test.ts` | 4 |
| `tests/runtime/idempotency.test.ts` | 3 |
| existing `tests/runtime/*` | 30 (unchanged) |

Exit criteria covered (mocked Pi session, same pattern as Phase 5):

- unauthorized delegation fails (`permission_denied` / `delegation_unauthorized`)
- missing target bindings fail (`delegation_target_missing`)
- Tasks that forbid delegation fail (`delegation_task_forbidden`)
- self-cycles, ancestor cycles, and cyclic Project graphs fail (`delegation_cycle`)
- max depth and max parallel children fail closed
- a child Run receives a new bounded Task — not the parent conversation
- `agent_delegate` is registered only when the Agent has `agent.delegate`
- exclusive Task claims prevent a second active Run; expired leases recover
- `maxParallelRuns` rejects a third concurrent Run
- process isolation plans strip unrelated credentials and can spawn a filtered child
- parallel coding Runs use separate git worktrees; cleanup runs after success, cancel, timeout, and failure
- the same external event key does not start the same consequential Task twice

Acceptance tests 20–21 and 25–30 as far as unit/integration tests allow. 22 (parent+child cancellation propagation) is only covered for a single managed Run; live Pi multi-process trees stay later. 27–28 (revision/atomic writes) remain Phase 4 State tests.

## What is real

- Delegation validation: Agent contract, Project relationship, target binding, Task permission, max depth, max children, cycle rejection
- `agent_delegate` tool name + callable helper; registered through `CAPABILITY_TOOL_MAP` only when `agent.delegate` is granted
- Child Task assembly from objective / context / constraints / expected output / optional Task ID
- `runManaged`: idempotency → pool → recover claims → exclusive claim → optional worktree → isolated Run → cleanup
- Process isolation plan: `filterEnvironment` + spawn argv/env/cwd + stub child protocol (`start` / `abort` / `result`)
- Git worktrees under `.vibekit/runtime/worktrees/<runId>`; `cwd` is the worktree path
- File-backed or in-memory `maxParallelRuns` pool
- Idempotency store: reserve before Run creation; duplicate keys return `status: "duplicate"`

## What is deferred

| Item | Why |
| --- | --- |
| Full child Node protocol for every Run | Stub + spawn plan + env-stripping tests. In-process `runIsolated` still used with injected `createSession`. |
| Persist Events / Results from managed Runs | Phase 4 stores exist; adapter returns objects unless the caller writes them. |
| Parent abort propagating to live child processes | Single-run cancel/timeout cleanup is tested. Multi-process trees need the child protocol. |
| Verifiers, apply, Approval | Phase 7. |
| CLI `run` / Interface trigger | Later phase. |

## Public API additions

`validateDelegation(request, context)` — fail-closed graph and contract checks.

`executeDelegation(request, input)` — validate, build/select a child Task, `runManaged` the target binding.

`runManaged(input)` — claim, pool, worktree, isolation plan, then `runIsolated`. Same `createSession` injection as Phase 5.

`createAgentDelegateTool({ execute })` — Pi-facing tool descriptor (`name`, `parameters`, `execute`).

`planProcessIsolation` / `spawnIsolatedProcess` / `createWorktree` / `createConcurrencyPool` / `createIdempotencyStore`.

`runIsolated` / `prepareIsolatedRun` public shapes are unchanged. Optional managed fields were appended to `IsolatedRunInput`.

## Files created or extended

### Package (`packages/pi/src/`)

- `delegate.ts` — validation, child Task, tool helper
- `worktree.ts` — git worktree create/list/remove
- `isolation.ts` — process isolation plan + spawn
- `idempotency.ts` — external event key store
- `pool.ts` — Project `maxParallelRuns`
- `tools.ts` — `agent_delegate` mapping for `agent.delegate`
- `run.ts` — `runManaged`, `executeDelegation` (existing isolated Run kept)
- `index.ts` — appended exports

### Tests

- `tests/runtime/delegate.test.ts`
- `tests/runtime/concurrency.test.ts`
- `tests/runtime/worktree.test.ts`
- `tests/runtime/idempotency.test.ts`

`packages/core/src/state/claims.ts` was not modified; Phase 4 `createClaimStore` / `RepositoryState` is used as-is.

## Spec ambiguities resolved

1. **Task permits delegation.** No Task field exists. Denied when authorization is `deny`, status is terminal (`accepted` / `failed` / `cancelled`), or a constraint is `no-delegation` / `delegation-forbidden` / `delegation:deny`.

2. **Exclusive Task.** Claims default to `exclusive: true`. One active claim per Task; expired leases are recovered before create.

3. **Cycles.** Rejected if the target is the parent or an ancestor, or if the Project delegation graph from the target can reach the parent/ancestors.

4. **Process isolation.** Planned when `defaultIsolation` is `process`, effective isolation is `process`, or a mutating Task uses `mutationIsolation: process`. Child protocol is stubbed; env filter is real.

5. **Worktree isolation.** Used when isolation is `worktree`, or a mutating Task uses `mutationIsolation: worktree`, and the Project is a git repo (or `isolateWorktree: true`).

6. **Idempotency key.** Opaque string from the Interface. Deduped before Run creation via `wx` reservation files under `.vibekit/runtime/idempotency/`.

7. **`configuration.delegation`.** Phase 5 still hardcodes `allowed: false` in `config.ts` (not in this file box). Phase 6 reads Agent + Project contracts directly.

8. **`agent.delegate` capability binding.** Tests bind it to `tool:execution` so capability resolution can succeed. The runtime capability is still the adapter tool, not a Component.
