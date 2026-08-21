# VibeKit Agents

<p align="center">
  <strong>An always-running Agent Host for resilient, multi-agent software engineering systems.</strong>
</p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node.js version"></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11.18.0-orange.svg" alt="pnpm version"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript"></a>
  <a href="https://vitest.dev/"><img src="https://img.shields.io/badge/tests-382%20passing-success.svg" alt="Tests passing"></a>
  <a href="https://www.npmjs.com/org/useagentsio"><img src="https://img.shields.io/badge/npm-%40useagentsio-crimson.svg" alt="npm scope"></a>
</p>

---

## 🎯 The Core Mental Model

> **VibeKit runs Projects composed of Agents built from Components, using embedded Pi sessions to perform Tasks and persist structured Results and State.**

VibeKit organizes autonomous multi-agent systems around a clean, layered taxonomy:

$$\textbf{Components} \longrightarrow \textbf{Agents} \longrightarrow \textbf{Project} \longrightarrow \textbf{Host}$$

* **Components** are atomic, reusable building blocks (providers, tools, skills, interfaces, policies, verifiers, state).
* **Agents** are useful compositions of Components configured with specific capabilities, permissions, and instructions.
* **Projects** compose Agents and Components into a working system with clear delegation rules and boundaries (`.vibekit/project.yaml`).
* **The Host** is the always-running product daemon that coordinates interfaces, executes agent work, enforces permissions, and persists durable state.
* **Pi** is the internal model and tool execution engine embedded underneath the Host.

Registry Modules are VibeKit's composition and distribution abstraction. Their canonical identity is a registry ID such as `tool:browser` or `interface:telegram`. Internal built-ins resolve inside the product; independently distributed Components may use npm runtime metadata.

The official registry is the default curated registry. Independently authored Modules can conform to the same runtime, compatibility, ownership, permission, and security rules. Local/custom registry paths are supported now; hosted registries and a marketplace are not.

```text
Human
  ↓
Interface
  ↓
Host
  ↓
Project
  ↓
Agent
  ↓
Pi
  ↓
Model + Tools
```

