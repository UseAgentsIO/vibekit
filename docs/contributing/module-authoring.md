# Module Authoring Guide

How to add or change **Agents** and **Components** that conform to the VibeKit Module contract.

The **official** registry is the default curated catalog inside this monorepo. It is not a marketplace, and it is not the definition of a valid Module. Independently authored Modules can live in a local/custom registry path and install through the same CLI (`--registry <path>`) once they satisfy the same runtime, compatibility, ownership, permission, and security rules.

Installing a module copies its payload into the Project, where the files become locally owned. See the [PRD registry and ownership sections](../PRD.md) and [catalog overview](../catalog/overview.md).

A Tool or Interface does **not** require editing VibeKit core, Host ID maps, or `vibekit start` in order to load. The Host resolves `runtime.kind` / `runtime.package` / `runtime.export` from the **installed** Module and its recorded registry source.

---

## 1. What belongs in the official registry

Accept a module when it is:

- A reusable **Component** (provider, tool, skill, interface, policy, verifier, state) or a useful **Agent** composition of Components
- Small enough to install, customize, and update independently
- Honest about runtime (`interface`, `pi-builtin`, `pi-extension`, `package`, or `config-only`)
- Safe: relative file targets, secret **references** only, permissions declared rather than implied in prose

Reject a module that:

- Introduces `orchestrator`, `subagent`, or `Blocks`
- Requires a hosted registry service or remote “app store”
- Stores secret values
- Pretends to be an executable Tool while shipping only config (`runtime.kind` must be `config-only` and `available: false` until the Tool exists)
- Owns Project State from an Interface
- Encodes a workflow DSL instead of a normal Agent composition

---

## 2. Directory layout

Versioned directories. The index path is `agents/<name>/<version>` or `components/<family>/<name>/<version>`.

```text
registry/
├── index.json                          # generated; do not hand-edit
├── agents/
│   └── coder/1.0.0/
│       ├── module.yaml
│       └── payload/
│           ├── agent.yaml
│           └── instructions.md
└── components/
    ├── provider/openai/1.0.0/
    ├── tool/filesystem/1.0.0/
    ├── skill/research/1.0.0/
    ├── interface/terminal/1.0.0/
    ├── policy/least-privilege/1.0.0/
    ├── verifier/command/1.0.0/
    └── state/repository/1.0.0/
```

Each Component version typically contains:

| File | Purpose |
| :--- | :--- |
| `module.yaml` | Installable contract (schema `component` / `agent`) |
| `config.schema.json` | JSON Schema for the Project-side config file |
| `payload/` | Files copied into the Project on install |

Copy a neighboring official module of the same family instead of inventing a new shape.

---

## 3. Identifiers

- **Module ID**: `type:name`, lowercase kebab-case:

  ```text
  ^(provider|tool|skill|interface|state|policy|verifier|agent):[a-z0-9]+(?:-[a-z0-9]+)*$
  ```
- **`name`**: the part after the colon (`coder`, `least-privilege`)
- **`version`**: semver (`1.0.0`). New behavior for an existing ID gets a new version directory; do not overwrite a shipped version in place if Projects may already have it installed.
- **`schemaVersion`**: `1` for module documents.

Examples: `agent:chief`, `provider:openai-codex`, `interface:terminal`, `policy:require-verification`.

---

## 4. `module.yaml` contract

JSON Schemas: `schemas/module.schema.json`, `schemas/component.schema.json`, `schemas/agent.schema.json`. Official tests parse `module.yaml` as `agent` or `component` accordingly.

### Shared fields (every official module)

```yaml
schemaVersion: 1
id: tool:filesystem
type: tool
name: filesystem
displayName: Filesystem Tool
version: 1.0.0
description: Gives authorized Agents scoped read and write access to Project files.

compatibility:
  vibekit: "^1.0.0"
  pi: ">=0.50.0"
  node: ">=20"

source:
  repository: "https://github.com/UseAgentsIO/vibekit"
  revision: "v1.0.0"

license: MIT
```

`tests/registry/official.test.ts` requires a license, a source revision, and `compatibility.vibekit: "^1.0.0"`.

### Component fields

Required on Components:

- `providesCapabilities` — capability IDs such as `source.read`, `web.fetch`
- `requires` — `{ required, optional, recommended, conflicts }` module IDs
- `requestsPermissions` — capabilities this Component asks the Project to consider
- `secrets` — `{ name, source: environment, required? }` only
- `files` — `{ source, target, ownership }`
- `configuration` — `{ target, schema }` (Project config path + schema file name)

