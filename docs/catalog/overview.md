# Official Catalog & Registry Overview

VibeKit ships with an **official, curated registry** of Agents and Components.

---

## 1. Registry Architecture & Principles

- **Official, Not a Marketplace**: V1 focuses on vetted, high-quality, secure modules directly maintained in the VibeKit monorepo. Third-party unvetted registries are intentionally excluded.
- **Honesty in Declarations**: Modules must honestly declare their runtime capabilities. A module cannot pretend to be an executable tool if it is only a configuration template.
- **Embedded in CLI**: The official registry is packaged directly inside `@useagentsio/cli`, allowing instant offline installations.

---

## 2. Anatomy of a `module.yaml`

Every entry in the registry is defined by a `module.yaml` manifest conforming to `module.schema.json`:

```yaml
schemaVersion: 1
id: tool:filesystem
name: Filesystem Tools
version: 1.0.0
type: component
family: tool
license: UNLICENSED
description: Pi filesystem built-ins for reading, listing, and writing files.

runtime:
  kind: pi-builtin
  tools:
    - read
    - grep
    - find
    - ls
    - write
    - edit

files:
  - source: filesystem.yaml
    target: .vibekit/components/tools/filesystem.yaml

requiredDependencies: []
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
| `config-only` | Configuration and metadata declaration without direct executable code. | `tool:github` (configures `GITHUB_TOKEN` reference) |

---

## 4. Rebuilding the Registry Index

When contributing or adding new modules to the repository, rebuild the registry index using the workspace script:

```bash
pnpm registry:index
```

This validates all module manifests against schemas, checks file target safety, and regenerates `registry/index.json`.