> [!NOTE]
> **Users interact with VibeKit through connections—never directly with Pi.** Sessions are managed and isolated internally by the Host.
>
> **Product package:** The consolidated release will be published as **`@useagentsio/vibekit`** and leaves the **`vibekit`** command on `PATH`. It is not published yet; the local tarball flow in [the contributor guide](docs/contributing/guide.md#local-product-tarball) is the current release proof.

---

## ⚡ Start with VibeKit

The public release path is one install, one product command, and one first conversation. The package is not published yet, so do not run this npm command until the release is explicitly available:

```bash
# Install the product once; this leaves the durable vibekit command on PATH.
npm install --global --ignore-scripts @useagentsio/vibekit@latest

# Let VibeKit set up the assistant, model, abilities, memory, and connection.
vibekit
```

Choose a model and provide its authentication when setup asks. Keep the useful defaults, then send a real request when the terminal connection opens:

```text
Help me plan the next three things I should finish today.
```

The first reply proves the model, Host, abilities, memory, and connection are ready. For the current unpublished source checkout, build the local product tarball and run the clean-home proof described in [Local product tarball](docs/contributing/guide.md#local-product-tarball).

### Useful next actions

After the first conversation, use the commands that match what you want to do:

```bash
vibekit status                 # See readiness, model sign-in, connections, and Host health
vibekit model                  # Change the model
vibekit config                 # Review user-facing choices
vibekit connect telegram       # Add a guided channel connection
vibekit add tool browser       # Give the assistant another ability
vibekit doctor                 # Check and safely repair mechanical issues
```

The [Quickstart](docs/getting-started/quickstart.md) has the short user path. Architecture, registry, and contributor material comes after it.

---

## 🏗️ Architecture (optional reading)

```text
                          Human Operator
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
     vibekit product                         terminal connection
  (install once per machine)                 (I/O adapter only)
  (setup / msg / start)
          │                                           │
          └─────────────────────┬─────────────────────┘
                                ▼
                            AGENT HOST
                      (Always-Running Daemon)
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   PROJECT CONTRACT       STATE BACKEND           EMBEDDED PI
  - project.yaml       - .vibekit/state/      - Session Factory
  - installed.json     - Tasks & Results      - Tool Bindings
  - Agent Recipes      - Conversations        - Worktree Sandboxes
  - Permissions        - Decisions/Approvals  - Worker Runs
```

---

## 🔑 Key Concepts

### 1. Abilities (the things your assistant can do)
Abilities are the user-facing selection of reusable Components installed from the official registry into your Project:
- **Providers**: Model vendor configurations (e.g., `provider:openai`, `provider:openai-codex`, `provider:opencode-go`, `provider:xai`, `provider:openrouter`).
- **Tools**: Toolsets for system interactions (e.g., `tool:filesystem`, `tool:execution`, `tool:github`).
- **Skills**: Structured domain guidelines and prompt instructions (e.g., `skill:software-development`, `skill:research`).
- **Interfaces**: I/O adapters that connect external channels to the Host (e.g., `interface:terminal`).
- **Policies**: Governance and permission constraints (e.g., `policy:least-privilege`, `policy:require-verification`).
- **Verifiers**: Deterministic check runners (e.g., `verifier:command`).
- **State Backends**: Storage drivers for project records (e.g., `state:repository`).

### 2. Agents (Compositions as Ordinary Peers)
An Agent is a configured composition of Components defining instructions, capabilities, permissions, and delegation targets. **Agents are ordinary peers**—there is no separate orchestrator or subagent type. A Chief is simply an Agent with permission to delegate. A Coder is an Agent configured for implementation.

### 3. Projects (The durable workspace)
Represented by `.vibekit/project.yaml`, the Project defines which assistants exist, which abilities are available, the selected model, connection routing, delegation permissions, execution limits, and memory/state storage.

### 4. The Host (the running product)
The Host is VibeKit's internal runtime. It loads the Project, starts connections, routes messages, creates isolated worker sessions, tracks delegation, and persists Project State. You do not launch Pi separately.

### 5. Persistent Conversations vs. Worker Runs
- **Persistent Conversation**: Long-lived interaction context across multiple turns between a user and an agent.
- **Worker Run**: Temporary, bounded execution spawned to fulfill a specific Task. Receives scoped context, executes inside an isolated sandbox (e.g., Git worktree), produces a structured Result, and terminates.

### 6. Tasks & Structured Results
- **Tasks**: Explicit units of work with objectives, constraints, acceptance criteria, assigned agents, and dependencies. Work is tracked explicitly rather than lost in conversation history.
- **Results**: Machine-verifiable records emitted by Worker Runs detailing what happened, artifacts produced, evidence, and unresolved issues.

### 7. Four-Stage Verification & Apply Lifecycle
Consequential work transitions through four explicit stages:

$$\textbf{Completed} \longrightarrow \textbf{Verified} \longrightarrow \textbf{Accepted} \longrightarrow \textbf{Applied}$$

- **Completed**: The Agent finished execution and produced a structured Result.
- **Verified**: Independent automated checks and test commands ran against the candidate revision.
- **Accepted**: Work is approved by an operator or authorized review agent.
- **Applied**: Changes are merged into the main workspace.

### 8. Local Ownership & Three-Way Updates
Modules installed from the registry copy their files into the Project, where they become **locally owned and editable**. When updating an upstream module, VibeKit performs a three-way comparison:

$$\text{Original Base Version} \longleftrightarrow \text{Local Edited Version} \longleftrightarrow \text{New Upstream Version}$$

- If only upstream changed $\rightarrow$ cleanly update.
- If only local files changed $\rightarrow$ preserve user edits.
- If both changed $\rightarrow$ stop and require explicit reconciliation (no silent overwrites).

---

## 🤝 Multi-Agent Patterns

VibeKit models collaboration as ordinary composition and delegation—**no complex workflow DSL required**:

### Chief → Coder → Reviewer
```text
Human ──→ Chief ──→ Coder (Worktree Sandbox) ──→ Result ──→ Reviewer ──→ Verified Work
```

### Chief → Project Manager → Coder
```text
Human ──→ Chief ──→ Project Manager (Task Decomposition) ──→ Coder (Implementation)
```

### Researcher → Reviewer
```text
Human ──→ Research Task ──→ Researcher (Cited Analysis) ──→ Reviewer (Fact Checking)
```

---

## 💻 CLI Commands Tour

The product command is **`vibekit`**. The published product package will be **`@useagentsio/vibekit`**.

### Primary Runtime Commands
The primary front door is the running agent system:
```bash
vibekit create [dir]     # Advanced Project builder
vibekit msg <text>       # Send one turn through the Host to the assistant
vibekit start            # Start the Project Host in the background
vibekit stop             # Gracefully stop the Project Host
vibekit status           # Inspect Host and Interface daemon health
vibekit model            # Inspect or switch active model from Pi's live catalog
vibekit projects list    # List machine-local registered Projects
vibekit gateway install # Install the local dashboard login service
vibekit dashboard        # Open the Project Dashboard
```

### Composition & Lifecycle Commands
Manage and customize your project modules after creation:
```bash
vibekit init [dir]       # Initialize .vibekit configuration in an existing directory
vibekit add <type> <name># Install an Agent or Component from the official registry
vibekit list             # View installed modules, versions, and status matrix
vibekit diff <module>    # Three-way diff (base vs local vs upstream)
vibekit update <module>  # Safely update module without overwriting local customizations
vibekit remove <module>  # Cleanly remove module protecting shared dependencies
vibekit doctor           # Diagnostic checks for schemas, dependencies, and file integrity
vibekit migrate          # Upgrade schemaVersion 1 projects to schemaVersion 2
```

For complete flag options and examples, see the **[CLI Reference](docs/cli/commands.md)**.

---

## 📦 Official Catalog

VibeKit includes a curated official registry of modular Agents and Components.

### Official Agents

| Agent ID | Role | Key Capabilities |
| :--- | :--- | :--- |
| **`agent:chief`** | Coordinator & Delegation | Coordinates user intent, decomposes epics, and delegates to specialized workers. |
| **`agent:coder`** | Bounded Implementation | Writes and refactors code inside isolated Git worktrees; emits artifacts & evidence. |
| **`agent:reviewer`** | Independent Review | Validates diffs and test results. Strictly isolated with no source write permissions. |
| **`agent:project-manager`** | Planning & Scope | Breaks requirements into discrete tasks with constraints and acceptance criteria. |
| **`agent:researcher`** | Cited Analysis | Researches documentation and codebases; emits cited decision records. |
| **`agent:personal`** | Personal planning | Life-admin plans and follow-ups. No source write. |

### Official Components

| Component ID | Family | Runtime Kind | Description |
| :--- | :--- | :--- | :--- |
| **`provider:openai`** | Provider | `config` | OpenAI models (`OPENAI_API_KEY`) |
| **`provider:openai-codex`** | Provider | `config` | OpenAI Codex models (OAuth login) |
| **`provider:opencode-zen`** | Provider | `config` | OpenCode Zen (`OPENCODE_ZEN_API_KEY`) |
| **`provider:opencode-go`** | Provider | `config` | OpenCode Go (`OPENCODE_API_KEY`) |
| **`provider:xai`** | Provider | `config` | xAI Grok models (`XAI_API_KEY`) |
| **`provider:openrouter`** | Provider | `config` | Multi-model routing (`OPENROUTER_API_KEY`) |
| **`provider:anthropic`** | Provider | `config` | Claude (`ANTHROPIC_API_KEY`) |
| **`provider:google`** | Provider | `config` | Gemini (`GEMINI_API_KEY`) |
| **`provider:*`** | Provider | `config` | 50+ optional vendors — see [Official Components](docs/catalog/components.md) |
| **`tool:filesystem`** | Tool | `pi-builtin` | Pi filesystem tools (`read`, `grep`, `find`, `ls`, `write`, `edit`) |
| **`tool:execution`** | Tool | `pi-builtin` | Shell execution (`bash`) |
| **`tool:github`** | Tool | `pi-extension` | Issues, PRs, checks (`GITHUB_TOKEN`). Opt-in; `1.0.0` stays config-only. |
| **`tool:memory`** | Tool | `pi-extension` | Curated memory + session search. Requires `state:memory`. |
| **`tool:web`** | Tool | `pi-extension` | `web_fetch` (no key); search only if a secret is configured. |
| **`tool:browser`** | Tool | `pi-extension` | Isolated navigate / snapshot / click. |
| **`tool:mcp`** | Tool | `pi-extension` | MCP client for configured stdio servers. |
| **`tool:process`** | Tool | `pi-extension` | Background process start / poll / kill. |
| **`tool:scheduler`** | Tool | `pi-extension` | Job CRUD for `interface:schedule`. |
| **`skill:software-development`**| Skill | `pi-skill` | Software development practices and guidelines |
| **`skill:research`** | Skill | `pi-skill` | Research and citation methodology |
| **`skill:memory-hygiene`** | Skill | `pi-skill` | What to remember vs skip; memory is not Project truth. |
| **`skill:browser-use`** | Skill | `pi-skill` | Snapshot-first browser procedure. |
| **`skill:scheduler`** | Skill | `pi-skill` | Self-contained scheduled Task objectives. |
| **`interface:terminal`** | Interface | `interface` | Interactive CLI / stdio interface |
| **`interface:http`** | Interface | `interface` | Loopback HTTP turns (`VIBEKIT_HTTP_TOKEN`) |
| **`interface:webhook`** | Interface | `interface` | Signed inbound events (`VIBEKIT_WEBHOOK_SECRET`) |
| **`interface:schedule`** | Interface | `interface` | Cron/interval → fresh Worker Runs |
| **`interface:slack`** | Interface | `interface` | Slack Socket Mode with pairing |
| **`interface:telegram`** | Interface | `interface` | Telegram bot with pairing |
| **`policy:least-privilege`** | Policy | `policy` | Path access and command whitelisting |
| **`policy:require-verification`**| Policy | `policy` | Mandates independent test verification |
| **`policy:interface-pairing`** | Policy | `policy` | Deny unknown channel senders until paired |
| **`policy:untrusted-inbound`** | Policy | `policy` | Channel/web/MCP data cannot raise permissions |
| **`policy:memory-write-approval`** | Policy | `policy` | Stage memory writes for approval |
| **`policy:schedule-no-recurse`** | Policy | `policy` | Scheduled Runs cannot edit the job table |
| **`verifier:command`** | Verifier | `verifier` | Runs automated test commands against candidate revisions |
| **`verifier:schema`** | Verifier | `package` | JSON Schema checks against Results or artifacts |
| **`state:repository`** | State | `state` | Filesystem JSON state storage backend |
| **`state:memory`** | State | `package` | Local SQLite+FTS5 curated memory (not Project truth) |

Optional Components bind with `vibekit add <family> <name>`. `create` / `init` do not install them unless you ask.

---

## 🧩 Product internals

The published product is one package, **`@useagentsio/vibekit`**, with the `vibekit` command. Core contracts, Host lifecycle, Pi integration, connections, abilities, memory, scheduling, verification, schemas, and the official registry are internal product areas, not separate packages that a Project installs.

The [Architecture Overview](docs/architecture/overview.md) explains those boundaries. The [Development Guide](docs/contributing/guide.md) explains the source checkout and the local tarball workflow. Independently distributed third-party Components may still use their own npm package when a Module declares that runtime explicitly.

---

## 📖 Documentation Index

Explore comprehensive documentation and guides in the **[`docs/`](docs/)** directory:

- **Product & Concepts**:
  - [Product Requirements Document (PRD)](docs/PRD.md)
  - [Core Concepts Guide](docs/getting-started/core-concepts.md)
  - [Quickstart Tutorial](docs/getting-started/quickstart.md)
  - [Installation & Setup](docs/getting-started/installation.md)
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
  - [Runtime API Overview](docs/api/overview.md)
  - [Host runtime reference](docs/api/host.md)
  - [Core runtime reference](docs/api/core.md)
  - [Pi runtime reference](docs/api/pi.md)
  - [Interface contract reference](docs/api/interface-sdk.md)
- **Multi-Agent Patterns**:
  - [Patterns Index](docs/patterns/README.md)
  - [Chief → Coder → Reviewer](docs/patterns/chief-coder-reviewer.md)
  - [Parallel Coding Worktrees](docs/patterns/parallel-coding-worktrees.md)
  - [Proposal → Verification → Approval → Apply](docs/patterns/proposal-verification-approval-apply.md)
- **Contributing & Specifications**:
  - [Contributing](CONTRIBUTING.md)
  - [Development Guide](docs/contributing/guide.md)
  - [Module Authoring (official registry)](docs/contributing/module-authoring.md)
  - [V1 Implementation Specification](docs/spec/V1-Implementation-Specification.md)
  - [V1 Runtime Correction](docs/spec/V1-Runtime-Correction.md)

---

## 🛡️ Security & Invariants

- **Secrets as References Only**: API keys and tokens are never stored in YAML/JSON files, state records, logs, or fixtures. Only variable names and sources (`{ name, source: "environment" }`) are stored.
- **Relative Path Sandboxing**: File operations are strictly scoped to relative paths. Path traversal (`..`), absolute paths (`/`), and null bytes are rejected.
- **Runtime-Enforced Boundaries**: Security policies are evaluated directly in code at the tool/adapter boundary—never delegated to LLM prompts:
  $$\text{Effective Permission} = \text{Capability} \cap \text{Policy} \cap \text{Agent Grant} \cap \text{Task Scope} \cap \text{Current Authorization}$$
- **Untrusted Input Defense**: User inputs, web scrapes, and external tool outputs are treated as untrusted data and cannot elevate agent permissions.

---

## 🛠️ Local development

The source checkout is for contributors, not the ordinary user path. Keep intermediate builds local, run the focused checks for the area you changed, and use the single-product tarball flow before claiming a release candidate. The [Development Guide](docs/contributing/guide.md) is the source of truth for linking, registry generation, packaging, and clean-home validation.

Do not publish or install an unpublished package name from npm. The public package name is reserved for the explicitly approved release boundary.

---

## 📄 License

The published product is `UNLICENSED`. All rights reserved.
