# Pattern: parallel coding worktrees → independent integration

Documentation only. V1 does not execute Pattern files. Compose this flow with worktree isolation, Task claims, and a later integration step.

## Intent

Several coding Runs proceed at once without sharing a working tree. Each Coder produces a verified proposal. Integration is a separate, independently reviewed change. There is no automatic merge of arbitrary user or Agent edits.

## Modules

- `agent:chief` or `agent:project-manager` to fan out Tasks
- `agent:coder` (one binding, many Runs)
- `agent:reviewer`
- `state:repository`
- `verifier:command`
- `tool:filesystem`
- `tool:execution`
- `policy:require-verification`

## Project shape

```yaml
execution:
  maxParallelRuns: 4
  defaultIsolation: process
  mutationIsolation: worktree
  maxDelegationDepth: 2

authorization:
  default: deny
  actions:
    source.read: standing
    source.write: standing
```

## Flow

```text
Task A  → worktree A → Coder Run A → Result A → Verification A
Task B  → worktree B → Coder Run B → Result B → Verification B
                ↘                         ↙
                  integration Task
                    → new worktree
                    → Coder or human apply
                    → Verification
                    → independent review
                    → accepted integration
```

1. Chief or Project Manager creates exclusive Tasks with disjoint path scopes when possible.
2. Task claims prevent the same exclusive Task from running twice.
3. Each coding Run gets a dedicated Git worktree. `cwd` for that Pi session is the worktree path.
4. Coders write only granted paths inside that worktree. They do not commit to the shared checkout.
5. Each Result is verified against its own candidate revision.
6. Integration is a new Task. It reads accepted proposals, applies them to a fresh worktree or the integration target, and produces a new candidate.
7. Independent review and any required Approval run on the integration candidate, not on a live shared tree.

## Guardrails

- Several Agents MUST NOT write into the same working tree concurrently.
- Process isolation is the default; mutation isolation is worktree.
- A revision conflict stops a stale write. The caller reloads and reconciles.
- Duplicate Interface events are ignored through idempotency keys before Run creation.
- Cleanup of worktrees is required after success, failure, cancellation, and timeout.
- Independent review cannot be performed by the producing Agent. Integration review is a separate `agent:reviewer` Task.
