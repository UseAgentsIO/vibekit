# `@useagentsio/pi` API Reference

The `@useagentsio/pi` package serves as the embedded adapter for running task execution sessions on top of the Pi engine.

---

## Installation

```bash
pnpm add @useagentsio/pi @useagentsio/core
```

---

## Running Isolated Tasks

### `runIsolated(options: RunIsolatedOptions): Promise<IsolatedRunOutcome>`
Executes an isolated worker run for a bounded task with complete environment and worktree sandboxing.

```ts
import { runIsolated } from "@useagentsio/pi";

const outcome = await runIsolated({
  projectRoot: "/path/to/project",
  bindingName: "coder",
  task: {
    id: "task_01j9abc",
    objective: "Add healthcheck endpoint to server.ts",
    constraints: ["Follow existing Express routing patterns"],
    acceptanceCriteria: ["GET /health returns 200 OK"],
  },
  onEvent: (event) => {
    console.log(`[${event.type}]`, event.payload);
  },
});

console.log("Run status:", outcome.result.status);
console.log("Summary:", outcome.result.summary);
console.log("Modified artifacts:", outcome.result.artifacts);
```

---

## Worktree Isolation

### `withWorktreeIsolation(options, runner)`
Allocates a temporary Git worktree for mutating coding tasks, executes the provided runner inside the isolated directory, and safely cleans up or stages changes upon completion.

```ts
import { withWorktreeIsolation } from "@useagentsio/pi";

const result = await withWorktreeIsolation({
  projectRoot: "/path/to/project",
  runId: "run_01j9xyz",
}, async (worktreePath) => {
  // Execute coding task inside worktreePath
  return { modifiedFiles: ["src/server.ts"] };
});
```

---

## Delegation Runtime (`agent_delegate`)

Implements the delegation tool passed into parent agent sessions to safely dispatch child worker runs:
- Validates parent delegation grants against `.vibekit/project.yaml`.
- Enforces maximum delegation depth limits (`execution.maxDelegationDepth`).
- Propagates cancellation signals to child runs.
