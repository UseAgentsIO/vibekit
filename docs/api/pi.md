# `@useagentsio/pi` API Reference

Embedded adapter for Pi sessions: Worker Runs, worktrees, delegation, and persistent conversations. Users do not launch the Pi TUI.

---

## Installation

```bash
pnpm add @useagentsio/pi @useagentsio/core
```

---

## Worker Runs

```ts
import { prepareIsolatedRun, runIsolated, runManaged } from "@useagentsio/pi";

const prepared = await prepareIsolatedRun({
  projectRoot,
  bindingName: "coder",
  task,
});

const outcome = await runIsolated({
  projectRoot,
  bindingName: "coder",
  task,
  signal,
});
```

- `prepareIsolatedRun` — resolve Agent, tools, model, bounded context, filtered env; does not start Pi.
- `runIsolated` — execute one Worker Run. Persistence of Events/Results is the caller’s job (the Host does this).
- `runManaged` — wraps isolation, claims, concurrency, and idempotency around a Run.

Inject `createSession` only in unit tests.

---

## Worktrees

```ts
import { createWorktree, removeWorktree, shouldUseWorktree } from "@useagentsio/pi";

if (shouldUseWorktree({ project, task })) {
  const worktree = createWorktree({ projectRoot, runId });
  try {
    // mutate files under worktree.path
  } finally {
    removeWorktree(worktree);
  }
}
```

There is no `withWorktreeIsolation` helper. Isolation is `process` or `worktree` (see Project `execution`).

---

## Delegation

`executeDelegation` / `createAgentDelegateTool` start a **child Worker Run** and return its Result. The parent must have `agent.delegate`, and both Agent and Project contracts must allow the target. There is no `orchestrator` type.

---

## Persistent conversations

The Host uses `runConversationTurn` (and related session helpers) for Interface threads. That is separate from `runIsolated` Worker Runs.

---

## Model catalog

```ts
import { OFFICIAL_PROVIDERS, openModelCatalog } from "@useagentsio/pi";

const catalog = await openModelCatalog({ allowNetwork: true });
const models = await catalog.listModels("openai");
```
