# Phase 5 summary — Pi runtime adapter (`@useagentsio/pi`)

Phase 5 skeleton is implemented under `packages/pi`. It compiles with `tsc -b` in that package. `pnpm test` (full workspace) and `pnpm typecheck` both pass in this workspace.

## Test results

```text
pnpm typecheck          → tsc -b  (pass)
pnpm test               → 27 files, 151 tests passed
tests/runtime only      → 7 files, 30 tests passed
packages/pi tsc -b      → pass
```

| File | Tests |
| --- | ---: |
| `tests/runtime/config.test.ts` | 9 |
| `tests/runtime/loaders.test.ts` | 5 |
| `tests/runtime/env.test.ts` | 4 |
| `tests/runtime/run.test.ts` | 4 |
| `tests/runtime/events.test.ts` | 3 |
| `tests/runtime/result.test.ts` | 3 |
| `tests/runtime/context.test.ts` | 2 |

Exit criteria covered by the skeleton (without a live model or Project State write):

- Project, Agent, and Task contracts load and validate
- the Agent receives only granted tools and authorized State slices
- missing configuration fails closed (`configuration_invalid` / `VibeKitError`)
- cancellation calls `session.abort()` and `dispose()`
- timeout records `run.timed_out` and cleans the session
- cleanup failure is not reported as a completed Run

A real Agent Task through `@earendil-works/pi-coding-agent` is not run here. Tests inject `createSession`.

## What is real

- Project loader: `.vibekit/project.yaml` via `fs` + `parseAndValidateYaml("project")`
- Agent loader: `.vibekit/agents/<binding>/agent.yaml`, instructions file, binding checks
- Task loader / validator
- Effective configuration layers (spec §13.1) and model resolution (spec §13.3)
- Capability binding through `@useagentsio/core` `resolveRequiredCapabilities`
- Allowlisted Pi tools from granted capabilities (read/write/execute → built-ins)
- Bounded context (spec §19.3) and instruction stack (spec §19.2)
- Environment filter: required runtime vars + authorized secret *names* from `process.env`
- Isolated Run wrapper: `cwd`, tools, in-memory SessionManager, custom system prompt
- Cancellation → `session.abort()` + `dispose()`
- Timeout → abort + `run.timed_out`
- Typed Run Events returned to the caller (not written)
- Result document matching the Result contract (not persisted)

## What is deferred

Deferred until State / later phases, or until a live Pi session is wired:

| Item | Why |
| --- | --- |
| Persist Events / Results / Tasks | Phase 4 owns the Event log and stores. Adapter returns objects. |
| `agent_delegate` | Phase 6. Tool is never registered. |
| Git worktrees | Phase 6. Isolation is recorded; `cwd` is caller-supplied. |
| Child Node process isolation | Phase 6. Filtered env is computed, not applied to the parent process. |
| Task claims / locks / leases | Phase 6 / State. |
| Verifiers, apply, Approval | Phase 7. Explicit mutating Runs fail closed without `approvalGranted`. |
| CLI `run` / Interface trigger | Phase 2/9. No CLI commands. |
| Live `createAgentSession` | Optional peer `@earendil-works/pi-coding-agent`. Default factory dynamic-imports it. |
| Skill → Pi Skill, Tool → extension, Provider → ModelRuntime | Compose when Components are installed; skeleton maps capabilities to built-in tools only. |
| Full Policy engine | `policy:require-verification` and least-privilege intersection only. |
| Applying filtered env to Pi | Needs process isolation. In-process session still sees parent `process.env`. |

## Public API

`prepareIsolatedRun(input)` resolves configuration, context, and env without starting Pi.

`runIsolated(input)` starts a session (inject `createSession` in tests), returns:

```ts
{
  runId,
  status,          // completed | failed | cancelled | timed_out
  events,          // EventDocument[]
  result,          // ResultDocument
  configuration,
  context,
  environment,     // filtered env + secret names (no persistence)
  failure?
}
```

## Files created

### Package

- `packages/pi/package.json` (`@useagentsio/core` workspace:*, `yaml`)
- `packages/pi/tsconfig.json` (references `../core`)
- `packages/pi/README.md`
- `packages/pi/src/index.ts`
- `packages/pi/src/fail.ts`
- `packages/pi/src/ids.ts`
- `packages/pi/src/documents.ts`
- `packages/pi/src/yaml-fragment.ts`
- `packages/pi/src/project.ts`
- `packages/pi/src/agent.ts`
- `packages/pi/src/task.ts`
- `packages/pi/src/tools.ts`
- `packages/pi/src/model.ts`
- `packages/pi/src/config.ts`
- `packages/pi/src/invariants.ts`
- `packages/pi/src/context.ts`
- `packages/pi/src/env.ts`
- `packages/pi/src/events.ts`
- `packages/pi/src/result.ts`
- `packages/pi/src/session.ts`
- `packages/pi/src/run.ts`

### Tests

- `tests/runtime/helpers.ts`
- `tests/runtime/loaders.test.ts`
- `tests/runtime/config.test.ts`
- `tests/runtime/context.test.ts`
- `tests/runtime/env.test.ts`
- `tests/runtime/events.test.ts`
- `tests/runtime/result.test.ts`
- `tests/runtime/run.test.ts`

Root `tsconfig.json` does not yet reference `packages/pi`. Compile with `tsc -b packages/pi`. Tests import `@useagentsio/pi` from the built `dist` (or workspace link). Root `package.json` / `vitest.config.ts` were not edited; add a workspace dependency or alias in a follow-up so a clean `pnpm install` always resolves `@useagentsio/pi`.

## Spec ambiguities resolved

1. **Task model override.** Task documents have no `model` field. The adapter accepts `IsolatedRunInput.taskModel` as the allowed Task override (spec §13.3).

2. **Project allow-task-override.** Project schema has no flag. Default is allow, unless `.vibekit/config/agents/<binding>.yaml` sets `allowTaskOverride: false`. The Agent flag still gates the override.

3. **“Project Agent binding” model layer.** Interpreted as `.vibekit/config/agents/<binding>.yaml` `model.provider` / `model.id` when `allowProjectOverride` is true.

4. **Fail-closed category.** Missing or invalid runtime configuration is `configuration_invalid`, not core’s `invalid_input` used by `readProjectDocument`.

5. **Authorization `explicit`.** Without `approvalGranted: true`, mutating tools (`write`, `edit`, `bash`) fail closed (`authorization_required`). Read-only tools may remain.

6. **Authorization `deny`.** The Run does not start.

7. **Capability → Pi tools.** Not a spec table. Adapter map: `source.read` → `read|grep|find|ls`, `source.write` → `write|edit`, `command.execute` → `bash`. No `agent_delegate`.

8. **Inherit model.** Agent `provider` / `id` of `inherit` is not usable; resolution continues to later layers.

9. **Events and Results.** Constructed and validated, then returned. Secret-like strings are redacted. `verificationIds` are never taken from the model.

10. **In-process vs isolated env.** `filterEnvironment` builds the child env object. Applying it requires Phase 6 process isolation.

11. **Pi SDK.** `@earendil-works/pi-coding-agent` is not a hard install-time dependency so unit tests do not need the SDK. `createPiAgentSession` dynamic-imports it and uses `SessionManager.inMemory()`, `DefaultResourceLoader.systemPromptOverride`, allowlisted `tools`, and `session.abort()` / `dispose()`.
