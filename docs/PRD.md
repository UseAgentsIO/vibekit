# VibeKit — Concise Product Requirements Document

## 1. What VibeKit Is

VibeKit is a runtime for building and running agent systems.

Its core model is:

**Components → Agents → Project → Host**

* **Components** are reusable pieces.
* **Agents** are compositions of Components.
* **Projects** compose Agents into a working system.
* **The Host** runs the Project.
* **Pi** is the embedded model/tool execution engine underneath the Host.

The user interacts with VibeKit, not directly with Pi.

Registry Modules are VibeKit's composition and distribution abstraction. Canonical identity is the registry ID (`tool:browser`), not an implementation package name. The consolidated product resolves first-party runtime identifiers internally; independently distributed Modules may use npm `runtime.package` / `runtime.export` artifacts.

The official registry is the default curated registry. Independently authored Modules can conform to the same runtime, compatibility, ownership, permission, and security rules via a local/custom registry path. This is not a marketplace.

---

## 2. Components

Components are atomic modules.

The main Component families are:

* Providers
* Tools
* Skills
* Interfaces
* Policies
* Verifiers
* State backends

Examples:

* `provider:openai`
* `tool:filesystem`
* `tool:execution`
* `skill:software-development`
* `interface:terminal`
* `verifier:command`
* `state:repository`

Components should remain small and reusable.

They are the primitive building blocks from which Agents are assembled.

---

## 3. Agents

An Agent is a useful composition of Components.

An Agent defines:

* instructions
* required capabilities
* inputs
* outputs
* permissions
* delegation targets
* execution behavior
* verification expectations

Examples include:

* Chief
* Coder
* Reviewer
* Researcher
* Project Manager

Agents are ordinary peers in the system.

There is no separate orchestrator or subagent type.

A Chief is simply an Agent with permission to delegate. A Coder is an Agent configured for implementation. A Reviewer is an Agent configured for review.

---

## 4. Projects

The Project is the main composition boundary.

A Project defines:

* which Agents exist
* which Components are installed
* which provider/model is used
* which Agent receives incoming messages
* which Agents may delegate to which other Agents
* execution limits
* verification requirements
* Interfaces
* Project State

The Project is represented primarily by `.vibekit/project.yaml`.

The important idea is that the Project defines how all the pieces work together.

---

## 5. Host

The Host is the running product.

It:

* loads the Project
* starts Interfaces
* receives messages
* determines which Agent should handle them
* creates Pi sessions
* runs Agent work
* handles delegation
* persists Project State
* returns results to Interfaces

Pi is embedded inside this runtime.

Users should not need to launch Pi separately.

Conceptually:

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

---

## 6. Interfaces

Interfaces connect people or external systems to the Host.

An Interface is only an I/O adapter.

For example, the terminal Interface:

* accepts user input
* converts it into Host messages
* displays progress and results

Interfaces should not contain Agent logic or own Project State.

The same Project should eventually be usable through different Interfaces without changing the Agent system itself.

---

## 7. Conversation vs Work

VibeKit has two important runtime concepts.

### Persistent Conversation

Used for ongoing human interaction.

A conversation can span many turns and keeps conversational context.

### Worker Run

Used to perform a bounded Task.

A Worker Run:

* has a specific objective
* runs as a specific Agent
* receives bounded context
* produces a Result
* terminates when finished

This distinction is important.

A conversation is long-lived interaction.

A Worker Run is temporary execution.

---

## 8. Tasks

A Task is a unit of work.

A Task contains things such as:

* objective
* constraints
* acceptance criteria
* assigned Agent
* scope
* dependencies
* delivery mode

Tasks make work explicit instead of hiding it inside conversations.

Delegation works by creating or passing Tasks to another Agent.

---

## 9. Delegation

Delegation is simply an Agent capability.

Example:

```text
Chief
 ├─→ Coder
 ├─→ Reviewer
 └─→ Researcher
```

Or:

```text
Chief
  ↓
Project Manager
  ↓
Coder
```

The important rule is that these are all still Agents.

VibeKit does not need a separate workflow engine or orchestration object to represent this.

Delegation creates another bounded Agent Run and returns its Result to the caller.

---

## 10. State

VibeKit treats State as explicit Project data.

Important State records include:

* Tasks
* Results
* Decisions
* Approvals
* Verifications
* Events
* Conversations

State lives under `.vibekit/state/`.

This means the system's history exists independently of any particular model session.

Pi sessions can disappear.

Project State remains.

---

## 11. Results

Every Worker Run should produce a structured Result.

A Result describes:

* what happened
* what artifacts were produced
* evidence
* unresolved issues
* which Task it belongs to
* which Run produced it

This gives Agents a predictable contract for communicating work back to the Project.

---

## 12. Verification and Apply

VibeKit separates four concepts:

```text
completed
   ↓
verified
   ↓
accepted
   ↓
applied
```

They are not the same thing.

* **Completed** means the Agent produced a Result.
* **Verified** means checks were performed against the candidate.
* **Accepted** means the Result is approved as valid Project work.
* **Applied** means the change was actually incorporated.

This gives the runtime a clean lifecycle for consequential work.

---

## 13. Agent Patterns

Patterns are compositions of the existing primitives.

Examples:

### Chief → Coder → Reviewer

```text
Human
  ↓
Chief
  ↓
Coder
  ↓
Result
  ↓
Reviewer
```

### Chief → Project Manager → Coder

```text
Human
  ↓
Chief
  ↓
Project Manager
  ↓
Coder
```

### Researcher → Reviewer

```text
Research Task
  ↓
Researcher
  ↓
Research Result
  ↓
Reviewer
```

Patterns should remain documentation and composition conventions rather than introducing a separate workflow language.

---

## 14. Registry

VibeKit has a registry containing reusable Agents and Components.

A module contains:

* identity
* version
* dependencies
* runtime metadata
* files
* configuration

Installing a module copies its files into the Project.

Those files then become editable Project files.

The registry should therefore act more like a source of reusable building blocks than a remote runtime dependency.

---

## 15. Local Ownership and Updates

Once installed, Agent and Component files belong to the Project.

Users can customize them.

Updating a module should compare:

```text
Original installed version
        ↓
Local edited version
        ↓
New upstream version
```

If only upstream changed, update it.

If only the user changed it, preserve the user version.

If both changed, stop and require reconciliation.

The key idea is that registry modules are starting points, not immutable framework-owned configuration.

---

## 16. Product Experience

The primary user journey should be simple:

```text
Create Project
    ↓
Choose Agent
    ↓
Choose Provider + Model
    ↓
Attach Interface
    ↓
Run Host
    ↓
Talk to Agent
```

For example:

```text
create
  ↓
msg / start
```

The composition commands exist to modify the system afterward:

```text
add
list
diff
update
remove
doctor
```

But the product itself is the running Agent Project, not the configuration CLI.

---

## 17. Core Concepts

1. **Components are atomic modules.**
2. **Agents are compositions of Components.**
3. **Projects compose Agents into systems.**
4. **The Host runs Projects.**
5. **Pi is embedded under the Host.**
6. **Interfaces only handle I/O.**
7. **Conversation sessions and Worker Runs are separate.**
8. **Tasks represent bounded work.**
9. **Delegation is an Agent capability.**
10. **There is no orchestrator/subagent taxonomy.**
11. **Project State is explicit and durable.**
12. **Worker Runs produce structured Results.**
13. **Completion, Verification, Acceptance, and Apply are separate stages.**
14. **Patterns are normal compositions rather than a workflow DSL.**
15. **Registry modules become editable Project-owned files.**
16. **Updates preserve local customization.**

---

## 18. The Entire Product in One Sentence

> **VibeKit runs Projects composed of Agents built from Components, using embedded Pi sessions to perform Tasks and persist structured Results and State.**
