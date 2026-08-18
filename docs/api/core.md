# `@useagentsio/core` API Reference

The `@useagentsio/core` package provides schemas, strongly typed ID utilities, state repository drivers, and module lifecycle management.

---

## Installation

```bash
pnpm add @useagentsio/core
```

---

## Schema Validation & Parsing

### `parseAndValidateYaml<T>(schemaId: string, yamlText: string)`
Parses a YAML string and validates it against the specified JSON Schema draft-07 document.

```ts
import { parseAndValidateYaml, type AgentDocument } from "@useagentsio/core";

const { valid, data, errors } = parseAndValidateYaml<AgentDocument>("agent", yamlContent);

if (!valid) {
  console.error("Invalid agent.yaml:", errors);
} else {
  console.log("Agent loaded:", data.name);
}
```

---

## Typed IDs

Provides strict parsing, validation, and stringification for all VibeKit domain identifiers.

```ts
import { 
  parseModuleId, 
  stringifyModuleId, 
  isAgentId, 
  isToolId 
} from "@useagentsio/core";

const modId = parseModuleId("agent:chief@1.2.0");
console.log(modId.type);    // "agent"
console.log(modId.name);    // "chief"
console.log(modId.version); // "1.2.0"

console.log(isAgentId("agent:coder")); // true
console.log(isToolId("agent:coder"));  // false
```

---

## Repository State Driver

### `createRepositoryState(options: { projectRoot: string }): RepositoryState`
Instantiates a filesystem-backed state store pointing to `.vibekit/state/`.

```ts
import { createRepositoryState } from "@useagentsio/core";

const state = createRepositoryState({ projectRoot: "/path/to/project" });

// Write a task
const task = await state.tasks.create({
  objective: "Refactor database connector",
  assignedAgent: "coder",
  constraints: ["Do not break connection pooling"],
  acceptanceCriteria: ["All unit tests pass"],
  delivery: { mode: "proposal" },
});

// Read a task
const fetched = await state.tasks.get(task.id);
```

---

## Three-Way Diffs & Updates

Programmatic API for calculating three-way comparisons and performing non-destructive module updates.

```ts
import { 
  computeModuleDiff, 
  applyModuleUpdate 
} from "@useagentsio/core";

const diffResult = await computeModuleDiff({
  projectRoot: "/path/to/project",
  moduleId: "agent:coder",
  registryPath: "/path/to/registry",
});

console.log("Has local edits:", diffResult.hasLocalEdits);
console.log("Has upstream changes:", diffResult.hasUpstreamChanges);
```
