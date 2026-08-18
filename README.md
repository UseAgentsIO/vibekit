# VibeKit Agents

<p align="center">
  <strong>An always-running Agent Host for resilient, multi-agent software engineering systems.</strong>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js version"></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11.18.0-orange.svg" alt="pnpm version"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript"></a>
  <a href="https://vitest.dev/"><img src="https://img.shields.io/badge/tests-231%20passing-success.svg" alt="Tests passing"></a>
  <a href="https://www.npmjs.com/org/useagentsio"><img src="https://img.shields.io/badge/npm-%40useagentsio-crimson.svg" alt="npm scope"></a>
</p>

---

## 🎯 The Mental Model

> **Components are the pieces. Agents are useful compositions of those pieces. Projects are systems of Agents working against shared state. The Agent Host runs them.**

VibeKit is an **Agent Host** built on top of [Pi](https://github.com/earendil-works/pi). You create a Project, communicate with it through an Interface (such as your terminal), and the Host continuously executes Agents against durable, shared Project State.

Pi serves as the internal model and tool execution engine inside the Host. Users do **not** launch or interact with the Pi TUI directly.

> [!NOTE]
> **Package Scope:** The unscoped npm name `vibekit` is taken by an unrelated legacy project. All official packages are published under the **`@useagentsio`** scope (e.g., `@useagentsio/cli`, `@useagentsio/host`, `@useagentsio/core`). The CLI binary remains **`vibekit`**, and the Host binary is **`vibekit-host`**.

---

## ⚡ 30-Second Quickstart

Create and interact with a live agent project in three commands (no global install required):

```bash
# 1. Set your provider API key
export OPENAI_API_KEY="sk-proj-..."

# 2. Create a runnable Agent Project
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes

# 3. Message your agent
cd my-agent
vibekit msg "Hello! What can you help me with?"
```

To enter an interactive multi-turn session with the Host running in the foreground:

```bash
vibekit start
```

---

## 🏗️ Architecture

```text
                          Human Operator
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
     vibekit CLI                              terminal Interface
  (@useagentsio/cli)                  (@useagentsio/interface-terminal)
          │                                           │
          └─────────────────────┬─────────────────────┘
                                ▼
                           AGENT HOST
                       (@useagentsio/host)
                     (Always-Running Daemon)
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   PROJECT CONTRACT       STATE BACKEND           EMBEDDED PI
  (@useagentsio/core)  (@useagentsio/core)     (@useagentsio/pi)
  - project.yaml       - .vibekit/state/      - Session Factory
  - installed.json     - Tasks & Results      - Tool Bindings
  - Agent Recipes      - Conversations        - Worktree Sandboxes
  - Permissions        - Decisions/Approvals  - Worker Runs
```

---

## ✨ Key Features

- 🚀 **Instant Scaffolding (`create`)**: Generates fully-wired, runnable Agent projects with contracts, bindings, tools, and interfaces in seconds.
- 💬 **Flexible Interaction Modes**: Run single turn headless queries (`vibekit msg`) or maintain always-on foreground conversations (`vibekit start`).
- 🔒 **Defense-in-Depth Permissions**: Enforces permissions at the code boundary: $\text{Capability} \cap \text{Policy} \cap \text{Agent Grant} \cap \text{Task Scope} \cap \text{Current Authorization}$.
- 🌿 **Worktree Mutation Isolation**: Parallel coding tasks execute within dedicated Git worktrees to prevent workspace corruption.
- 🔄 **Three-Way Non-Destructive Lifecycle**: Install (`add`), inspect (`diff`), safely update (`update`), and cleanly remove (`remove`) modules without overwriting local customizations.
- 🩺 **Self-Healing Diagnostics (`doctor`)**: Validates JSON schemas, dependency trees, cycle freedom, and file integrity checksums.
- 📜 **Durable Machine-Verifiable State**: Transparent JSON documents stored in `.vibekit/state/` for Tasks, Results, Decisions, Approvals, and Conversations.

---

## 💻 CLI Commands Tour

```bash
Usage: vibekit [options] [command]

# Primary Runtime Commands
vibekit create [dir]     # Create a runnable Agent Project
vibekit msg <text>       # Send one turn through the Host to the Agent
vibekit start            # Run Host + terminal Interface in foreground
vibekit status           # Inspect Host and Interface health
vibekit model            # Select or change models from Pi's live catalog

# Composition & Project Management
vibekit init [dir]       # Initialize project with interactive setup wizard
vibekit add <type> <name># Install module from the official registry
vibekit list             # Show installed modules and status matrix
vibekit diff <module>    # Three-way compare (base vs local vs upstream)
vibekit update <module>  # Three-way non-destructive module update
vibekit remove <module>  # Safe removal protecting local edits
vibekit doctor           # Verify schemas, dependencies, and file integrity
vibekit migrate          # Upgrade schemaVersion 1 projects to schemaVersion 2
```

For complete flag descriptions and examples, see the **[CLI Reference](docs/cli/commands.md)**.

---

## 📦 Official Catalog

VibeKit ships with an official, curated registry of modular Agents and Components.

### Official Agents

| Agent ID | Role | Key Capabilities |
| :--- | :--- | :--- |
| **`agent:chief`** | Coordinator & Delegation | Coordinates user intent, decomposes epics, and delegates to specialized workers. |
| **`agent:coder`** | Bounded Implementation | Writes and refactors code inside isolated Git worktrees; emits artifacts & evidence. |
| **`agent:reviewer`** | Independent Review | Validates diffs and test results. Strictly isolated with no source write permissions. |
| **`agent:project-manager`** | Planning & Scope | Breaks requirements into discrete tasks with constraints and acceptance criteria. |
| **`agent:researcher`** | Cited Analysis | Researches documentation and codebases; emits cited decision records. |

### Official Components

| Component ID | Family | Runtime Kind | Description |
| :--- | :--- | :--- | :--- |
| **`provider:openai`** | Provider | `config` | OpenAI models (`OPENAI_API_KEY`) |
| **`provider:opencode-go`** | Provider | `config` | OpenCode API endpoint (`OPENCODE_API_KEY`) |
| **`provider:xai`** | Provider | `config` | xAI Grok models (`XAI_API_KEY`) |
| **`provider:openrouter`** | Provider | `config` | Multi-model routing (`OPENROUTER_API_KEY`) |
| **`tool:filesystem`** | Tool | `pi-builtin` | Pi filesystem tools (`read`, `grep`, `find`, `ls`, `write`, `edit`) |
| **`tool:execution`** | Tool | `pi-builtin` | Shell execution (`bash`) |
| **`tool:github`** | Tool | `config-only` | GitHub credential config reference (config-only in V1) |
| **`skill:software-development`**| Skill | `pi-skill` | Software development practices and guidelines |
| **`skill:research`** | Skill | `pi-skill` | Research and citation methodology |
| **`interface:terminal`** | Interface | `interface` | Interactive CLI / stdio interface |
| **`policy:least-privilege`** | Policy | `policy` | Path access and command whitelisting |
| **`policy:require-verification`**| Policy | `policy` | Mandates independent test verification |
| **`verifier:command`** | Verifier | `verifier` | Runs automated test commands against candidate revisions |
| **`state:repository`** | State | `state` | Filesystem JSON state storage backend |

---

## 🧩 Monorepo Packages

| Package | Version | Description |
| :--- | :--- | :--- |
| **[`@useagentsio/cli`](packages/cli)** | `0.3.0` | CLI binary (`vibekit`): `create`, `msg`, `start`, `add`, `doctor`, etc. |
| **[`@useagentsio/host`](packages/host)** | `0.2.0` | Always-running Agent Host daemon (`vibekit-host`) |
| **[`@useagentsio/core`](packages/core)** | `0.2.0` | JSON schemas, typed IDs, state drivers, and three-way diff engine |
| **[`@useagentsio/pi`](packages/pi)** | `0.2.0` | Embedded Pi adapter, worktree isolation manager, and delegation runtime |
| **[`@useagentsio/interface-sdk`](packages/interface-sdk)** | `0.1.0` | Interface protocol and lifecycle contract |
| **[`@useagentsio/interface-terminal`](packages/interface-terminal)** | `0.1.0` | Official Terminal interface implementation |

---

## 📖 Documentation Index

Explore full guides and technical references in the **[`docs/`](docs/)** directory:

- **Getting Started**:
  - [Quickstart Tutorial](docs/getting-started/quickstart.md)
  - [Installation & Setup](docs/getting-started/installation.md)
  - [Core Concepts](docs/getting-started/core-concepts.md)
- **Architecture & Design**:
  - [System Architecture Overview](docs/architecture/overview.md)
  - [Persistent Sessions vs. Worker Runs](docs/architecture/sessions-and-runs.md)
  - [State & Persistence Model](docs/architecture/state-and-persistence.md)
  - [Security & Runtime Permissions](docs/architecture/security-and-permissions.md)
- **CLI & Workflows**:
  - [CLI Overview & Global Options](docs/cli/overview.md)
  - [Command Reference](docs/cli/commands.md)
  - [Project Lifecycle & Diagnostics](docs/cli/project-lifecycle.md)
- **Configuration**:
  - [project.yaml Reference](docs/configuration/project-yaml.md)
  - [Project Layout](docs/configuration/project-layout.md)
  - [Installed Manifest (installed.json)](docs/configuration/installed-manifest.md)
- **Catalog & Registry**:
  - [Registry Overview](docs/catalog/overview.md)
  - [Official Agents](docs/catalog/agents.md)
  - [Official Components](docs/catalog/components.md)
- **API & SDK Reference**:
  - [API Overview](docs/api/overview.md)
  - [@useagentsio/host](docs/api/host.md)
  - [@useagentsio/core](docs/api/core.md)
  - [@useagentsio/pi](docs/api/pi.md)
  - [@useagentsio/interface-sdk](docs/api/interface-sdk.md)
- **Multi-Agent Patterns**:
  - [Patterns Index](docs/patterns/README.md)
  - [Chief → Coder → Reviewer](docs/patterns/chief-coder-reviewer.md)
  - [Parallel Coding Worktrees](docs/patterns/parallel-coding-worktrees.md)
  - [Proposal → Verification → Approval → Apply](docs/patterns/proposal-verification-approval-apply.md)
- **Contributing**:
  - [Contributing Guidelines](docs/contributing/guide.md)
  - [Module Authoring](docs/contributing/module-authoring.md)
- **Normative Specifications**:
  - [V1 Implementation Specification](docs/spec/V1-Implementation-Specification.md)
  - [V1 Runtime Correction](docs/spec/V1-Runtime-Correction.md)

---

## 🛡️ Security & Invariants

- **Secrets as References Only**: API keys and tokens are never written into YAML/JSON files, state records, logs, or fixtures. Only variable names and sources (`{ name, source: "environment" }`) are stored.
- **Relative Path Sandboxing**: File operations are strictly scoped to relative paths. Traversal (`..`), root paths (`/`), and null bytes are rejected.
- **Runtime-Enforced Boundaries**: Security policies are evaluated directly in TypeScript runtime code before tool execution—never delegated to LLM prompts.
- **Untrusted Input Defense**: User inputs, web scrapes, and external tool outputs are treated as untrusted data and cannot elevate agent permissions.

---

## 🛠️ Local Development

```bash
# Clone the repository
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit

# Install dependencies
pnpm install

# Run test suites (Vitest)
pnpm test

# Rebuild official registry index
pnpm registry:index
```

---

## 📄 License

Published packages are `UNLICENSED`. All rights reserved.
