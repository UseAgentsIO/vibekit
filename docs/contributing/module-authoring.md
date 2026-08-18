# Module Authoring Guide

This guide explains how to author, test, and register new official Agents and Components for the VibeKit registry.

---

## 1. Registry Directory Structure

Official modules reside under the `registry/` directory:

```text
registry/
├── agents/
│   └── <agent-name>/
│       ├── module.yaml           # Module manifest
│       ├── agent.yaml            # Default agent configuration
│       └── instructions.md       # Default agent prompt instructions
│
└── components/
    ├── provider/<name>/
    │   ├── module.yaml
    │   └── provider.yaml
    ├── tool/<name>/
    │   ├── module.yaml
    │   └── tool.yaml
    ├── skill/<name>/
    │   ├── module.yaml
    │   └── skill.yaml
    └── policy/<name>/
        ├── module.yaml
        └── policy.yaml
```

---

## 2. Authoring a `module.yaml` Manifest

Every module directory requires a `module.yaml` adhering to `module.schema.json`:

```yaml
schemaVersion: 1
id: agent:my-new-agent
name: My New Agent
version: 1.0.0
type: agent
license: UNLICENSED
description: A specialized agent for custom workflows.

runtime:
  kind: package
  package: "@useagentsio/core"

files:
  - source: agent.yaml
    target: .vibekit/agents/my-new-agent/agent.yaml
  - source: instructions.md
    target: .vibekit/agents/my-new-agent/instructions.md

requiredDependencies:
  - tool:filesystem
  - policy:least-privilege
```

---

## 3. Safety & Validation Rules

Module manifests are subjected to automated CI checks (`tests/registry/safety.test.ts`):

1. **File Target Safety**: `target` paths must start with `.vibekit/` and must never contain `..` or leading slashes `/`.
2. **License Declaration**: Every module must declare a valid `license` field.
3. **Declared Dependencies**: All modules listed in `requiredDependencies` must exist in the official registry.
4. **Honest Runtimes**: If a module is config-only or not executable in this release, it must be marked `runtime.kind: config-only` and `available: false`.

---

## 4. Testing & Indexing Your Module

After adding or modifying files in `registry/`:

```bash
# 1. Rebuild the registry index
pnpm registry:index

# 2. Run registry test suite
pnpm test tests/registry
```

If validation succeeds, `registry/index.json` will update automatically. Commit both your module files and the regenerated `index.json`.
