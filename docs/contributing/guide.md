# Contributing Guide

How to develop VibeKit in this monorepo. For the contribution contract and invariants, start at the root [CONTRIBUTING.md](../../CONTRIBUTING.md). For official Agents and Components, use [Module authoring](module-authoring.md).

---

## 1. Prerequisites

- **Node.js** `>= 20.0.0`
- **pnpm** `11.18.0` (pinned as `packageManager` in the root `package.json`)
- **Git** `>= 2.30`

---

## 2. Workspace setup

```bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
```

The workspace is `packages/*` (`pnpm-workspace.yaml`). Official packages publish under `@useagentsio/*`.

| Package | Role |
| :--- | :--- |
| `@useagentsio/cli` | `vibekit` binary: `create`, `msg`, `start`, composition commands |
| `@useagentsio/host` | `vibekit-host` daemon |
| `@useagentsio/core` | schemas, IDs, install/update/remove, State, three-way diff |
| `@useagentsio/pi` | embedded Pi adapter, worktrees, Worker Runs |
| `@useagentsio/interface-sdk` | Interface contract |
| `@useagentsio/interface-terminal` | Terminal Interface (ships with V1) |
| Optional `interface-*`, `tool-*`, `state-memory`, `verifier-schema` | Optional Components; bind with `vibekit add` |

Related trees:

- `registry/` — official catalog (source of truth)
- `schemas/` — JSON Schema source of truth (copied into `packages/core/schemas` on publish)
- `fixtures/` — valid and invalid documents from the spec
- `tests/` — schema, registry, CLI, composition, permissions, state, runtime, host, e2e
- `docs/` — product, architecture, catalog, patterns, spec

---

## 3. Commands

```bash
pnpm test                 # vitest, entire suite
pnpm test tests/cli       # one tree
pnpm typecheck            # tsc -b across project references
pnpm registry:index       # validate modules and rewrite registry/index.json
```

Local CLI (do not publish to test a change):

```bash
pnpm exec tsx packages/cli/src/index.ts --help
pnpm exec tsx packages/cli/src/index.ts create /tmp/vk-demo --agent chief --provider openai --interface terminal --yes
```

Host binary during development:

```bash
pnpm exec tsx packages/host/src/main.ts /path/to/project
```

`--registry` points the CLI at this repo’s `registry/` when you are testing unpublished modules.

---

## 4. Code standards

- **TypeScript, ESM.** Match neighboring files: explicit types on exported APIs, `readonly` on immutable inputs, no drive-by refactors.
- **Comments** explain non-obvious constraints, not what the next line does.
- **Errors** use `VibeKitError` with a category and a stable `code`. Do not stringify secrets into messages.
- **Tests first for contracts.** Schema, ID, file-target, permission, and lifecycle rules belong in `tests/` with fixtures — not only in prose.
- **Package boundaries.** `@useagentsio/core` stays Interface-independent. `@useagentsio/pi` prepares isolated Runs; it does not own Project State. The Host loads Projects, Interfaces, conversations, and State.
- **New Interface packages** implement `@useagentsio/interface-sdk`. They translate I/O. They must not create a second State store.

When a registry module executes at runtime, declare `runtime.package` / `runtime.export` (or `runtime.tools` for Pi built-ins) and keep the Node package in `packages/`. See [Module authoring](module-authoring.md).

---

## 5. Tests that usually need an update

| Change | Also update |
| :--- | :--- |
| New official module | `tests/registry/official.test.ts` ID list, `pnpm registry:index`, catalog docs |
| Schema field | `schemas/`, `fixtures/valid` and `fixtures/invalid`, `tests/schemas/` |
| CLI command or flag | `tests/cli/`, `docs/cli/commands.md` |
| Host / Interface behavior | `tests/host/`, `tests/interface-*` if present, API docs under `docs/api/` |
| Permission or file-target rule | `tests/composition/`, `tests/core/file-targets.test.ts` |
| Catalog table in README | `docs/catalog/components.md` or `docs/catalog/agents.md` |

Do not hand-edit `registry/index.json` except by running `pnpm registry:index`.

---

## 6. Documentation standards

- Product claims must match running behavior. If README or the PRD describes a command, the CLI must implement it.
- Keep the catalog tables in [README.md](../../README.md), [docs/catalog/agents.md](../catalog/agents.md), and [docs/catalog/components.md](../catalog/components.md) aligned with `registry/index.json`.
- Patterns stay in `docs/patterns/`. Do not add a workflow engine to express them.
- Secrets in examples are names only (`OPENAI_API_KEY=...` placeholders, never live keys).

Normative docs, in order of authority for runtime behavior:

1. [V1 Runtime Correction](../spec/V1-Runtime-Correction.md) (Host front door)
2. [V1 Implementation Specification](../spec/V1-Implementation-Specification.md) (taxonomy, registry, permissions, State)
3. [PRD](../PRD.md)

---

## 7. Pull requests

1. Branch from `main` with a focused name (`registry/tool-web-docs`, `host/ipc-timeout`).
2. Keep the diff to the stated concern.
3. Run `pnpm typecheck` and `pnpm test` before you open the PR.
4. Describe what changed, how you verified it, and any remaining risk.
5. Target `main`.

### PR description template

```text
## Intent
<one or two sentences>

## Changes
- …

## Verification
- pnpm typecheck
- pnpm test
- <extra commands, e.g. pnpm registry:index, pnpm test tests/registry>

## Invariants
No marketplace / orchestrator / secret values / unsafe file targets.
```

---

## 8. Publishing notes (maintainers)

- `schemas/` is copied into `packages/core/schemas` by `scripts/prepare-publish.mjs core`.
- `registry/` is copied into `packages/cli/registry` by `scripts/prepare-publish.mjs cli`.
- Do not treat `packages/cli/registry` as the source of truth while developing.

---

## 9. Safety reminder

Never commit API keys, tokens, or session cookies. Worker environments receive only the secret **names** a module declared. Path grants, Policies, and authorization gates are enforced in Host/Pi code, not in `instructions.md`.
