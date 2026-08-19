# `@useagentsio/core` API Reference

Schemas, typed IDs, repository State, install/update/remove, and three-way diff.

---

## Installation

```bash
pnpm add @useagentsio/core
```

JSON Schema sources live in `schemas/` and are copied into this package on publish.

---

## Schema validation

```ts
import { parseAndValidateYaml, type AgentDocument } from "@useagentsio/core";

const parsed = parseAndValidateYaml("agent", yamlContent);
if (!parsed.valid || parsed.data === undefined) {
  throw new Error(JSON.stringify(parsed.errors));
}
const agent: AgentDocument = parsed.data;
```

Document kinds include `project`, `agent`, `component`, `task`, `result`, `decision`, `approval`, `verification`, `event`, `conversation`, `installed`.

---

## Typed IDs

Module IDs are `type:name` (no `@version` in the ID itself). Version is a separate field.

```ts
import { parseModuleId, formatModuleId, isModuleId } from "@useagentsio/core";

const parsed = parseModuleId("agent:chief");
// { type: "agent", name: "chief" }

formatModuleId("tool", "filesystem"); // "tool:filesystem"
isModuleId("agent:coder"); // true
```

Runtime IDs are `kind_<uuid>` (`task_`, `run_`, `result_`, `approval_`, …) via `formatRuntimeId` / `parseRuntimeId`. There are no `isAgentId` / `stringifyModuleId` helpers.

---

## Repository State

```ts
import { createRepositoryState, readProjectDocument } from "@useagentsio/core";

const project = readProjectDocument(projectRoot);
const state = createRepositoryState({
  projectRoot,
  statePath: project.state.path,
});

const stored = state.tasks.create(taskDocument); // sync; writes task_<uuid>.yaml
const fetched = state.tasks.get(stored.document.id);
```

`create` / `get` / `update` are **synchronous**. Documents are YAML files under `.vibekit/state/<kind>/`. Conversations are stored by the Host (`ConversationStore`), not on `RepositoryState`.

---

## Three-way diff and update

```ts
import {
  diffInstalledModule,
  planUpdate,
  applyUpdate,
  readInstalledManifest,
  loadRegistry,
} from "@useagentsio/core";

const registry = loadRegistry(registryRoot);
const manifest = readInstalledManifest(projectRoot);

const diff = diffInstalledModule({
  projectRoot,
  registry,
  id: "agent:coder",
  manifest,
});
```

Use `planUpdate` / `applyUpdate` for writes. There is no `computeModuleDiff` or `applyModuleUpdate`. Conflicts stop the Module; V1 has no `--force`.

Related: `planInstall` / `applyInstall`, `planRemove` / `applyRemove`, `runDoctor`.
