# Official Catalog & Registry Overview

VibeKit ships with an **official, curated registry** of Agents and Components. Contribution rules: [CONTRIBUTING.md](../../CONTRIBUTING.md) and [Module authoring](../contributing/module-authoring.md).

---

## 1. Registry Architecture & Principles

- **Official is the default, not the definition of a Module**: V1 ships a vetted official catalog in the monorepo. Independently authored conforming Modules can be installed from a local/custom registry path (`--registry`). Hosted discovery, ratings, and a marketplace are not implemented.
- **Honesty in Declarations**: Modules must honestly declare their runtime capabilities. A module cannot pretend to be an executable tool if it is only a configuration template.
- **Embedded in CLI**: The official registry is packaged directly inside `@useagentsio/cli`, allowing instant offline installations.

---

## 2. Anatomy of a `module.yaml`

Every entry in the registry is defined by a `module.yaml` manifest conforming to `schemas/component.schema.json` or `schemas/agent.schema.json`. Official modules live in versioned directories (`registry/components/tool/filesystem/1.0.0/`). See [Module authoring](../contributing/module-authoring.md) for the full contribution contract.

```yaml
schemaVersion: 1
id: tool:filesystem
type: tool
name: filesystem
displayName: Filesystem Tool
version: 1.0.0
description: Gives authorized Agents scoped read and write access to Project files.
license: MIT

compatibility:
  vibekit: "^1.0.0"
  pi: ">=0.50.0"
  node: ">=20"

source:
  repository: "https://github.com/UseAgentsIO/vibekit"
  revision: "v1.0.0"

runtime:
  kind: pi-builtin
  tools: [read, grep, find, ls, write, edit]

files:
  - source: payload/index.ts
    target: .pi/extensions/filesystem/index.ts
    ownership: exclusive
```

---

## 3. Runtime Kinds

Modules declare how they execute or attach at runtime using the `runtime.kind` property:

| `kind` | Description | Example |
| :--- | :--- | :--- |
| `interface` | Loaded into the Host process via package import and factory function. | `interface:terminal` (`@useagentsio/interface-terminal`) |
| `pi-builtin` | Maps to Pi's native built-in tools (`read`, `write`, `bash`). | `tool:filesystem`, `tool:execution` |
| `pi-extension` | Loads an external Pi extension. | Extension modules |
| `package` | Standard Node.js package dependency. | Host adapter modules |
| `config-only` | Configuration and metadata only; set `available: false`. | Older `tool:github@1.0.0` (configures `GITHUB_TOKEN`). `1.1.0` is `pi-extension`. |

---

## 4. Rebuilding the Registry Index

When contributing or adding new modules to the repository, rebuild the registry index using the workspace script:

```bash
pnpm registry:index
```

This validates all module manifests against schemas, checks file target safety, and regenerates `registry/index.json`. Commit the index with the module. Add new IDs to `tests/registry/official.test.ts` and the catalog tables. Full checklist: [Module authoring](../contributing/module-authoring.md).
