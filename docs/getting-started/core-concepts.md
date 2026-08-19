# Core Concepts

This document introduces the fundamental architecture and mental model behind **VibeKit Agents**.

---

## 1. The Core Taxonomy

VibeKit structures autonomous agent systems around four distinct primitives:

```text
┌─────────────────────────────────────────────────────────────┐
│                         PROJECT                             │
│  (Contracts, Policies, Verifiers, State, Boundaries)        │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                      AGENTS                          │  │
│   │   (Composed recipes: Chief, Coder, Reviewer, etc.)   │  │
│   │                                                      │  │
│   │   ┌──────────────────────────────────────────────┐   │  │
│   │   │                COMPONENTS                    │   │  │
│   │   │  (Providers, Tools, Skills, Interfaces)      │   │  │
│   │   └──────────────────────────────────────────────┘   │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │
               ┌───────────────────────────────┐
               │          AGENT HOST           │
               │   (Always-running engine)     │
               └───────────────────────────────┘
```

### Components (The Pieces)
Components are atomic registry Modules. Identity is `type:name` (for example `tool:web`, `interface:telegram`), not an npm package name. Implementations may be referenced through `runtime.package` / `runtime.export`. The official registry is the default curated catalog; independently authored Modules can use a local/custom registry path.
- **Providers**: Connection configs for model vendors (e.g., `provider:openai`, `provider:openai-codex`, `provider:xai`).
- **Tools**: Executable toolsets (e.g., `tool:filesystem`, `tool:execution`; optional `tool:web`, `tool:github`, …).
- **Skills**: Structured instructions for Pi (e.g., `skill:software-development`, `skill:research`).
- **Interfaces**: I/O adapters (V1 ships `interface:terminal`; HTTP, webhook, schedule, Slack, and Telegram are optional).
- **Policies**: Invariant governance rules (e.g., `policy:least-privilege`, `policy:require-verification`).
- **Verifiers**: Deterministic check runners (e.g., `verifier:command`, optional `verifier:schema`).
- **State Backends**: Storage drivers (`state:repository`; optional `state:memory` is curated notes, not Project truth).

The full official list is in [Official Agents](../catalog/agents.md) and [Official Components](../catalog/components.md). To add a module, see [Module authoring](../contributing/module-authoring.md).

### Agents (The Compositions)
Agents are useful recipes composed of Components. An agent definition (`agent.yaml` + `instructions.md`) declares:
- Capabilities (tools, skills, and delegation targets it may use).
- Permissions and path scope restrictions.
- Persona, system instructions, and completion expectations.

### Projects (The System Boundary)
A Project is defined by `.vibekit/project.yaml`. It unites agents, components, delegation rules, permission matrices, and verification requirements into a cohesive system working against shared Project State.

### The Agent Host (The Product)
The **Host** (`@useagentsio/host` / `vibekit-host`) is the runtime process that executes the Project. It loads project contracts, coordinates Interface adapters, schedules Tasks, and manages Pi execution sessions.

---

## 2. Pi as an Embedded Engine

VibeKit embeds [Pi](https://github.com/earendil-works/pi) as its internal model and tool execution engine.

- **Embedded, Not External**: The Host spins up Pi sessions programmatically. Users do **not** launch the Pi TUI.
- **Worker Isolation**: When an agent performs a mutation task or delegated work, Pi runs in a dedicated, isolated environment (such as an isolated Git worktree).
- **Transient vs. Persistent**: Pi worker sessions are ephemeral—they start, execute a task, produce Results/Events, and terminate. Project State persists in VibeKit.

---

## 3. Human Interaction via Interfaces

Users communicate with a Project through **Interfaces**:
- **`interface:terminal`** is the Interface that ships on the first path (`vibekit msg` / `vibekit start`). Optional Interfaces (HTTP, webhook, schedule, Slack, Telegram) attach the same Host without changing Agents.
- Interfaces are strictly **I/O adapters**. They translate inbound text into Host Tasks or conversation turns, and render outbound Progress, Results, and Approval requests.
- Interfaces **never** own project state, permissions, or agent definitions.

---

## 4. State & Auditability

All project activity produces durable, machine-verifiable **YAML** records under `.vibekit/state/`:
- **Tasks**: Units of work requested by humans or delegated by agents.
- **Results**: Structured outcomes emitted by completed runs (status, summary, evidence, artifacts).
- **Decisions**: Architectural and operational records accepted by agents or operators.
- **Approvals**: Recorded human authorizations for gated operations.
- **Verifications**: Independent test runs verifying candidate revisions.
- **Conversations**: Chat turn logs linking human messages to agent actions.

---

## 5. Defense-in-Depth Permissions

Security is not left to LLM system prompts. VibeKit enforces strict capability boundaries at the runtime engine level:

$$\text{Effective Permission} = \text{Capability} \cap \text{Policy} \cap \text{Agent Grant} \cap \text{Task Scope} \cap \text{Current Authorization}$$

If an agent attempts to invoke a tool, write to an ungranted path, or execute a command outside its granted boundary, the Host intercepts and denies the operation before execution.

---

## 6. What VibeKit Is NOT

To maintain clarity and safety, VibeKit explicitly avoids several anti-patterns:
- **No Orchestrator / Subagent Types**: Delegation is simply an Agent capability, not a separate runtime taxonomy.
- **No Unsafe Marketplaces**: Official and local/custom registries are supported via standard schemas and deterministic manifests; there is no uncurated marketplace or hosted discovery service.
- **No In-Prompt Security**: Permissions are checked in TypeScript code at the tool execution boundary.
- **No Secret Persistence**: API keys are environment references only.