Optional: `healthCheck`, `runtime`, `packages`.

### Runtime contract (Tools and Interfaces)

Package-backed Components declare how the Host loads them. This is implementation metadata, not identity:

```yaml
runtime:
  kind: interface          # or pi-extension / package / pi-builtin / config-only
  package: "@alice/vibekit-discord"
  export: createDiscordInterface
  available: true          # false or kind: config-only means do not execute
packages:
  dependencies:
    "@alice/vibekit-discord": "^1.0.0"
```

Required for a loadable Tool or Interface:

- `id` / `type` / `name` / `version` / `description` / `compatibility`
- `runtime.kind` matching the family (`interface` or `pi-extension` / `package` for Tools)
- `runtime.package` and `runtime.export` for package-backed implementations
- configuration schema, requested capabilities/permissions, secret **references** only
- relative `files` targets and ownership
- `requires` for other Modules the installer must resolve

The Host loads `runtime.package` from the **Project** (`importProjectModule`) and calls `runtime.export`. Official `@useagentsio/*` packages are implementations of official Modules; a third-party package is treated the same after registry validation. Adding `interface:discord` must not require edits to `packages/cli/src/commands/start.ts` or a Host ID map.

`publisher` is a document field, not a privileged runtime type. It does not have to be UseAgentsIO.

Set `runtime.kind: config-only` and `available: false` until an executable implementation exists.

### Agent fields

Agents additionally declare instructions, model inheritance, required Components, capabilities, inputs/outputs, permissions, delegation, state read/write, execution isolation, verification, completion, and escalation. Use `agent:coder` and `agent:chief` as templates.

The installable Agent recipe is `payload/agent.yaml` plus `payload/instructions.md`. Official tests require both files.

---

## 5. Files, ownership, and targets

```yaml
files:
  - source: payload/index.ts
    target: .pi/extensions/filesystem/index.ts
    ownership: exclusive
```

Rules:

- `source` is relative to the module version directory.
- `target` is relative to the **Project root** after install.
- `ownership` is `exclusive` (update/remove may replace if the user has not edited it) or `generated`.
- **Unsafe targets are rejected** at index time and at `vibekit add`: `..`, absolute paths, null bytes, `~`, drive letters, UNC, `file:` / `https:` schemes.

Conventional targets:

| Family | Typical target |
| :--- | :--- |
| Agent | `.vibekit/agents/<name>/agent.yaml` and `instructions.md` |
| Provider | `.vibekit/components/providers/<name>.yaml` |
| Tool | `.pi/extensions/<name>/index.ts` or `.vibekit/components/tools/<name>.yaml` |
| Skill | `.pi/skills/<name>/SKILL.md` |
| Interface | `.vibekit/components/interfaces/<name>.yaml` |
| Policy | `.vibekit/components/policies/<name>.yaml` |
| Verifier | `.vibekit/components/verifiers/<name>.yaml` |
| State | `.vibekit/components/state/<name>.yaml` |

Configuration `target` is usually `.vibekit/config/<family>/<name>.yaml`.

---

## 6. Runtime honesty

Declare how the Host or Pi should load the module.

| `runtime.kind` | Meaning | Example |
| :--- | :--- | :--- |
| `interface` | Host `import(package)` and call `export` | `interface:terminal` → `@useagentsio/interface-terminal` / `createTerminalInterface` |
| `pi-builtin` | Bind named Pi built-ins | `tool:filesystem` (`read`, `grep`, `find`, `ls`, `write`, `edit`) |
| `pi-extension` | Load a Pi extension package | `tool:web` → `@useagentsio/tool-web` |
| `package` | Host/adapter package | optional verifiers / state drivers |
| `config-only` | Metadata only; not executable | use `available: false` |

Executable modules that live in `packages/` should also list `packages.dependencies` so install can record the npm dependency.

Interfaces that attach to the Host **must** set `runtime.kind: interface`, `package`, `export`, and `lifecycle: singleton` unless a new lifecycle is specified in the spec.

---

## 7. Secrets and permissions

```yaml
secrets:
  - name: OPENAI_API_KEY
    required: true
    source: environment

requestsPermissions:
  - capability: source.read
  - capability: source.write
```

