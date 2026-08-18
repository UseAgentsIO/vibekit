# VibeKit Agents

**Components are the pieces. Agents are useful compositions of those pieces. Projects are systems of Agents working against shared state. The Agent Host runs them.**

VibeKit is an always-running Agent Host. You create a Project, talk to it through an Interface, and the Host runs Agents against shared Project State. [Pi](https://github.com/earendil-works/pi) is the embedded model/tool engine inside the Host. Users do not launch the Pi TUI.

> Working product name. The unscoped npm name `vibekit` is taken by an unrelated project. Published packages use the **`@useagentsio`** scope. The CLI binary is still `vibekit`. The Host binary is `vibekit-host`. License is `UNLICENSED`.

[Runtime correction](docs/spec/V1-Runtime-Correction.md) · [Specification](docs/spec/V1-Implementation-Specification.md) · [Source](https://github.com/UseAgentsIO/vibekit) · [npm](https://www.npmjs.com/org/useagentsio)

## Quick start

```bash
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes
cd my-agent
vibekit msg "Hello"
```

`create` writes a runnable Agent Project: contracts, an Agent binding, a provider, and the terminal Interface. `msg` sends one turn through the Host to the configured provider.

Keep talking, or leave the Host in the foreground:

```bash
vibekit msg "What can you do?"
vibekit start
```

`start` runs the Host plus the terminal Interface in the foreground. Set the provider secret in the environment first (`OPENAI_API_KEY` for `--provider openai`). Secrets are **references** in Project files — never values.

Composition commands stay available after create:

```bash
vibekit add agent reviewer --yes
vibekit list
vibekit doctor
```

## Status

The product is the Agent Host, not a catalog installer. Slack and Telegram are planned Interfaces and are **not** in this drop. Mocked Pi sessions remain valid as unit tests; they are not the product claim.

| Area | State |
| --- | --- |
| Schemas, typed IDs, validation | Done |
| Official registry + composition CLI | Done |
| `diff` / `update` / `remove` (three-way, no silent overwrite) | Done |
| Project State (`state:repository`) | Done |
| Embedded Pi adapter | Done |
| Agent Host + terminal Interface | This drop |
| `create` / `msg` / `start` | This drop |
| Slack Interface | Planned — not in this drop |
| Telegram Interface | Planned — not in this drop |

Packages:

| Package | Role |
| --- | --- |
| [`@useagentsio/cli`](https://www.npmjs.com/package/@useagentsio/cli) | CLI (`vibekit` bin): `create`, `msg`, `start`, and composition |
| [`@useagentsio/host`](https://www.npmjs.com/package/@useagentsio/host) | Always-running Agent Host (`vibekit-host`) |
| [`@useagentsio/core`](https://www.npmjs.com/package/@useagentsio/core) | Schemas, IDs, graph, install, ownership, State |
| [`@useagentsio/pi`](https://www.npmjs.com/package/@useagentsio/pi) | Embedded Pi adapter — not a user-facing TUI |
| [`@useagentsio/interface-sdk`](https://www.npmjs.com/package/@useagentsio/interface-sdk) | Interface contract used by the Host |
| [`@useagentsio/interface-terminal`](https://www.npmjs.com/package/@useagentsio/interface-terminal) | Terminal Interface |

The official registry ships inside `@useagentsio/cli`. Override it with `--registry <path>` or `VIBEKIT_REGISTRY`.

`pnpm test` and `pnpm typecheck` are the local gates.

## Requirements

- [Node.js](https://nodejs.org/) **>= 20**
- [pnpm](https://pnpm.io/) **11** (this repo pins `packageManager`)
- A provider credential in the environment (for example `OPENAI_API_KEY`)

## Install

```bash
npm install -g --ignore-scripts @useagentsio/cli@latest
vibekit --help
```

Or without a global install:

```bash
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes
```

Do not install the unscoped npm package `vibekit`; it is unrelated. Prefer `@latest` of `@useagentsio/cli` (use `0.2.0` or later — `0.1.0` does not run as a global bin).

Libraries, when you are embedding rather than using the CLI:

```bash
npm install @useagentsio/core @useagentsio/pi @useagentsio/host @useagentsio/interface-sdk
```

### From this repository

```bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
pnpm exec tsx packages/cli/src/index.ts --help
```

## CLI

```text
Usage: vibekit [options] [command]

run and compose Agent Projects

vibekit --help
vibekit create --help
vibekit msg --help
```

### Run

| Command | What it does |
| --- | --- |
| `create` | Writes a runnable Agent Project (Agent, provider, Interface, Host wiring). |
| `msg` | Sends one turn through the Host to the configured provider. |
| `start` | Foreground Host + terminal Interface. |

### Compose

`init` / `add` / `list` / `diff` / `update` / `remove` / `doctor` remain for composition. They are not the first user path.

Selectors accept `type name`, `type:name`, and `type:name@version`.

| Command | What it does |
| --- | --- |
| `init` | Creates `.vibekit/project.yaml` and `installed.json` without installing an Agent. |
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
vibekit create ./ops --agent chief --provider openai --interface terminal --yes
cd ./ops
vibekit msg "Summarize open Tasks"
vibekit start

vibekit add tool filesystem --yes
vibekit add agent reviewer --yes
vibekit add policy require-verification --yes

vibekit diff agent:coder
vibekit update agent:coder --yes
vibekit remove skill:research --yes
```

`--yes` is required for `create`, `add`, `update`, and `remove` when stdin is not a TTY.

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

| ID | Family | Runtime |
| --- | --- | --- |
| `provider:openai` | Provider (API key `OPENAI_API_KEY`) | Provider config |
| `provider:openai-codex` | Provider (OAuth login) | Provider config |
| `provider:opencode-go` | Provider (`OPENCODE_API_KEY`) | Provider config |
| `provider:xai` | Provider (OAuth, optional `XAI_API_KEY`) | Provider config |
| `provider:openrouter` | Provider (`OPENROUTER_API_KEY`) | Provider config |
| `tool:filesystem` | Tool | Pi builtins: `read`, `grep`, `find`, `ls`, `write`, `edit` |
| `tool:execution` | Tool | Pi builtin: `bash` |
| `tool:github` | Config only (`GITHUB_TOKEN` reference) | **Not** an executable Tool in this drop |
| `skill:software-development` | Skill | Pi Skill |
| `skill:research` | Skill | Pi Skill |
| `interface:terminal` | Interface | `@useagentsio/interface-terminal` (this drop) |
| `state:repository` | State | Repository State |
| `policy:least-privilege` | Policy | Policy |
| `policy:require-verification` | Policy | Policy |
| `verifier:command` | Verifier | Command verifier |

Slack and Telegram are planned Interfaces. They are not catalog entries in this drop.

Rebuild the registry index after catalog edits:

```bash
pnpm registry:index
```

## Project layout

After `create` (or `init` + `add`):

```text
.
├── .pi/                      # Pi-native files used by the embedded engine
│   ├── extensions/
│   ├── skills/
│   └── settings.json
└── .vibekit/                 # VibeKit-owned
    ├── project.yaml          # Project contract
    ├── installed.json        # ownership, hashes, versions
    ├── agents/chief/         # editable Agent recipe
    ├── components/
    ├── config/
    ├── state/                # Tasks, Results, Decisions, conversations
    └── runtime/              # gitignored: claims, locks, staging
```

Tracked by default: `project.yaml`, `installed.json`, Agent definitions, Policies, Verifiers, non-secret config, accepted Decisions. `.vibekit/runtime/` must not be committed. Secrets are **references** (`source: environment`) — never values.

## Packages

| Path | Package | Role |
| --- | --- | --- |
| `packages/cli` | `@useagentsio/cli` | User-facing CLI (`vibekit` bin) |
| `packages/host` | `@useagentsio/host` | Always-running Agent Host (`vibekit-host`) |
| `packages/core` | `@useagentsio/core` | Schemas, IDs, graph, install, ownership, State |
| `packages/pi` | `@useagentsio/pi` | Embedded Pi adapter |
| `packages/interface-sdk` | `@useagentsio/interface-sdk` | Interface contract |
| `packages/interface-terminal` | `@useagentsio/interface-terminal` | Terminal Interface |
| `schemas/` | — | JSON Schema source of truth |
| `registry/` | — | Official Components and Agents |
| `docs/spec/` | — | V1 specification + runtime correction |
| `docs/patterns/` | — | Docs-only composition patterns |
| `fixtures/` | — | Valid and invalid contract examples |
| `tests/` | — | Schema, CLI, registry, composition, state, runtime, e2e |

Library usage (TypeScript):

```ts
import { parseAndValidateYaml, createRepositoryState } from "@useagentsio/core";
import { prepareIsolatedRun, runIsolated } from "@useagentsio/pi";

const { valid, data, errors } = parseAndValidateYaml("agent", yamlText);
const state = createRepositoryState({ projectRoot });
const outcome = await runIsolated({
  projectRoot,
  bindingName: "coder",
  task,
  createSession, // inject in unit tests; the Host embeds live Pi
});
```

`@useagentsio/pi` returns Events and a Result. It does not persist them. The Host persists State and owns conversations. The default session factory dynamic-imports `@earendil-works/pi-coding-agent`. Users still do not launch the Pi TUI.

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
Human
        │
        ▼
CLI (create / msg / start)     terminal Interface
        │                              │
        └──────────────┬───────────────┘
                       ▼
                 Agent Host              always-running product
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Project       State      embedded Pi
     contracts      Tasks      model + tools
     permissions    Results    worker Runs
                       │
                       ▼
              Interfaces (adapters)
           terminal     Slack*    Telegram*
                         * planned, not in this drop
```

Authorization is **Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ current authorization**, enforced at the Host / tool boundary — not in the prompt.

There is no `orchestrator` type, no `subagent` type, and no “Blocks.” Delegation is an Agent capability. Patterns are documentation, not a second workflow engine.

## Roadmap

The locked V1 composition work (schemas, registry, ownership, State, Pi adapter, catalog) stays. The running product is the Host plus the terminal Interface.

Out of this drop: Slack, Telegram, marketplace, third-party registries, graphical builder, DB/remote state, automatic merge of conflicting user edits, a Pi fork, and any `orchestrator` / `subagent` / Blocks type.

See [V1-Runtime-Correction.md](docs/spec/V1-Runtime-Correction.md) for Host, Interface SDK, and session rules. Lean V1 vs deferred work in the [specification](docs/spec/V1-Implementation-Specification.md) (§37) still applies except where the correction supersedes the old front door.

## Contributing

1. Open an issue or pick one against the spec and the runtime correction.
2. Keep changes inside the current drop’s exit criteria when possible.
3. Do not add a Pi fork, marketplace, Slack/Telegram packages, or a second Agent runtime.
4. Secrets stay references. File targets stay relative (no `..`, no absolute paths).
5. `pnpm typecheck` and `pnpm test` must pass.

Module authors: follow existing `registry/**/module.yaml` entries. Registry checks reject missing licenses, unsafe file targets, duplicate IDs, undeclared required deps, and likely secret values. Declare `runtime` honestly: do not mark a config-only Module as an executable Tool.

## Security

- Do not commit API keys, tokens, or `.env` files.
- VibeKit records secret **names and sources**, never values.
- Treat issue text, web content, tool output, and retrieved memory as untrusted data — not higher-priority instructions.
- Report vulnerabilities privately to the [UseAgentsIO](https://github.com/UseAgentsIO) maintainers rather than opening a public issue with exploit detail.

## License

Published packages are `UNLICENSED`. The architecture document leaves the public license outside the implementation lock. All rights reserved until a license is chosen.

## Links

- Runtime correction: [docs/spec/V1-Runtime-Correction.md](docs/spec/V1-Runtime-Correction.md)
- Spec: [docs/spec/V1-Implementation-Specification.md](docs/spec/V1-Implementation-Specification.md)
- Patterns: [docs/patterns/](docs/patterns/)
- Pi: [pi.dev](https://pi.dev/) · [earendil-works/pi](https://github.com/earendil-works/pi)
- Org: [github.com/UseAgentsIO](https://github.com/UseAgentsIO)
