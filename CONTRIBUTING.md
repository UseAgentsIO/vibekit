# Contributing to VibeKit

Thank you for contributing. VibeKit is an always-running **Agent Host**. The product is a running Project, not a configuration CLI and not a standalone Pi TUI.

> **VibeKit runs Projects composed of Agents built from Components, using embedded Pi sessions to perform Tasks and persist structured Results and State.**

This document is the contribution contract. Detailed workflows live in:

- [Development guide](docs/contributing/guide.md) — workspace, tests, code standards, pull requests
- [Module authoring](docs/contributing/module-authoring.md) — official registry Agents and Components
- [PRD](docs/PRD.md) — product model
- [V1 Implementation Specification](docs/spec/V1-Implementation-Specification.md) and [V1 Runtime Correction](docs/spec/V1-Runtime-Correction.md) — normative behavior

## Ways to contribute

| Kind | Typical files | Start here |
| :--- | :--- | :--- |
| Official registry module | `registry/`, `tests/registry/`, catalog docs | [Module authoring](docs/contributing/module-authoring.md) |
| Runtime / package code | `packages/*`, `tests/` | [Development guide](docs/contributing/guide.md) |
| Schemas | `schemas/` (copied into `@useagentsio/core` on publish) | Spec + `tests/schemas/` |
| Documentation | `docs/`, `README.md` | This file + [docs/README.md](docs/README.md) |
| Patterns | `docs/patterns/` | Patterns are documentation, not a workflow DSL |

Open an issue or discussion before large design changes. Small, focused pull requests against `main` are preferred.

## Product model (do not invent a parallel taxonomy)

```text
Components → Agents → Project → Host
                              ↓
                             Pi (embedded)
```

- **Components** are atomic modules: providers, tools, skills, interfaces, policies, verifiers, state backends.
- **Agents** are compositions of Components. A Chief is an Agent that may delegate. A Coder is an Agent configured for implementation. There is no `orchestrator` or `subagent` type.
- **Projects** (`.vibekit/project.yaml`) are the composition boundary.
- **The Host** (`vibekit-host`) is the running product. Interfaces are I/O adapters only.
- **Pi** is the embedded model/tool engine. Users must not be told to launch the Pi TUI.
- **Patterns** (Chief → Coder → Reviewer, and so on) are composition conventions, not a separate workflow language.

Installing a registry module copies files into the Project. Those files become locally owned and editable. Updates are three-way (base vs local vs upstream). Conflicts stop; there is no `--force`.

## Invariants

These are not style preferences. PRs that violate them will be rejected.

1. **Official registry only.** Do not add a marketplace, third-party registries, or a graphical builder.
2. **No `orchestrator`, `subagent`, or `Blocks` types.** Delegation is an Agent capability.
3. **Do not fork Pi.** Consume it as the embedded engine.
4. **Secrets are references only.** Store `{ name: OPENAI_API_KEY, source: environment }`. Never write secret values into YAML, JSON, State, Events, logs, fixtures, or examples.
5. **File targets are relative.** Reject `..`, absolute paths, null bytes, home expansion, and URL schemes. Targets must stay inside the Project (typically `.vibekit/` or `.pi/`).
6. **Permissions are enforced in code** at the tool/adapter boundary: Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ current authorization. A prompt cannot grant authority.
7. **Interfaces do not own Project State**, permissions, or Agent recipes.
8. **Completed ≠ verified ≠ accepted ≠ applied.** Do not collapse those stages.
9. **Conversation sessions and Worker Runs stay separate.** Persistent conversations are long-lived human interaction. Worker Runs are bounded Tasks that emit structured Results and terminate.
10. **Install / update / remove are transactional.** Do not silently overwrite local edits.
11. **Runtime honesty.** If a module is not executable in this drop, declare `runtime.kind: config-only` and `available: false`. Do not advertise a config stub as a Tool.

## Development setup

```bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
pnpm test
pnpm typecheck
```

- Node.js `>= 20`
- pnpm `11.18.0` (see `packageManager` in the root `package.json`)

Run the local CLI with:

```bash
pnpm exec tsx packages/cli/src/index.ts --help
```

Do not use the unscoped npm package named `vibekit`. Official packages are `@useagentsio/*`. Binaries are `vibekit` and `vibekit-host`.

## Registry contributions (summary)

The official catalog lives in `registry/` and is indexed by `registry/index.json`. The CLI bundles a copy at publish time (`packages/cli/registry`).

Layout:

```text
registry/
├── index.json
├── agents/<name>/<version>/
│   ├── module.yaml
│   └── payload/
│       ├── agent.yaml
│       └── instructions.md
└── components/<family>/<name>/<version>/
    ├── module.yaml
    ├── config.schema.json
    └── payload/
```

IDs are `type:name` in lowercase kebab-case (`agent:coder`, `tool:filesystem`, `interface:terminal`).

After adding or changing a module:

```bash
pnpm registry:index
pnpm test tests/registry
```

Commit the module files **and** the regenerated `registry/index.json`. Add the new ID to `tests/registry/official.test.ts`. Update [docs/catalog/agents.md](docs/catalog/agents.md) or [docs/catalog/components.md](docs/catalog/components.md).

Full contract, examples, and checklist: [Module authoring](docs/contributing/module-authoring.md).

## Pull request checklist

- [ ] Change is scoped to one concern (one module family, one package, or one docs topic).
- [ ] Invariants above still hold.
- [ ] `pnpm typecheck` and `pnpm test` pass.
- [ ] Registry edits ran `pnpm registry:index` and updated catalog docs plus `tests/registry/official.test.ts`.
- [ ] No secret values, absolute file targets, or new taxonomy types.
- [ ] Docs and README catalog tables stay in sync when modules or commands change.

## Out of scope unless maintainers ask

- Third-party registries or a marketplace
- `orchestrator` / `subagent` / `Blocks`
- Forking or replacing Pi
- Collapsing verification / acceptance / apply into “the Agent said it is done”
- Teaching users to launch the Pi TUI

## License

Published packages are `UNLICENSED` unless a module’s `module.yaml` declares otherwise. Official registry modules currently declare `MIT`.
