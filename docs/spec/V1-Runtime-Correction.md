# VibeKit Agents: V1 Runtime Correction

## Document status

**Status:** Normative for the running product in this drop
**Supersedes:** The V1 front door in `V1-Implementation-Specification.md` that treated `init` / `add` / `doctor` as the product, deferred Slack as the remaining V1 story, and expected users to run Pi themselves
**Does not supersede:** The Component / Agent / Project taxonomy, official-registry model, ownership rules, permission intersection, State records, or the ban on `orchestrator` / `subagent` / Blocks

Normative terms match the V1 specification: **MUST**, **MUST NOT**, **SHOULD**, **MAY**.

---

# 1. Product truth

VibeKit is an always-running **Agent Host**.

The first user path in this implementation is:

```bash
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes
cd my-agent
vibekit msg "Hello"
```

`create` writes a runnable Agent Project. `msg` sends one turn through the Host to the configured provider. `start` runs the Host and the terminal Interface in the foreground.

Pi is an **internal engine**. Users MUST NOT be instructed to launch the Pi TUI. Composition commands (`init`, `add`, `list`, `diff`, `update`, `remove`, `doctor`) remain, but they are not the product.

Slack and Telegram are Interface families. They are **not implemented in this drop**.

---

# 2. What this corrects

The locked V1 spec described a thin composition layer whose user path ended at a valid Project, with Slack as Phase 9 and Pi as something the user already ran.

That front door is wrong for this implementation:

| Old claim | Correction |
| --- | --- |
| `init` / `add` / `doctor` is the product | The Host is the product. `create` + `msg` / `start` is the first path. |
| Users run Pi themselves | The Host embeds Pi. Users do not launch the Pi TUI. |
| Live Pi is optional | Live Pi is how the Host talks to a provider. Mocked sessions remain valid as unit tests only. |
| Slack later is the V1 story | Slack and Telegram are planned Interfaces, not this drop. Terminal is the Interface that ships. |
| `tool:github` is an executable Tool | `tool:github` is config-only and unavailable as a Tool in this drop. |
| Four implementation units (CLI, core, Pi, registry) | Add Host, Interface SDK, and terminal Interface packages. |

The Component / Agent / Project model is unchanged.

---

# 3. Architecture

```text
                         Human
                           │
           ┌───────────────┼────────────────┐
           ▼                                ▼
    vibekit CLI                      terminal Interface
    create / msg / start             @useagentsio/interface-terminal
           │                                │
           └───────────────┬────────────────┘
                           ▼
                     Agent Host
                   vibekit-host
                   always running
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
      Project            State          embedded Pi
      contracts          Tasks          model / tools
      Agents             Results        worker Runs
      permissions        Decisions      session factory
      Modules            conversations
                           │
                           ▼
                    Interface ports
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
        terminal         Slack*          Telegram*
        (this drop)      (future)        (future)
```

\* Slack and Telegram are listed so the Interface port is obvious. They MUST NOT be treated as shipped.

There is one Host per Project process. Interfaces attach to the Host. The Host loads the Project, resolves authority, owns conversations, and starts Pi worker Runs. Pi does not own Project State.

Package names:

| Package | Binary | Role |
| --- | --- | --- |
| `@useagentsio/cli` | `vibekit` | Create/manage Projects; `msg` to a running or on-demand Host |
| `@useagentsio/host` | `vibekit-host` | Always-running Agent Host |
| `@useagentsio/core` | — | Schemas, IDs, graph, install, ownership, State |
| `@useagentsio/pi` | — | Embedded Pi adapter |
| `@useagentsio/interface-sdk` | — | Interface contract |
| `@useagentsio/interface-terminal` | — | Terminal Interface |

CLI binary remains `vibekit`. Host binary is `vibekit-host`.

---

# 4. Host responsibilities

The Host MUST:

1. Load one Project from `.vibekit/project.yaml` and `installed.json`.
2. Stay running for the life of the process (`start`) or for the duration of a single turn (`msg`).
3. Bind configured Interfaces. In this drop that is `interface:terminal`.
4. Accept inbound messages and turn them into Tasks or conversation turns.
5. Resolve the Agent binding, effective permissions, provider, and tools.
6. Start, resume, or attach a **persistent** conversation session when the Interface is continuing a thread.
7. Start a **worker** Pi session when a Task needs an isolated Run (delegation, proposal, apply, verification).
8. Enforce **Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ current authorization** at the tool/adapter boundary, not in the prompt.
9. Persist Project State (Tasks, Results, Decisions, Approvals, Verifications, Events, conversations). Persist secret **references** only.
10. Emit progress and Results back through the originating Interface.
11. Propagate cancellation from the Interface to parent and child Runs.
12. Shut down Interfaces and worker sessions on process exit.