- Secret **names** are `^[A-Z][A-Z0-9_]*$`. Source is `environment` only in V1.
- Never put key material in `module.yaml`, payload YAML, Skills, fixtures, or tests.
- Effective authority at runtime is still Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ authorization. Declaring `requestsPermissions` does not grant them.

Fetched web content, webhook bodies, and tool stdout are **untrusted**. They must not elevate permissions.

---

## 8. Agent-specific rules

- Agents are peers. Delegation is `delegation.allowed` plus explicit `targets`. Do not add a new type to “coordinate.”
- A producing Agent must not independently review its own Result (`independentReview` / Reviewer with no `source.write`).
- Mutating Agents (`source.write`) should isolate with `execution.isolation: worktree` unless there is a documented reason not to.
- Worker Runs emit a structured Result (`summary`, artifacts, evidence, unresolved issues). Do not hide work only in conversation text.
- Keep `completed` / `verified` / `accepted` / `applied` as separate stages. Verifiers belong in `verification.required`, not in the prompt as the only check.

---

## 9. Add a Component (checklist)

1. Copy the closest official module under `registry/components/<family>/<name>/1.0.0/`.
2. Fill `module.yaml` (IDs, capabilities, secrets, files, runtime).
3. Add payload files and `config.schema.json`.
4. If the module executes, implement the Node package under `packages/` and point `runtime.package` / `runtime.export` at it.
5. Rebuild the index:

   ```bash
   pnpm registry:index
   ```

6. Add the ID to the sorted list in `tests/registry/official.test.ts`.
7. Document it in [docs/catalog/components.md](../catalog/components.md) and the README Official Components table.
8. Run:

   ```bash
   pnpm test tests/registry
   pnpm test tests/end-to-end/catalog.test.ts
   pnpm typecheck
   ```

9. Commit module files, `registry/index.json`, tests, and catalog docs together.

### Add an Agent

Same flow under `registry/agents/<name>/<version>/`, plus:

- `payload/agent.yaml` must validate as document kind `agent`
- `payload/instructions.md` must exist
- Required Components in `components.required` must already be in the official registry
- Document it in [docs/catalog/agents.md](../catalog/agents.md)

---

## 10. Change an existing module

- **Compatible payload/docs tweak** of the current version: edit files in place, run `pnpm registry:index` (checksums change), keep the same version only when you intend to replace that catalog version for new installs.
- **Behavior or contract change**: add `registry/.../<new-version>/` and let both versions index. Projects update through `vibekit diff` / `vibekit update` (three-way; conflicts stop; no `--force`).
- Do not hand-edit `.vibekit/installed.json` in user Projects to fake an install.

---

## 11. Tests that protect the catalog

| Test | What it proves |
| :--- | :--- |
| `tests/registry/official.test.ts` | Every shipped ID loads, schemas validate, index matches disk |
| `tests/registry/safety.test.ts` | Traversal and absolute targets are rejected |
| `tests/end-to-end/catalog.test.ts` | Catalog install/composition flow |
| `tests/core/install.test.ts` / `update.test.ts` | Transactional install and three-way update |

If `pnpm registry:index` fails, fix the module; do not patch `index.json`.

---

## 12. Worked references

Read these before sending a new family member:

| Goal | Copy |
| :--- | :--- |
| Provider | `registry/components/provider/openai/1.0.0/` |
| Pi built-in tool | `registry/components/tool/filesystem/1.0.0/` |
| Pi extension tool | `registry/components/tool/web/1.0.0/` + `packages/tool-web/` |
| Skill | `registry/components/skill/research/1.0.0/` |
| Interface | `registry/components/interface/terminal/1.0.0/` + `packages/interface-terminal/` |
| Policy | `registry/components/policy/least-privilege/1.0.0/` |
| Verifier | `registry/components/verifier/command/1.0.0/` |
| Delegating Agent | `registry/agents/chief/1.0.0/` |
| Implementing Agent | `registry/agents/coder/1.0.0/` |
| Read-only review Agent | `registry/agents/reviewer/1.0.0/` |

---

## 13. After install (what users see)

`vibekit add tool filesystem` (or `create` / `init` setup) copies payload files into the Project and records checksums in `.vibekit/installed.json`. Users may edit those files. `vibekit diff` / `vibekit update` compare original base, local edits, and new upstream. That is why registry modules are starting points, not framework-owned runtime config.
