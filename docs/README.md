# VibeKit Documentation

Welcome to the official documentation for **VibeKit Agents**.

VibeKit is an always-running **Agent Host** built on top of [Pi](https://github.com/earendil-works/pi). In VibeKit, **Components** are the pieces, **Agents** are useful compositions of those pieces, **Projects** are systems of Agents working against shared State, and the **Agent Host** executes them continuously.

Registry Modules are the composition and distribution abstraction. npm packages are optional implementation artifacts referenced by Module runtime metadata. The official registry is the default curated source, not the definition of a valid Module. Independently authored Modules can use a local/custom registry path; this is not a marketplace.

---

## 📚 Documentation Map

```text
docs/
├── getting-started/       # Quickstart, installation, and fundamental concepts
├── architecture/          # Host runtime, session models, state, and permissions
├── cli/                   # Complete CLI manual and 3-way lifecycle guide
├── configuration/         # project.yaml, workspace layout, and installed manifest
├── catalog/               # Official agents and component reference
├── api/                   # TypeScript SDK docs for @useagentsio/* packages
├── patterns/              # Verified multi-agent collaboration patterns
├── contributing/          # Dev workflow + registry authoring (see also /CONTRIBUTING.md)
├── phases/                # Historical V1 build briefs (not current catalog)
└── spec/                  # Normative specifications & runtime corrections
```

---

## 🚀 Getting Started

New to VibeKit? Start here:

- **[Quickstart Guide](getting-started/quickstart.md)**: Create and run your first Agent project in under 2 minutes.
- **[Installation & Requirements](getting-started/installation.md)**: Node.js requirements, package manager setup, and provider API keys.
- **[Core Concepts](getting-started/core-concepts.md)**: Understand the Taxonomy (Components, Agents, Projects, Host) and the boundary-enforced architecture.

---

## 🏗️ Architecture & Internals

Deep-dive into how VibeKit executes and safeguards agentic workflows:

- **[System Overview](architecture/overview.md)**: The Agent Host, Interface adapter layer, and embedded Pi engine.
- **[Persistent Sessions vs. Worker Runs](architecture/sessions-and-runs.md)**: Human-to-Agent interactive conversations vs. isolated, worktree-backed worker Runs.
- **[State & Persistence](architecture/state-and-persistence.md)**: Structured records (`tasks`, `results`, `decisions`, `approvals`, `verifications`, `events`, `conversations`).
- **[Security & Runtime Boundary](architecture/security-and-permissions.md)**: The permission intersection formula, secret reference models, and untrusted data handling.

---

## 💻 CLI & Operations

Master the `vibekit` CLI commands:

- **[CLI Overview & Flags](cli/overview.md)**: Global options, exit codes, non-interactive mode (`--yes`), and environment controls.
- **[Command Reference](cli/commands.md)**: `create` (including `--example headquarters`), `msg`, `start`, `approve-pairing`, composition commands, and `doctor`.
- **[Project Lifecycle & Diagnostics](cli/project-lifecycle.md)**: Three-way diffs, atomic updates without `--force`, conflict handling, and `vibekit doctor`.

---

## ⚙️ Configuration

Configure and manage your project workspace:

- **[project.yaml Reference](configuration/project-yaml.md)**: Complete schema reference for `.vibekit/project.yaml` (schemaVersion 2).
- **[Project Layout](configuration/project-layout.md)**: Breakdown of `.vibekit/` and `.pi/` directories, tracked files, and gitignored runtime files.
- **[Installed Manifest](configuration/installed-manifest.md)**: Checksums, version tracking, dependency graphs, and ownership in `installed.json`.

---

## 📦 Official Catalog

Explore the official modules shipped with VibeKit:

- **[Registry Overview](catalog/overview.md)**: Official registry principles, `module.yaml` anatomy, and runtime honesty.
- **[Official Agents](catalog/agents.md)**: Pre-configured agents: `agent:chief`, `agent:coder`, `agent:reviewer`, `agent:project-manager`, `agent:researcher`, `agent:personal`.
- **[Official Components](catalog/components.md)**: Providers, tools, skills, interfaces (terminal plus optional HTTP/webhook/schedule/Slack/Telegram), policies, verifiers, and optional `state:memory`.

---

## 🛠️ SDK & Developer Reference

Embed VibeKit packages into your TypeScript applications:

- **[Packages Overview](api/overview.md)**: Monorepo architecture and package dependencies.
- **[@useagentsio/host](api/host.md)**: Running the `VibeKitHost` in Node.js processes.
- **[@useagentsio/core](api/core.md)**: Schemas, repository state backend, validation, and diff engine.
- **[@useagentsio/pi](api/pi.md)**: Embedded Pi adapter, isolated runs, and worktree execution.
- **[@useagentsio/interface-sdk](api/interface-sdk.md)**: Contract for building custom Interface adapters.

---

## 🧩 Multi-Agent Patterns

Documented composition and collaboration patterns (patterns are conventions, not an executable workflow engine or orchestration type):

- **[Patterns Overview](patterns/README.md)**: Index of documented patterns.
- **[Chief → Coder → Reviewer](patterns/chief-coder-reviewer.md)**: Delegated implementation with independent code review.
- **[Chief → Project Manager → Coder](patterns/chief-project-manager-coder.md)**: Hierarchical planning and delegation.
- **[Parallel Coding Worktrees](patterns/parallel-coding-worktrees.md)**: Isolated concurrent coding runs on Git worktrees.
- **[Proposal → Verification → Approval → Apply](patterns/proposal-verification-approval-apply.md)**: Controlled mutation workflow.
- **[Researcher → Reviewer](patterns/researcher-reviewer.md)**: Cited research validation without write grants.

---

## 🤝 Contributing & Community

- **[Contributing](../CONTRIBUTING.md)**: Contribution contract, invariants, and pull request checklist.
- **[Development Guide](contributing/guide.md)**: Workspace setup, monorepo map, test gates, and code standards.
- **[Module Authoring](contributing/module-authoring.md)**: How to add or change official registry Agents and Components.

---

## 📜 Normative Specifications

- **[V1 Implementation Specification](spec/V1-Implementation-Specification.md)**: The original V1 normative design specification.
- **[V1 Runtime Correction](spec/V1-Runtime-Correction.md)**: The runtime correction establishing the Agent Host front door.

Phase briefs under [`phases/`](phases/README.md) are historical. Do not treat their catalog counts or “remaining work” tables as current.