The Host MUST NOT:

* expose the Pi TUI or require the user to start Pi
* store secret values in YAML, JSON, Events, logs, or fixtures
* treat Slack or Telegram as present
* invent an `orchestrator`, `subagent`, or Blocks type
* let an Interface own Project State, permissions, or Agent definitions
* claim a completed Run is verified, accepted, or applied

`@useagentsio/core` remains Interface-independent. `@useagentsio/pi` remains the adapter that prepares an isolated Run. The Host is the process that calls them.

---

# 5. Interface SDK contract

Interfaces are Components. They translate I/O. They do not own Project State.

`@useagentsio/interface-sdk` is the Host-facing contract. An Interface module declares how the Host loads it:

```yaml
runtime:
  kind: interface
  package: "@useagentsio/interface-terminal"
  export: createTerminalInterface
  lifecycle: singleton
```

The Host MUST load a `kind: interface` Module by importing `package` and calling `export`. `lifecycle: singleton` means one instance per Host process.

## 5.1 An Interface MAY

* accept human input
* accept external events (future Slack / Telegram)
* create Tasks
* continue a conversation
* request cancellation
* display progress
* display Results
* collect Approval decisions

## 5.2 An Interface MUST NOT own

* Agent definitions
* Project State
* permissions
* Tasks as records
* approvals as records
* schedules
* verification rules

## 5.3 Host ↔ Interface messages

The SDK contract is inbound events from the Interface and outbound events from the Host.

Inbound (Interface → Host):

* `message` — user or external text, plus conversation key
* `cancel` — stop the current turn or Task
* `approval` — approve or reject a pending Approval
* `disconnect` — Interface is going away

Outbound (Host → Interface):

* `progress` — Run progress safe to show
* `result` — Result summary for the turn or Task
* `ask-approval` — structured Approval request
* `error` — structured failure; MUST NOT be rewritten as success
* `idle` — Host is waiting for the next inbound event

The terminal Interface (`createTerminalInterface`) implements this contract for stdio. `vibekit msg` is one inbound `message` and then exit after the matching `result` or `error`. `vibekit start` leaves the Interface attached until disconnect.

Future Slack and Telegram Interfaces MUST use the same SDK. They MUST NOT create a second State store.

---

# 6. Persistent vs worker sessions

Two session kinds exist. They MUST NOT be collapsed into one Pi TUI session.

## 6.1 Persistent conversation session

A persistent session belongs to an Interface conversation.

It is keyed by Interface binding + account + external conversation (and thread when present). The Host stores a conversation record under Project State (`conversation_*`, see `conversation.schema.json`).

Rules:

* One active persistent session per conversation key.
* `msg` and `start` reuse the same conversation when the key matches.
* The session may span many turns. It is not a Task claim.
* Closing or idling the conversation MUST NOT delete Project State.
* Slack / Telegram, when implemented, bind `external.conversationId` / `external.threadId` to the same record type.

Persistent sessions are how a human talks to an Agent. They are not how a child Agent runs a bounded Task.

## 6.2 Worker session

A worker session is an isolated Pi Run for a Task.

The Host (or a parent Agent via `agent_delegate`) starts a worker through `@useagentsio/pi`. The worker receives:

* Task objective, constraints, acceptance criteria
* granted tools and scoped paths
* bounded State
* required secret references
* a filtered environment

The worker does **not** receive the entire parent conversation by default.

Worker sessions:

* have a Run ID (`run_*`)
* may use process or worktree isolation
* take claims, concurrency slots, and idempotency keys
* emit Events and a Result
* end when the Run completes, fails, cancels, or times out

`runIsolated` / `runManaged` remain the adapter API. Injecting `createSession` in tests is allowed. That injection is a unit-test seam, not a product mode.

## 6.3 Mapping

