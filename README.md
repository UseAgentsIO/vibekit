# VibeKit Agents

**Components are the pieces. Agents are useful compositions of those pieces. Projects are systems of Agents working against shared state. [Pi](https://github.com/earendil-works/pi) runs them.**

VibeKit is a thin composition layer over Pi. It owns contracts, installation, the official registry, Project State, permissions, and verification. Pi owns the model, the session, providers, Skills, extensions, and the tool-calling loop. VibeKit does not fork Pi and does not replace Pi’s Agent loop.

> Working name. Package names (`vibekit`, `@vibekit/core`, `@vibekit/pi`) and the public license are not final. Packages are **not published to npm** yet — use this repository.

[Specification](docs/spec/V1-Implementation-Specification.md) · [Source](https://github.com/UseAgentsIO/vibekit)

## Status

V1 is being implemented against a locked architecture. What works in this tree today:

| Area | State |
| --- | --- |
| Schemas, typed IDs, validation | Done |
| Official registry + `init` / `add` / `list` / `doctor` | Done |
| `diff` / `update` / `remove` (three-way, no silent overwrite) | Done |
| Project State (`state:repository`) | Done |
| `@vibekit/pi` isolated Run (mocked/injected session in tests) | Skeleton |
| Delegation, worktrees, claims | In progress |
| Deterministic verification + propose → apply | In progress |
| Official Agent catalog | Drafts installable as Modules |
| Slack Interface | Deferred (Phase 9) |

`pnpm test` and `pnpm typecheck` are the local gates.

## Requirements

- [Node.js](https://nodejs.org/) **>= 20**
- [pnpm](https://pnpm.io/) **11** (this repo pins `packageManager`)
- A [Pi](https://pi.dev/) project, or let `vibekit init` create a minimal `.pi/` fixture

## Install from source

```bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
```

The CLI is the `vibekit` workspace package. Until it is published:

```bash
# from the repo root
pnpm exec tsx packages/cli/src/index.ts --help

# or after a build
pnpm typecheck
node packages/cli/dist/index.js --help
```

The rest of this README writes `vibekit` for the command. Prefix it with `pnpm exec tsx packages/cli/src/index.ts` while developing from this checkout.

The official registry is the in-repo `registry/` directory. Override it with `--registry <path>` or `VIBEKIT_REGISTRY`.

## Quick start

```bash
# 1. Create a VibeKit Project (adds .vibekit/ and a thin Pi extension stub)
vibekit init ./my-app

# 2. Install an Agent and its required dependencies
vibekit add agent coder --yes --dir ./my-app

# 3. See what is installed vs available
vibekit list --dir ./my-app

# 4. Validate composition
vibekit doctor --dir ./my-app
```

`init` does not install an Agent unless you add one. `--yes` is required for `add`, `update`, and `remove` when stdin is not a TTY.

## CLI

```text
vibekit init [dir] [--yes] [--registry <path>]
vibekit add <type> <name> [--yes] [--registry <path>] [--dir <path>]
vibekit list [--registry <path>] [--dir <path>]
vibekit diff <type:name> [--registry <path>] [--dir <path>]
vibekit update <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit remove <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit doctor [--registry <path>] [--dir <path>]
```

Selectors accept `type name`, `type:name`, and `type:name@version`.

| Command | What it does |
| --- | --- |
| `init` | Creates `.vibekit/project.yaml` and `installed.json`. If the target is not already a Pi project, writes a minimal `.pi/` tree. Runs `doctor`. |
| `add` | Resolves the Module and required dependencies, checks compatibility / ownership / conflicts, prints requested permissions, then applies atomically. |
| `list` | Shows each Module’s id, version, source, and four separate statuses: **installed**, **configured**, **available**, **verified**. |
| `diff` | Read-only three-way compare: installed registry version, your files, newest compatible registry version. |
| `update` | Three-way update. Local+upstream both changed → **conflict, entire Module stops**. No `--force` in V1. |
| `remove` | Deletes unchanged exclusive files. Modified files stop removal. Shared dependencies stay installed. |
| `doctor` | Validates schemas, ownership, dependencies, cycles, conflicts, and installed-manifest integrity. Does not silently repair consequential issues. |

Global flags:

| Flag | Meaning |
| --- | --- |
| `-y`, `--yes` | Confirm a mutating command (required when not on a TTY) |
| `--dir <path>` | Project root (default: current directory) |
| `--registry <path>` | Registry root (default: `VIBEKIT_REGISTRY` or this repo’s `registry/`) |
| `-h`, `--help` | Usage |

Examples:

```bash
vibekit add tool github --yes
vibekit add agent reviewer --yes
vibekit add policy require-verification --yes

vibekit diff agent:coder
vibekit update agent:coder --yes
vibekit update tool:github@1.1.0 --yes
vibekit remove skill:research --yes
```

## Official catalog

The V1 registry is **official, not a marketplace**. Third-party registries are deferred.

### Agents

| ID | Role |
| --- | --- |
| `agent:coder` | Bounded implementation. Returns artifacts and evidence. |
| `agent:reviewer` | Independent review. Does not satisfy review of its own work. |
| `agent:researcher` | Cited research. No `source.write` by default. |
| `agent:project-manager` | Scope and tasking. May delegate to workers. |
| `agent:chief` | Composition. Delegates to PM, coder, reviewer, researcher. |

Installing an Agent copies `agent.yaml` and `instructions.md` into `.vibekit/agents/<name>/`. You own those files.

### Components

| ID | Family |
| --- | --- |
| `provider:openai` | Provider (Pi config + `OPENAI_API_KEY` reference) |
| `tool:filesystem` | Tool |
| `tool:execution` | Tool |
| `tool:github` | Tool (`GITHUB_TOKEN` reference) |
| `skill:software-development` | Skill |
| `skill:research` | Skill |
| `interface:terminal` | Interface (first; Slack later) |
| `state:repository` | State |
| `policy:least-privilege` | Policy |
| `policy:require-verification` | Policy |
| `verifier:command` | Verifier |

Rebuild the registry index after catalog edits:

```bash
pnpm registry:index
```

## Project layout

After `init` + `add agent coder`:

```text
.
├── .pi/                      # Pi-native files (not replaced)
│   ├── extensions/
│   ├── skills/
│   └── settings.json
└── .vibekit/                 # VibeKit-owned
    ├── project.yaml          # Project contract
    ├── installed.json        # ownership, hashes, versions
    ├── agents/coder/         # editable Agent recipe
    ├── components/
    ├── config/
    ├── state/                # Tasks, Results, Decisions, …
    └── runtime/              # gitignored: claims, locks, staging
```

Tracked by default: `project.yaml`, `installed.json`, Agent definitions, Policies, Verifiers, non-secret config, accepted Decisions. `.vibekit/runtime/` must not be committed. Secrets are **references** (`source: environment`) — never values.

## Packages

| Path | Package | Role |
| --- | --- | --- |
| `packages/cli` | `vibekit` | User-facing CLI |
| `packages/core` | `@vibekit/core` | Schemas, IDs, graph, install, ownership, State |
| `packages/pi` | `@vibekit/pi` | Resolve a Project into an isolated Pi Run |
| `schemas/` | — | JSON Schema source of truth |
| `registry/` | — | Official Components and Agents |
| `docs/spec/` | — | Locked V1 specification |
| `docs/patterns/` | — | Docs-only composition patterns |
| `fixtures/` | — | Valid and invalid contract examples |
| `tests/` | — | Schema, CLI, registry, composition, state, runtime |

Library usage (TypeScript):

```ts
import { parseAndValidateYaml, createRepositoryState } from "@vibekit/core";
import { prepareIsolatedRun, runIsolated } from "@vibekit/pi";

const { valid, data, errors } = parseAndValidateYaml("agent", yamlText);
const state = createRepositoryState({ projectRoot });
const outcome = await runIsolated({
  projectRoot,
  bindingName: "coder",
  task,
  createSession, // inject in tests
});
```

`@vibekit/pi` returns Events and a Result. It does not persist them. The default session factory dynamic-imports `@earendil-works/pi-coding-agent`.

## Development

```bash
pnpm install
pnpm typecheck          # tsc -b
pnpm test               # vitest run
pnpm test tests/cli     # one suite
pnpm registry:index     # validate modules + write registry/index.json
```

Node `>= 20`. TypeScript, pnpm workspaces, Vitest. See [AGENTS.md](AGENTS.md) for agent-facing conventions.

## How it fits together

```text
Interface (terminal / later Slack)
        │
        ▼
     Project          contracts, Agents, State, Tasks, Approvals
        │
        ▼
     VibeKit          schemas, install, permissions, claims, verifiers
        │
        ▼
        Pi            models, sessions, tools, Skills, the loop
```

Authorization is **Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ current authorization**, enforced at the tool/adapter boundary — not in the prompt.

There is no `orchestrator` type, no `subagent` type, and no “Blocks.” Delegation is an Agent capability. Patterns are documentation, not a second workflow engine.

## Roadmap

1. Schemas and contracts
2. Registry and CLI foundation
3. Safe ownership and updates
4. Project State
5. Pi runtime adapter
6. Delegation and concurrency
7. Verification and application
8. Official Agent catalog (install + `doctor` e2e)
9. Slack Interface (deferred)

Lean V1 vs deferred work is listed in the [specification](docs/spec/V1-Implementation-Specification.md) (§37). Out of V1: marketplace, third-party registries, graphical builder, DB/remote state, automatic merge of conflicting user edits.

## Contributing

1. Open an issue or pick one against the spec.
2. Keep changes inside one phase’s exit criteria when possible.
3. Do not add a Pi fork, marketplace, or a second Agent runtime.
4. Secrets stay references. File targets stay relative (no `..`, no absolute paths).
5. `pnpm typecheck` and `pnpm test` must pass.

Module authors: follow existing `registry/**/module.yaml` entries. Registry checks reject missing licenses, unsafe file targets, duplicate IDs, undeclared required deps, and likely secret values.

## Security

- Do not commit API keys, tokens, or `.env` files.
- VibeKit records secret **names and sources**, never values.
- Treat issue text, web content, tool output, and retrieved memory as untrusted data — not higher-priority instructions.
- Report vulnerabilities privately to the [UseAgentsIO](https://github.com/UseAgentsIO) maintainers rather than opening a public issue with exploit detail.

## License

No public license is attached yet. The architecture document leaves license and commercial terms outside the implementation lock. Do not republish packages or registry payloads until a license is chosen. All rights reserved until then.

## Links

- Spec: [docs/spec/V1-Implementation-Specification.md](docs/spec/V1-Implementation-Specification.md)
- Patterns: [docs/patterns/](docs/patterns/)
- Pi: [pi.dev](https://pi.dev/) · [earendil-works/pi](https://github.com/earendil-works/pi)
- Org: [github.com/UseAgentsIO](https://github.com/UseAgentsIO)
