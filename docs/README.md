# VibeKit Documentation

Welcome to the official documentation for **VibeKit Agents**.

Start with the product, not the implementation: once published, install the VibeKit product, run bare `vibekit`, choose a model, and have a conversation with the default assistant. The [Quickstart](getting-started/quickstart.md) keeps that path short. VibeKit owns the Host, embedded Pi engine, built-in abilities, memory, and connections; a Project is the durable workspace where your choices and conversations live.

Registry Modules, Component families, and runtime identifiers are authoring concepts. They matter when you are extending the catalog or debugging a Project, not when you are trying VibeKit for the first time. The official registry is the default curated source, and independently authored Modules can use a local/custom registry path; this is not a marketplace.

---

## 📚 Documentation Map

```text
docs/
├── getting-started/       # Quickstart, installation, and fundamental concepts
├── architecture/          # Host runtime, session models, state, and permissions
├── cli/                   # Complete CLI manual and 3-way lifecycle guide
├── configuration/         # project.yaml, workspace layout, and installed manifest
├── catalog/               # Official agents and component reference
├── api/                   # Advanced internal runtime reference
├── patterns/              # Verified multi-agent collaboration patterns
├── contributing/          # Dev workflow + registry authoring (see also /CONTRIBUTING.md)
├── phases/                # Historical V1 build briefs (not current catalog)
└── spec/                  # Normative specifications & runtime corrections
```

---

## 🚀 Getting Started

New to VibeKit? Start here:

- **[Quickstart Guide](getting-started/quickstart.md)**: Install VibeKit, run bare `vibekit`, and have the first successful conversation.
- **[Installation & Requirements](getting-started/installation.md)**: Product installation, model authentication, connections, and troubleshooting.
- **[Core Concepts](getting-started/core-concepts.md)**: Understand assistants, Projects, abilities, memory, connections, and the Host boundary.

---

## 🏗️ Architecture & Internals

Deep-dive into how VibeKit executes and safeguards agentic workflows:

- **[System Overview](architecture/overview.md)**: The Agent Host, Interface adapter layer, and embedded Pi engine.
- **[Local Gateway Specification](spec/Local-Gateway-Specification.md)**: Normative Project registry, isolation, lifecycle API, dashboard, and login-service behavior.
- **[Persistent Sessions vs. Worker Runs](architecture/sessions-and-runs.md)**: Human-to-Agent interactive conversations vs. isolated, worktree-backed worker Runs.
- **[State & Persistence](architecture/state-and-persistence.md)**: Structured records (`tasks`, `results`, `decisions`, `approvals`, `verifications`, `events`, `conversations`).
- **[Security & Runtime Boundary](architecture/security-and-permissions.md)**: The permission intersection formula, secret reference models, and untrusted data handling.

---

## 💻 CLI & Operations

Master the `vibekit` CLI commands:

- **[CLI Overview & Flags](cli/overview.md)**: Global options, exit codes, non-interactive mode (`--yes`), and environment controls.
- **[Command Reference](cli/commands.md)**: Project runtime, registry, Gateway/dashboard, composition, pairing, and diagnostics commands.
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

## 🛠️ Runtime & Developer Reference

Inspect the internal runtime only when you are contributing or building a deliberately controlled integration. The supported user boundary remains the `vibekit` command:

- **[Runtime API Overview](api/overview.md)**: Internal runtime boundaries and the supported product entry point.
- **[Host runtime reference](api/host.md)**: Running the internal `VibeKitHost` in controlled processes.
- **[Core runtime reference](api/core.md)**: Schemas, repository State, validation, and update engine.
- **[Pi runtime reference](api/pi.md)**: Embedded Pi adapter, isolated Runs, and worktree execution.
- **[Interface contract reference](api/interface-sdk.md)**: Internal contract for building connection adapters.

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