```text
vibekit msg "Hello"
  → persistent conversation turn
  → Host may start a worker Run if the Agent must act

agent_delegate
  → worker session only
  → child Result returns to the parent worker

vibekit start
  → Host process + singleton terminal Interface
  → persistent conversation stays open
  → workers come and go per Task
```

---

# 7. CLI surface

Binary: `vibekit` (`@useagentsio/cli`).

## 7.1 First path

| Command | Role |
| --- | --- |
| `create` | Write a runnable Agent Project (Agent, provider, Interface, Host wiring). |
| `msg` | One turn through the Host to the configured provider. |
| `start` | Foreground Host + terminal Interface. |

`create` MUST produce a Project that `msg` can use without a separate `init` + `add` dance. `msg` MUST talk to the Host, not to a user-launched Pi process. `start` MUST run `vibekit-host` (or an equivalent in-process Host) plus the terminal Interface.

## 7.2 Composition path

| Command | Role |
| --- | --- |
| `init` | Create `.vibekit/` without installing an Agent. |
| `add` | Install a Module from the official registry. |
| `list` | Four statuses: installed, configured, available, verified. |
| `diff` | Three-way compare. Read-only. |
| `update` | Three-way update. Conflict stops the Module. No `--force`. |
| `remove` | Remove unchanged exclusive files. Keep shared deps. |
| `doctor` | Validate. Do not silently repair consequential issues. |

These commands keep their V1 contracts. They are management tools, not the product story.

## 7.3 Host binary

`vibekit-host` runs the Host for a Project directory. `vibekit start` SHOULD invoke it. `vibekit msg` MAY start a short-lived Host if none is running, send one turn, and exit.

---

# 8. Catalog honesty

Registry Modules that execute or attach at runtime MUST declare `runtime`. Honesty beats a complete-looking catalog.

## 8.1 Runtime kinds

| `kind` | Meaning |
| --- | --- |
| `interface` | Load `package` / `export` into the Host. |
| `pi-builtin` | Bind named Pi built-in tools. |
| `pi-extension` | Load a Pi extension. |
| `package` | Load a Host or adapter package. |
| `config-only` | Metadata / config / capability declaration only. |

`available: false` means the Host MUST NOT treat the Module as an executable Tool even if it is installed.

## 8.2 This drop

`interface:terminal`:

```yaml
runtime:
  kind: interface
  package: "@useagentsio/interface-terminal"
  export: createTerminalInterface
  lifecycle: singleton
```

`tool:filesystem`:

```yaml
runtime:
  kind: pi-builtin
  tools: [read, grep, find, ls, write, edit]
```

`tool:execution`:

```yaml
runtime:
  kind: pi-builtin
  tools: [bash]
```

`tool:github`:

```yaml
runtime:
  kind: config-only
  available: false
```

`tool:github` MAY declare capabilities and a `GITHUB_TOKEN` reference. It MUST NOT be advertised or loaded as an executable Tool.

Providers remain provider configuration. Skills remain Pi Skills. Policies and Verifiers remain contracts, not Interfaces.

---

# 9. Unchanged V1 rules

The correction does not reopen:

* Component families: provider, tool, skill, interface, state, policy, verifier
* Agents as editable recipes; Projects as the durable boundary
* Official registry only; no marketplace; no third-party registries
* Transactional install / update / remove; no silent overwrite
* Relative file targets; reject `..`, absolute paths, null bytes
* Secrets as `{ name, source: environment }` references only
* Permission intersection enforced at the runtime boundary
* Delegation as an Agent capability, not a new type
* Verification, acceptance, and apply as separate states
* Patterns as documentation, not a workflow engine

---

# 10. Out of this drop

**Out of this drop: Slack, Telegram.**

Also out of this drop:

* Slack or Telegram packages, bots, or OAuth
* a marketplace or third-party registries
* a graphical builder
* users launching the Pi TUI
* treating `init` / `add` / `doctor` as the finished product
* claiming `tool:github` executes
* claiming live Pi is optional (except as a unit-test mock)
* `orchestrator`, `subagent`, or Blocks
* a Pi fork or a second Agent loop
* database-backed or remote State
* automatic merge of conflicting user edits

When Slack or Telegram are implemented later, they MUST be Interfaces on this Host and this SDK. They MUST use normal Tasks, Runs, Events, Results, conversations, cancellation, and Approvals. They MUST NOT become a second source of truth.
