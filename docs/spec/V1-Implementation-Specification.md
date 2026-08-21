# VibeKit Agents: V1 Implementation Specification

> **Runtime correction.** The front door in this document (`init` / `add` / `doctor` as the product, Slack deferred as the remaining V1 story, users run Pi themselves, and single-registry-source restrictions) is superseded by [V1-Runtime-Correction.md](./V1-Runtime-Correction.md). The Component / Agent / Project model remains.

> **Distribution correction.** The current product boundary is one scoped package, `@useagentsio/vibekit`, with internal Core, Host, Pi, connection, ability, State, scheduling, verification, schema, and registry areas. Older references below to `@vibekit/*`, `@useagentsio/*` implementation packages, or separate package publication describe historical development units and are not user installation instructions. See [Architecture Overview](../architecture/overview.md), [Contributing](../contributing/guide.md), and [Module Authoring](../contributing/module-authoring.md) for the current boundary.

## Document status

**Architecture status:** Locked for V1 implementation
**Product name:** VibeKit Agents, working name
**Runtime:** Pi
**Primary language:** TypeScript
**Distribution model:** one product package containing the CLI, official registry, schemas, and internal runtime
**Supersedes:** Earlier Product Shape documents and the previous primitive-catalog model

The product name, public package names, and license may change before public release. Those decisions do not change this architecture.

Normative terms:

* **MUST** means required.
* **MUST NOT** means prohibited.
* **SHOULD** means the expected default.
* **MAY** means optional.

---

# 1. Product model

> **Components are the pieces. Agents are useful compositions of those pieces. Projects are systems of Agents working against shared state. Pi runs them.**

VibeKit adds modular composition, project state, installation, validation, and governance on top of Pi.

Pi remains responsible for model execution, tool calling, sessions, providers, Skills, and the Agent loop.

VibeKit does not fork Pi.

VibeKit does not replace Pi.

VibeKit does not create a second Agent runtime beside Pi.

---

# 2. Product goals

VibeKit must let a user:

1. Start with an existing Pi project.
2. Add a small Component such as a Tool, Skill, Policy, or Verifier.
3. Add a complete Agent such as a Coder or Researcher.
4. Read and edit everything added to the project.
5. Replace models, Tools, Skills, Interfaces, and Agents without rebuilding the whole system.
6. Run several Agents without allowing them to overwrite each other.
7. Preserve project state between Pi sessions.
8. verify work before it becomes accepted project state.
9. understand which module added each file.
10. update or remove a module without destroying local changes.
11. enforce permissions outside the prompt.
12. inspect how a result was produced and accepted.

The user owns the copied Agent and Component source.

There is no hidden hosted control plane.

---

# 3. Non-goals

V1 will not include:

* a Pi fork
* a replacement for Pi's Agent loop
* opaque hosted Agents
* a graphical workflow builder
* a marketplace
* third-party registries
* distributed Agent clusters
* database-backed state
* permanent multi-Project runtimes
* automatic merging of arbitrary user changes
* an executable workflow language
* a separate `orchestrator` type
* a separate `subagent` type
* a technical category called Blocks

Chief, Project Manager, Coder, Researcher, Designer, and Reviewer are all Agents.

Delegation is an Agent capability.

Reporting relationships are Project configuration.

---

# 4. Core product concepts

## 4.1 Standards

VibeKit Standards define how independently built modules work together.

Standards are not installable modules.

They define:

* stable IDs
* schemas
* file ownership
* configuration composition
* dependencies
* capabilities
* permissions
* authorization
* state records
* task and result records
* events
* verification
* concurrency
* secrets
* compatibility
* installation
* updates
* removal
* runtime behavior

Standards are the main interoperability layer.

## 4.2 Components

A Component is a small reusable piece with one main job.

V1 Component families are:

### Providers

Configure or extend a provider already used by Pi.

A Provider Component may provide:

* credential setup
* credential references
* model defaults
* Pi provider configuration
* a Pi-compatible custom provider adapter

A Provider Component MUST NOT rebuild a provider runtime already supplied by Pi without a clear technical reason.

### Tools

Executable capabilities available to an Agent.

Examples:

* GitHub access
* filesystem access
* browser access
* vision analysis
* shell execution

Tools normally map to Pi extensions or existing Pi tools.

### Skills

Reusable procedures that explain how an Agent performs a class of work.

Skills normally map directly to Pi Skills.

A Skill does not grant authority.

### Interfaces

Ways that a human or external system communicates with a Project.

Examples:

* terminal
* Slack
* HTTP
* webhook
* scheduled trigger

Interfaces translate input and output. They do not own Project state.

Scheduled and event-driven inputs are modeled through Interface capabilities rather than a new Automation Component family.

### State

Durable storage used between Agent runs.

V1 provides:

```text
state:repository
```

Memory is one possible State implementation. Memory is not automatically Project truth.

### Policies

Rules that limit or govern actions.

Examples:

* require review
* protect the main branch
* require approval before deletion
* limit writable paths
* deny network access
* require citations

Policies constrain authority. They are not procedural Skills.

### Verifiers

Mechanisms that decide whether an output satisfies a contract.

Examples:

* tests
* type checking
* linting
* schema validation
* repository checks
* code review
* research review

## 4.3 Agents

An Agent is an editable recipe that composes Components into a useful worker.

An Agent definition includes:

* identity
* role
* instructions
* model configuration
* required capabilities
* Components
* permissions
* state access
* delegation rules
* execution limits
* verification requirements
* completion rules
* escalation rules

Installing an Agent copies its definition into the user's project.

The user can then change its model, Tools, Skills, permissions, or instructions.

## 4.4 Projects

A Project is the durable composition boundary.

V1 assumes one VibeKit Project per repository or workspace root.

A Project contains:

* a Project contract
* local Agent definitions
* installed Components
* Agent bindings
* Project policies
* shared state
* Tasks
* Results
* Decisions
* Approvals
* Verification records
* Events
* references to accepted artifacts

Projects are not registry packages in V1.

A future Project template may create a Project, but the resulting Project is still user-owned local state.

## 4.5 Patterns

Patterns explain useful ways to connect Agents and Components.

Examples:

```text
Chief → Coder → Reviewer

Chief → Project Manager → Workers

parallel Coders → Integrator

Researcher → Reviewer

scheduled trigger → Researcher

proposal → review → apply
```

Patterns are documentation-only in V1.

Patterns MUST use normal Agent, Task, State, and Verification contracts.

VibeKit MUST NOT build a second workflow engine only to support Patterns.

## 4.6 Modules

**Module** is the common term for an installable Component or Agent.

Projects and Patterns are not Modules in V1.

---

# 5. System architecture

```text
Human or external system
          │
          ▼
      Interface
          │
          ▼
┌───────────────────────────────┐
│            Project            │
│                               │
│ Project contract              │
│ Agent definitions             │
│ Policies                      │
│ Tasks and Results             │
│ Decisions and Approvals       │
│ State and Events              │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│        VibeKit layer          │
│                               │
│ Schema validation             │
│ Module resolution             │
│ Permission resolution         │
│ State contracts               │
│ Task claims                   │
│ Verification gates            │
│ Pi runtime adapter            │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│              Pi               │
│                               │
│ Models and providers          │
│ Agent sessions                │
│ Tool calling                  │
│ Skills                        │
│ Extensions                    │
│ Model execution loop          │
└───────────────────────────────┘
```

## 5.1 VibeKit owns

VibeKit owns:

* Standards
* schemas
* module contracts
* Agent recipes
* Project contracts
* dependency resolution
* capability binding
* permission declarations
* authorization checks
* Task and Result protocols
* Project State conventions
* installation metadata
* safe update behavior
* verification gates
* registry metadata
* composition validation
* the Pi adapter

## 5.2 Pi owns

Pi owns:

* model execution
* provider runtime
* model discovery
* Agent sessions
* tool execution
* native Skills
* native extensions
* the model and tool calling loop
* other Pi runtime behavior

## 5.3 Boundary rule

VibeKit MUST compose a native Pi mechanism before creating a parallel mechanism.

Examples:

```text
VibeKit Skill
→ Pi Skill

VibeKit Tool
→ Pi extension or native Pi tool

VibeKit Provider
→ Pi provider configuration or extension

VibeKit Agent
→ VibeKit Agent contract
→ Pi process or session

VibeKit Interface
→ transport adapter
→ VibeKit Project
→ Pi
```

---

# 6. V1 implementation units

The VibeKit source repository will contain four main implementation units.

## 6.1 `vibekit`

The CLI package.

Responsibilities:

* initialize a Project
* read the registry
* resolve dependencies
* show requested permissions
* install files
* track ownership
* compare local changes
* update Modules safely
* remove Modules safely
* run composition validation

## 6.2 `@vibekit/core`

A small TypeScript library.

Responsibilities:

* schemas and validation
* IDs and version rules
* module graph resolution
* capability resolution
* configuration composition
* permission evaluation
* State interfaces
* Task and Result types
* lifecycle rules
* conflict detection
* shared error types

The core MUST remain independent of any Interface.

## 6.3 `@vibekit/pi`

The Pi runtime adapter.

Responsibilities:

* load the VibeKit Project
* load Agent definitions
* resolve effective Agent configuration
* create isolated Pi runs
* expose authorized delegation
* pass bounded task context
* strip unneeded environment variables
* enforce delegation rules
* emit Run Events
* propagate cancellation
* collect Results
* invoke required Verifiers
* update Project State

## 6.4 Official registry

The official registry contains:

* Components
* Agents
* immutable versioned payloads
* metadata
* checksums
* compatibility declarations
* documentation

Patterns live in documentation beside the registry.

---

# 7. VibeKit source repository layout

```text
/
├── packages/
│   ├── cli/
│   ├── core/
│   └── pi/
│
├── schemas/
│   ├── module.schema.json
│   ├── component.schema.json
│   ├── agent.schema.json
│   ├── project.schema.json
│   ├── task.schema.json
│   ├── result.schema.json
│   ├── decision.schema.json
│   ├── approval.schema.json
│   ├── verification.schema.json
│   └── event.schema.json
│
├── registry/
│   ├── components/
│   │   ├── provider/
│   │   ├── tool/
│   │   ├── skill/
│   │   ├── interface/
│   │   ├── state/
│   │   ├── policy/
│   │   └── verifier/
│   └── agents/
│
├── docs/
│   ├── standards/
│   ├── patterns/
│   ├── registry/
│   └── guides/
│
├── examples/
│   └── starter-project/
│
└── tests/
    ├── schemas/
    ├── registry/
    ├── cli/
    ├── composition/
    ├── permissions/
    ├── state/
    ├── runtime/
    └── end-to-end/
```

---

# 8. User Project layout

VibeKit-owned files live under `.vibekit/`.

Pi-native files remain in their normal Pi locations.

```text
/
├── .pi/
│   ├── extensions/
│   ├── skills/
│   ├── prompts/
│   └── settings.json
│
├── .vibekit/
│   ├── project.yaml
│   ├── installed.json
│   │
│   ├── agents/
│   │   ├── chief/
│   │   │   ├── agent.yaml
│   │   │   └── instructions.md
│   │   ├── coder/
│   │   │   ├── agent.yaml
│   │   │   └── instructions.md
│   │   └── reviewer/
│   │       ├── agent.yaml
│   │       └── instructions.md
│   │
│   ├── components/
│   │   ├── policies/
│   │   ├── verifiers/
│   │   └── state/
│   │
│   ├── config/
│   │   ├── providers/
│   │   ├── tools/
│   │   ├── interfaces/
│   │   └── agents/
│   │
│   ├── state/
│   │   ├── tasks/
│   │   ├── results/
│   │   ├── decisions/
│   │   ├── approvals/
│   │   ├── verifications/
│   │   └── events/
│   │
│   └── runtime/
│       ├── runs/
│       ├── claims/
│       ├── locks/
│       └── generated/
│
└── package.json
```

## 8.1 Tracked files

The following SHOULD be committed:

* `.vibekit/project.yaml`
* `.vibekit/installed.json`
* Agent definitions
* Agent instructions
* Project Policies
* Project Verifiers
* non-secret configuration
* accepted Decision records

## 8.2 Runtime files

`.vibekit/runtime/` MUST be ignored by Git.

It contains:

* active claims
* lock files
* temporary Run data
* generated configuration
* local process metadata

## 8.3 State tracking

The State Component controls whether each record class is:

* `git`
* `local`
* `ephemeral`

Safe V1 defaults:

```yaml
tracking:
  decisions: git
  tasks: local
  results: local
  approvals: local
  verifications: local
  events: local
  runtime: ephemeral
```

A Project may choose to commit more State when the repository is private and the data is appropriate for source control.

Secrets MUST never be committed through any tracking mode.

---

# 9. IDs and versioning

## 9.1 Module IDs

Every Module has a stable typed ID.

Format:

```text
<type>:<name>
```

Examples:

```text
provider:openai
tool:github
skill:research
interface:slack
state:repository
policy:require-review
verifier:command
agent:coder
```

Rules:

* lowercase only
* letters, numbers, and hyphens
* no spaces
* no display names in references
* changing the display name does not change the ID

## 9.2 Project and runtime IDs

Recommended prefixes:

```text
project:<slug>
task_<uuid>
run_<uuid>
result_<uuid>
decision_<uuid>
approval_<uuid>
verification_<uuid>
event_<uuid>
claim_<uuid>
```

## 9.3 Schema versions

Every structured VibeKit document MUST contain:

```yaml
schemaVersion: 1
```

Schema versions are integers.

Schema versions are separate from Module versions.

## 9.4 Module versions

Components and Agents use Semantic Versioning.

Examples:

```text
1.0.0
1.1.0
2.0.0
```

Registry versions are immutable.

A published version MUST never be changed in place.

## 9.5 Compatibility

Each Module declares compatibility with:

* VibeKit core
* Pi
* Node.js when relevant

The Project locks exact installed Module versions in `.vibekit/installed.json`.

The package manager lockfile locks the exact Pi and VibeKit package versions.

A Module may declare a supported Pi range, but the Project resolves and locks an exact version.

The CLI MUST refuse a known incompatible combination.

---

# 10. Component contract

Every Component registry entry contains `module.yaml`.

Example:

```yaml
schemaVersion: 1

id: tool:github
type: tool
name: github
displayName: GitHub Tool
version: 1.0.0
description: Gives authorized Agents scoped GitHub repository access.

compatibility:
  vibekit: "^1.0.0"
  pi: "SUPPORTED_RANGE_DECLARED_BY_MODULE"
  node: ">=20"

source:
  repository: "SOURCE_REPOSITORY"
  revision: "IMMUTABLE_REVISION"

license: "LICENSE_IDENTIFIER"

providesCapabilities:
  - repository.read
  - repository.write
  - repository.issue.read
  - repository.issue.write

requires:
  required:
    - policy:least-privilege
  optional: []
  recommended:
    - policy:require-verification
  conflicts: []

requestsPermissions:
  - capability: repository.read
  - capability: repository.write
  - capability: repository.issue.read
  - capability: repository.issue.write

secrets:
  - name: GITHUB_TOKEN
    required: true
    source: environment

files:
  - source: payload/index.ts
    target: .pi/extensions/github/index.ts
    ownership: exclusive

configuration:
  target: .vibekit/config/tools/github.yaml
  schema: config.schema.json

healthCheck:
  type: pi-tool
  name: github
```

## 10.1 Required Component fields

A Component MUST declare:

* schema version
* ID
* type
* name
* version
* description
* compatibility
* source
* license
* capabilities provided
* dependencies
* requested permissions
* secrets required
* files installed
* configuration contract
* health check when runtime verification is possible

## 10.2 File targets

File targets MUST:

* be relative to the Project root
* reject `..`
* reject null bytes
* reject absolute paths
* reject symlink escapes
* declare ownership
* be shown before installation

## 10.3 Installation hooks

Registry Modules MUST NOT execute arbitrary installation scripts in V1.

A Module may declaratively request:

* files
* npm dependencies
* configuration files
* secret references
* health checks

The CLI controls all installation actions.

---

# 11. Agent contract

An Agent is a Module with `type: agent`.

Example:

```yaml
schemaVersion: 1

id: agent:coder
type: agent
name: coder
displayName: Coder
version: 1.0.0
description: Implements bounded software changes and returns evidence.

instructions: ./instructions.md

model:
  provider: inherit
  id: inherit
  allowProjectOverride: true
  allowTaskOverride: false

components:
  required:
    - skill:software-development
    - state:repository
    - verifier:command
  optional:
    - tool:github
  recommended:
    - policy:require-verification

capabilities:
  requires:
    - source.read
    - source.write
    - command.execute

inputs:
  required:
    - objective
    - constraints
    - acceptanceCriteria

outputs:
  required:
    - summary
    - artifacts
    - evidence
    - unresolvedIssues

permissions:
  allow:
    - capability: source.read
      scope:
        paths:
          - "**"
    - capability: source.write
      scope:
        paths:
          - "src/**"
          - "tests/**"
    - capability: command.execute
      scope:
        commands:
          - project-verification
  deny:
    - capability: project.configure
    - capability: module.install
    - capability: deploy.apply

delegation:
  allowed: false
  targets: []
  maxDepth: 0
  maxParallelChildren: 0

state:
  read:
    - project
    - tasks
    - decisions
  write:
    - results
    - events

execution:
  isolation: worktree
  timeoutMs: 1200000
  cleanupRequired: true

verification:
  required:
    - verifier:command
  independentReview: false

completion:
  requires:
    - result-recorded
    - required-verification-finished

escalation:
  on:
    - permission-denied
    - conflicting-project-state
    - missing-acceptance-criteria
    - verification-failed
```

## 11.1 Agent definition and runtime identity

The copied Agent definition is durable.

A Run is temporary.

V1 does not create permanent Agent-instance objects.

The runtime identity is:

```text
Agent definition + Project binding + Task + Run ID
```

## 11.2 Delegation

Delegation is denied by default.

An Agent may delegate only when:

* its Agent contract allows delegation
* the Project allows the target relationship
* the target Agent exists
* the maximum depth is not exceeded
* the maximum child count is not exceeded
* the current Task permits delegation

V1 MUST reject delegation cycles.

A delegated Agent receives only the context needed for its assigned Task.

---

# 12. Project contract

The canonical Project contract is:

```text
.vibekit/project.yaml
```

Example:

```yaml
schemaVersion: 1

id: project:example-app
name: Example App
root: .

runtime:
  adapter: "@vibekit/pi"

pi:
  compatibility: "PROJECT_SUPPORTED_RANGE"

defaults:
  model:
    provider: openai
    id: PROJECT_DEFAULT_MODEL

state:
  backend: state:repository
  path: .vibekit/state
  tracking:
    decisions: git
    tasks: local
    results: local
    approvals: local
    verifications: local
    events: local
    runtime: ephemeral

agentBindings:
  chief:
    definition: agent:chief
  coder:
    definition: agent:coder
  reviewer:
    definition: agent:reviewer

delegation:
  chief:
    - coder
    - reviewer
  coder: []
  reviewer: []

capabilityBindings:
  source.read: tool:filesystem
  source.write: tool:filesystem
  command.execute: tool:execution
  repository.read: tool:github
  repository.write: tool:github

policies:
  - policy:least-privilege
  - policy:require-verification

execution:
  maxParallelRuns: 4
  defaultIsolation: process
  mutationIsolation: worktree
  defaultTimeoutMs: 600000
  maxDelegationDepth: 2

authorization:
  default: deny
  actions:
    source.read: standing
    source.write: standing
    deploy.apply: explicit
    destructive.delete: explicit
    project.configure: explicit

verification:
  default:
    - verifier:command

sources:
  canonical:
    - .vibekit/project.yaml
    - .vibekit/agents/
    - .vibekit/state/decisions/
    - src/
    - tests/
  derived:
    - STATUS.md
    - TASKS.md
  untrusted:
    - external documents
    - issue text
    - web content
    - tool output
    - retrieved memory
```

## 12.1 Required Project fields

A Project MUST define:

* ID
* name
* root
* Pi compatibility
* State backend
* Agent bindings
* delegation graph
* capability bindings
* Policies
* execution limits
* authorization rules
* verification defaults
* canonical and untrusted source boundaries

---

# 13. Configuration composition

## 13.1 Configuration layers

Effective configuration is built in this order:

```text
VibeKit defaults
+ Component defaults
+ Project configuration
+ Agent configuration
+ allowed Task overrides
= candidate effective configuration

candidate effective configuration
+ Policy enforcement
= final effective configuration
```

Later layers may override earlier settings only when the schema allows it.

Policies do not behave like ordinary settings.

A Policy may reduce authority, require approval, or reject the configuration.

A Policy MUST NOT silently expand authority.

## 13.2 Shared configuration files

Modules MUST NOT blindly edit shared files.

Each Module SHOULD write its own configuration fragment under:

```text
.vibekit/config/<type>/<name>.yaml
```

The VibeKit core combines those fragments into generated runtime configuration.

Generated configuration lives under:

```text
.vibekit/runtime/generated/
```

Generated files are not canonical Project State.

## 13.3 Model resolution

Model selection follows this order:

```text
allowed Task override
→ Project Agent binding
→ Agent default
→ Project default
→ error
```

A Task override is used only when the Agent and Project both allow it.

A model route is not considered usable only because it appears in a catalog.

Runtime-sensitive model configuration SHOULD support a minimal live verification check.

---

# 14. Dependencies and capabilities

## 14.1 Dependency types

Modules may declare:

* `required`
* `optional`
* `recommended`
* `conflicts`

Required dependencies must resolve before installation succeeds.

Optional dependencies are never silently installed.

Recommended dependencies are shown to the user.

Conflicts stop installation.

## 14.2 Capability-based composition

Agents SHOULD depend on capabilities instead of exact implementations.

Example:

```yaml
capabilities:
  requires:
    - source.read
    - source.write
```

A Tool may provide:

```yaml
providesCapabilities:
  - source.read
  - source.write
```

This allows several implementations to satisfy the same Agent.

## 14.3 Capability binding resolution

The resolver uses this order:

1. explicit Agent binding
2. explicit Project binding
3. one compatible installed provider
4. guided user selection
5. failure

The resolver MUST NOT select randomly when several Components provide the same capability.

## 14.4 Dependency graph

The CLI MUST:

1. build the full required dependency graph
2. reject dependency cycles
3. detect conflicts
4. resolve capabilities
5. calculate file targets
6. calculate package changes
7. show the installation plan
8. apply the plan as one transaction

---

# 15. Permissions and authorization

Capability, permission, and authorization are separate.

## 15.1 Capability

A capability answers:

> What can this Component technically do?

Example:

```text
repository.write
```

## 15.2 Permission

A permission answers:

> What may this Agent do?

Example:

```text
Coder may use repository.write on feature branches.
```

## 15.3 Authorization

Authorization answers:

> Has this specific action been approved under the Project's rules?

Example:

```text
Deploy revision abc123 to production.
```

## 15.4 Effective permission rule

Effective permission is the intersection of:

```text
Component capability
∩ Project Policy
∩ Agent grant
∩ Task scope
∩ current authorization
```

A missing grant means denied.

A deny rule wins over an allow rule.

A narrower scope wins over a broader scope.

An Agent cannot grant itself more authority.

## 15.5 Runtime enforcement

Permissions MUST be enforced at the action boundary.

Examples:

* filesystem paths enforced by the filesystem Tool
* repository scope enforced by the repository Tool
* command access enforced by the execution Tool
* delegation enforced by the Pi adapter
* approval enforced before the mutation
* secrets filtered before child process creation

Prompt instructions are not sufficient security controls.

## 15.6 Authorization modes

Supported authorization modes:

* `deny`
* `standing`
* `explicit`

`standing` means the Project or current owner request already authorizes the bounded action.

`explicit` requires a durable Approval record for the exact action or scope.

Missing authorization for a consequential action fails closed.

---

# 16. CLI specification

V1 command surface:

```bash
npx vibekit@latest init

npx vibekit@latest add <type> <name>

npx vibekit@latest list

npx vibekit@latest diff <type:name>

npx vibekit@latest update <type:name>

npx vibekit@latest remove <type:name>

npx vibekit@latest doctor
```

Examples:

```bash
npx vibekit@latest add provider openai
npx vibekit@latest add tool github
npx vibekit@latest add skill research
npx vibekit@latest add interface slack
npx vibekit@latest add agent researcher
npx vibekit@latest add agent coder
npx vibekit@latest add agent chief
```

## 16.1 `init`

`init` MUST:

1. verify that the target is a usable Pi project
2. detect the package manager
3. create `.vibekit/`
4. create `.vibekit/project.yaml`
5. create `.vibekit/installed.json`
6. install the VibeKit core and Pi adapter
7. install the thin Pi extension entry point
8. add safe `.gitignore` rules
9. run `doctor`
10. report the exact created and changed files

`init` does not install an Agent unless the user chooses one.

## 16.2 `add`

`add` MUST:

1. resolve the Module
2. resolve required dependencies
3. check compatibility
4. check file ownership
5. check conflicts
6. show requested permissions
7. prompt for configuration
8. record secret references, not secret values
9. stage all changes
10. validate the staged Project
11. apply atomically
12. update `installed.json`
13. run `doctor`

## 16.3 `list`

`list` shows:

* installed Module ID
* installed version
* source
* status
* local modification state
* configured state
* availability state
* verification state

The statuses are separate:

```text
installed
configured
available
verified
```

## 16.4 `diff`

`diff` compares:

* the immutable installed registry version
* the user's current files
* the newest compatible registry version when available

It MUST show local changes without modifying anything.

## 16.5 `update`

Update uses three-way comparison:

```text
base = installed registry version
local = current user-owned file
upstream = requested registry version
```

Rules:

* local equals base: replace with upstream
* upstream equals base: keep local
* local equals upstream: mark current
* local and upstream both changed: report conflict and stop

V1 MUST NOT silently overwrite a conflicting user change.

The update is transactional.

A conflict stops the entire Module update unless the user has explicitly selected a supported conflict-resolution path.

## 16.6 `remove`

Default removal rules:

* unchanged exclusively owned files may be removed
* shared dependencies still used by another Module remain
* modified files stop removal
* the CLI explains which files were modified
* no destructive `--force` behavior in V1

A later `--keep-modified` option may remove ownership metadata while leaving modified files in place.

## 16.7 `doctor`

`doctor` validates:

* Project schema
* Module schemas
* schema versions
* Pi compatibility
* VibeKit compatibility
* missing dependencies
* dependency cycles
* conflicts
* duplicate Module IDs
* capability bindings
* duplicate Tool registrations
* file ownership
* missing configuration
* secret references
* Agent references
* permission references
* delegation cycles
* Verifier references
* State readability
* runtime directory safety
* installed manifest integrity

`doctor` reports problems.

It does not silently repair consequential issues.

---

# 17. File ownership and installation state

## 17.1 Installed manifest

`.vibekit/installed.json` records:

* schema version
* Module ID
* Module version
* registry source
* source revision
* integrity checksum
* install time
* dependencies
* installed files
* original file hashes
* ownership mode
* configuration paths
* compatibility data

## 17.2 Ownership modes

V1 supports:

### Exclusive

One Module owns the complete file.

A second Module cannot claim the same path.

### Generated

The file is built by VibeKit from separate configuration fragments.

Modules own their fragments, not the generated file.

V1 should avoid shared direct ownership.

## 17.3 Existing files

When an installation target already exists:

* matching content may be adopted after confirmation
* different content is a conflict
* the CLI MUST NOT overwrite it silently

## 17.4 Atomic installation

Installation MUST use a staging directory.

Flow:

```text
calculate plan
→ stage files
→ validate schemas
→ validate ownership
→ validate Project
→ apply file changes
→ update installed manifest
→ clean staging directory
```

If a step fails, the Project must remain in its previous valid state.

---

# 18. Registry specification

## 18.1 V1 registry type

V1 uses an official registry.

It is not a marketplace.

Third-party registries are deferred.

## 18.2 Registry layout

```text
registry/
├── components/
│   ├── tool/
│   │   └── github/
│   │       └── 1.0.0/
│   │           ├── module.yaml
│   │           ├── config.schema.json
│   │           └── payload/
│   └── ...
│
└── agents/
    └── coder/
        └── 1.0.0/
            ├── module.yaml
            └── payload/
                ├── agent.yaml
                └── instructions.md
```

## 18.3 Required registry metadata

Each entry includes:

* Module ID
* name
* version
* description
* publisher
* source repository
* source revision
* license
* checksum
* VibeKit compatibility
* Pi compatibility
* dependencies
* capabilities
* requested permissions
* secrets
* file targets
* documentation

## 18.4 Registry safety

Registry CI MUST:

* validate every schema
* reject absolute file targets
* reject path traversal
* reject duplicate IDs
* reject mutable version payloads
* reject missing licenses
* reject undeclared dependencies
* scan payloads for likely secrets
* calculate integrity checksums
* test installation into a clean fixture Project
* run registry Module tests
* generate the registry index

Executable code is still executable code.

A registry badge does not replace runtime least privilege.

---

# 19. Agent runtime

## 19.1 Runtime adapter

The Pi adapter loads:

```text
Project contract
+ Agent definition
+ resolved Components
+ Task
+ effective permissions
+ bounded State context
```

It then starts a Pi process or session for that Run.

## 19.2 Instruction layers

The effective instruction stack is:

```text
VibeKit runtime invariants
+ Project contract
+ Agent instructions
+ current Task
```

External files, web content, issue text, tool output, and retrieved memory are treated as untrusted data.

They are not added as higher-priority instructions.

## 19.3 Bounded context

A child Agent receives:

* Task objective
* required context
* constraints
* acceptance criteria
* relevant decisions
* allowed State
* available Tools
* required output contract

A child Agent does not receive the entire parent conversation by default.

## 19.4 Delegation tool

The Pi adapter may expose:

```text
agent_delegate
```

It accepts:

* target Agent binding
* objective
* context
* constraints
* expected output
* optional existing Task ID
* optional progress milestones

The Tool is registered only for Agents with `agent.delegate`.

The runtime validates the target before execution.

## 19.5 Environment isolation

Child Runs receive a clean environment.

The runtime passes only:

* required runtime variables
* authorized secret references
* required integration configuration
* Task-specific values

It MUST strip unrelated credentials.

A child Agent does not automatically inherit every credential available to its parent.

## 19.6 Run limits

Every Run supports:

* timeout
* cancellation
* maximum delegation depth
* maximum child count
* maximum parallel children
* Project concurrency limit
* cleanup requirement

Unbounded delegation is prohibited.

---

# 20. Run lifecycle

Standard Run states:

```text
created
ready
running
waiting
completed
failed
cancelled
timed_out
```

Standard execution sequence:

```text
manual request or trigger
→ create or select Task
→ check idempotency
→ check authorization
→ claim Task
→ resolve Agent
→ resolve Components
→ resolve capabilities
→ resolve permissions
→ create isolated Run
→ load bounded Project context
→ execute through Pi
→ emit progress Events
→ collect Result
→ run required Verifiers
→ request Approval if required
→ accept or reject the proposed state transition
→ apply accepted mutation when authorized
→ release claim
→ clean temporary resources
→ record final Events
→ exit
```

## 20.1 Cancellation

Cancellation MUST:

1. mark the Run as cancelling
2. signal the active Pi process
3. propagate to child Runs
4. stop temporary subprocesses
5. clean temporary worktrees and files
6. release claims and locks
7. preserve safe partial Results
8. record `run.cancelled`

Cancellation is part of the runtime contract.

It is not specific to Slack or another Interface.

## 20.2 Cleanup

Cleanup runs after:

* completion
* failure
* cancellation
* timeout

Temporary resources include:

* worktrees
* subprocesses
* lock files
* leases
* temporary files
* browser sessions
* generated credentials
* staged installation files

A cleanup failure is recorded separately.

The runtime MUST NOT claim full completion when required cleanup failed.

---

# 21. Task contract

Task records live under:

```text
.vibekit/state/tasks/
```

Required fields:

```yaml
schemaVersion: 1
id: task_UUID
projectId: project:example-app

objective: Bounded required outcome

context:
  references: []

constraints: []

acceptanceCriteria: []

requiredCapabilities: []

assignedAgent: null
claimedBy: null

scope:
  paths: []
  resources: []

dependencies: []

priority: normal

delivery:
  mode: proposal

authorization:
  state: standing

status: open
revision: 1

createdAt: TIMESTAMP
updatedAt: TIMESTAMP
```

## 21.1 Task states

```text
open
claimed
running
blocked
review
accepted
failed
cancelled
```

## 21.2 Delivery modes

Supported delivery modes:

### Proposal

Produce a verified candidate but do not apply the consequential mutation.

### Apply

Apply the verified result when current authorization permits it.

The runtime MUST NOT add a redundant approval gate when the exact action is already authorized.

The runtime MUST request Approval when Project Policy requires it.

---

# 22. Result contract

Results live under:

```text
.vibekit/state/results/
```

Required fields:

```yaml
schemaVersion: 1
id: result_UUID
taskId: task_UUID
runId: run_UUID
agentId: agent:coder

status: completed

summary: Description of the produced outcome

artifacts:
  - path: src/example.ts
    revision: HASH_OR_COMMIT

evidence: []

verificationIds: []

unresolvedIssues: []

discoveredConstraints: []

recommendedNextActions: []

createdAt: TIMESTAMP
```

An Agent returning a Result means execution finished.

It does not mean:

* verification passed
* the result was accepted
* the mutation was applied

---

# 23. Decision contract

Decision records live under:

```text
.vibekit/state/decisions/
```

Required fields:

* ID
* question
* decision
* status
* reason
* evidence
* authority
* producing Agent or human
* timestamp
* superseded Decision when applicable

Decision states:

```text
proposed
accepted
rejected
disputed
superseded
```

Events record that a Decision changed.

The Decision record stores what was decided and why.

---

# 24. Approval contract

Approval records live under:

```text
.vibekit/state/approvals/
```

Required fields:

* ID
* exact requested action
* exact target
* exact scope
* related Task
* related Result
* status
* requested authority
* requested time
* decision time
* expiration when relevant

Approval states:

```text
pending
approved
rejected
expired
```

Approval is valid only for the reviewed action and scope.

Approval MUST NOT become unlimited future permission.

---

# 25. Verification contract

Verification records live under:

```text
.vibekit/state/verifications/
```

Required fields:

* ID
* Task ID
* Result ID
* Verifier ID
* exact candidate revision
* command or review contract
* start time
* finish time
* status
* evidence
* exit code when applicable
* observed failures

Verification states:

```text
pending
passed
failed
skipped
```

`skipped` requires a recorded reason and Policy permission.

---

# 26. Event contract

Events are append-only records.

Recommended path:

```text
.vibekit/state/events/YYYY-MM-DD.jsonl
```

Required fields:

```json
{
  "schemaVersion": 1,
  "id": "event_UUID",
  "type": "run.started",
  "projectId": "project:example-app",
  "taskId": "task_UUID",
  "runId": "run_UUID",
  "actor": "agent:coder",
  "timestamp": "TIMESTAMP",
  "data": {}
}
```

Initial Event types:

```text
task.created
task.claimed
task.started
task.blocked
task.completed
task.failed
task.cancelled

run.created
run.started
run.progress
run.waiting
run.completed
run.failed
run.cancelled
run.timed_out

result.created

verification.started
verification.passed
verification.failed
verification.skipped

approval.requested
approval.approved
approval.rejected
approval.expired

decision.recorded
decision.superseded

artifact.created
artifact.changed

policy.changed
permission.changed
module.installed
module.updated
module.removed
```

Events describe state transitions.

Events do not contain private chain-of-thought.

---

# 27. Canonical Project State

V1 canonical Project State is:

```text
Project contract
+ local Agent definitions
+ installed Module manifest
+ Task records
+ Result records
+ Decision records
+ Approval records
+ Verification records
+ accepted artifact references
+ Project Events
```

The following are not canonical Project State:

* chat history
* current model context
* an Agent's unsupported summary
* retrieved memory
* web content
* stale generated views
* Interface-local state

## 27.1 Evidence and trust

Records may use these evidence states:

```text
observed
proposed
accepted
rejected
disputed
superseded
inferred
unresolved
```

Where relevant, records SHOULD include:

* source
* evidence
* producing Run
* producing Agent
* confidence
* verification status
* timestamp

A polished Agent response does not replace weaker underlying evidence.

## 27.2 Derived views

Possible derived views:

```text
STATUS.md
TASKS.md
DECISIONS.md
APPROVALS.md
Project dashboard
Portfolio summary
```

Derived views are generated from canonical State.

They MUST remain traceable to their sources.

They MUST NOT override canonical records.

Full view generation is not required for the first implementation milestone.

---

# 28. Concurrency and isolation

## 28.1 Task claims

Mutating Tasks require a claim.

A claim contains:

* claim ID
* Task ID
* Run ID
* Agent ID
* mutation scope
* claim time
* lease expiration

Exclusive Tasks may have only one active claim.

Expired claims may be recovered.

## 28.2 Optimistic concurrency

Important writes include an expected revision or hash.

Flow:

```text
read revision A
→ create proposed change
→ confirm current revision is still A
→ write atomically
```

A revision mismatch stops the write.

The caller must reload and reconcile.

## 28.3 State locks

Repository State MUST use:

* exclusive lock creation
* bounded leases
* atomic temporary-file writes
* atomic rename
* cleanup of stale locks
* revision checks

## 28.4 Coding isolation

A coding Task that may modify source SHOULD use an isolated Git worktree.

Recommended flow:

```text
Task
→ dedicated worktree
→ Agent change
→ Result
→ Verification
→ Approval when required
→ accepted integration
```

Several Agents MUST NOT write into the same working tree concurrently.

## 28.5 Project concurrency

The Project defines:

* maximum parallel Runs
* maximum child Runs
* exclusive mutation scopes
* default isolation
* mutation isolation
* claim lease duration
* conflict behavior

## 28.6 Idempotency

Interface events and automated triggers require stable idempotency keys.

The same external event MUST NOT start the same consequential Task twice.

Deduplication occurs before Run creation.

---

# 29. Verification and acceptance

These states are separate:

## 29.1 Execution completed

The Agent stopped and returned a Result.

## 29.2 Verification passed

The required Verifiers accepted the exact candidate revision.

## 29.3 Accepted

The Result is allowed to change canonical Project State.

## 29.4 Applied

The accepted mutation was actually performed.

A Result may be completed but fail Verification.

A Result may pass Verification but wait for Approval.

A Result may be accepted as a proposal without being applied.

## 29.5 Deterministic verification

Use deterministic verification when code can answer the question.

Examples:

* tests
* type checking
* linting
* schema validation
* file checks
* allowed-path checks
* Git ancestry
* checksums
* exact output comparison

## 29.6 Agent-based verification

Use an independent Agent when judgment is required.

Examples:

* code review
* architecture review
* research review
* design review
* security review

The producing Agent MUST NOT satisfy an independent-review requirement by reviewing its own work.

## 29.7 Exact revision

Verification records the exact source revision, commit, hash, or artifact set it checked.

An accepted result MUST match the verified revision.

If the candidate changes after verification, verification is no longer valid.

---

# 30. Safe self-modification

Changes to reusable operating behavior use:

```text
propose
→ inspect exact diff
→ approve when required
→ verify base revision
→ apply atomically
→ record Event
```

This applies to:

* Agent definitions
* Agent instructions
* Skills
* Policies
* Verifiers
* Project contracts
* reusable configuration
* other canonical VibeKit behavior

A proposal records:

* source
* evidence
* producing Agent
* base version or hash
* payload hash
* affected files
* proposed content

Before application, the runtime verifies:

* the approved proposal has not changed
* the target has not changed since proposal creation

The proposing Agent cannot approve its own consequential change unless an explicit Policy permits that narrow case.

---

# 31. Secrets and environment policy

## 31.1 Secret references

Definitions contain secret references only.

Allowed:

```yaml
secrets:
  - name: OPENAI_API_KEY
    source: environment
```

Prohibited:

```yaml
OPENAI_API_KEY: actual-secret-value
```

## 31.2 Prohibited secret locations

Secret values MUST NOT appear in:

* registry payloads
* Agent definitions
* Project contracts
* Tasks
* Results
* Decisions
* Approvals
* Events
* generated documentation
* logs
* error messages
* copied examples

## 31.3 Least privilege

Each Run receives only the secrets required by its Agent, Components, and Task.

Delegated Agents do not inherit all parent secrets.

## 31.4 Logs

Logs SHOULD include:

* Project ID
* Task ID
* Run ID
* Agent ID
* Module ID
* Event type
* duration
* structured failure category

Logs MUST NOT include:

* credentials
* private chain-of-thought
* full sensitive documents
* unfiltered personal data
* authorization tokens

---

# 32. Failure model

Common failure categories:

```text
invalid_input
permission_denied
authorization_required
policy_blocked
dependency_missing
configuration_invalid
compatibility_error
conflict
resource_busy
unavailable
timed_out
cancelled
verification_failed
external_error
internal_error
cleanup_failed
```

Components may add specific subcategories.

Interfaces may simplify the visible message, but structured failure details remain available for debugging.

A failure MUST NOT be converted into a success claim.

---

# 33. Interfaces and automated triggers

## 33.1 Interface boundary

An Interface may:

* accept human input
* accept external events
* create Tasks
* request cancellation
* display progress
* display Results
* collect Approval decisions

An Interface does not own:

* Agent definitions
* Project State
* permissions
* Tasks
* approvals
* schedules
* verification rules

## 33.2 Trigger contract

A scheduled or event-driven trigger includes:

* trigger ID
* source
* target Project
* target Agent binding
* Task template
* input
* delivery target
* timezone when required
* enabled state
* last execution
* next execution
* idempotency key
* claim state

A trigger creates a normal Task and Run.

It does not create a separate execution system.

## 33.3 V1 front door

The V1 non-technical front door is:

```text
catalog page
→ plain explanation
→ copyable add command
→ guided CLI prompts
```

A graphical builder is deferred.

---

# 34. Initial official catalog

The first official registry must be large enough to prove composition without becoming a full platform.

## 34.1 Required V1 Components

```text
state:repository

policy:least-privilege
policy:require-verification

verifier:command

provider:<one-supported-provider>

tool:filesystem
tool:execution
tool:github

skill:software-development
skill:research
```

The exact provider used for the first supported path depends on the Pi environment selected during implementation.

## 34.2 Required V1 Agents

```text
agent:coder
agent:reviewer
agent:researcher
agent:project-manager
agent:chief
```

## 34.3 First Interface

The terminal or normal Pi interaction surface is the first Interface.

`interface:slack` follows after the core runtime and State contracts are stable.

## 34.4 Required V1 Pattern documentation

```text
Chief → Coder → Reviewer

Chief → Project Manager → Coder

Researcher → Reviewer

proposal → verification → approval → apply

parallel coding worktrees → independent integration
```

---

# 35. Implementation order

## Phase 1: Schemas and contracts

Build:

* IDs
* schema definitions
* schema validation
* lifecycle enums
* error types
* fixture documents
* compatibility parsing

Exit criteria:

* every example in this specification validates
* invalid IDs fail
* unsupported schema versions fail
* invalid lifecycle transitions fail
* schemas have focused tests

## Phase 2: Registry and CLI foundation

Build:

* registry index
* Module loader
* dependency graph
* conflict detection
* capability resolution
* file target validation
* `init`
* `add`
* `list`
* installed manifest

Exit criteria:

* a clean Pi fixture can be initialized
* one Component can be installed
* one Agent can install required dependencies
* ownership is recorded
* failed installation rolls back

## Phase 3: Safe ownership and updates

Build:

* file hashing
* `diff`
* three-way update planning
* `update`
* `remove`
* generated configuration fragments
* compatibility checks

Exit criteria:

* local edits are detected
* unchanged files update safely
* conflicting files stop the update
* modified files are not removed
* shared dependencies remain installed

## Phase 4: Project State

Build:

* repository State adapter
* Task store
* Result store
* Decision store
* Approval store
* Verification store
* Event log
* atomic writes
* lock and lease handling
* revision checks

Exit criteria:

* State survives process restart
* conflicting writes are rejected
* stale claims can be recovered
* Events are append-only
* no partial State writes remain after failure

## Phase 5: Pi runtime adapter

Build:

* Project loader
* Agent loader
* effective configuration resolver
* model resolution
* bounded context assembly
* isolated Pi Run
* result collection
* Run Events
* cancellation
* environment filtering

Exit criteria:

* an Agent can execute one Task
* the Agent receives only authorized context
* missing configuration fails closed
* cancellation stops the Run
* temporary resources are cleaned

## Phase 6: Delegation and concurrency

Build:

* `agent_delegate`
* delegation graph validation
* maximum depth
* maximum child count
* Task claims
* process isolation
* worktree isolation
* Project concurrency pool
* idempotency protection

Exit criteria:

* unauthorized delegation fails
* cycles fail
* parallel coding Runs use separate worktrees
* the same exclusive Task cannot run twice
* duplicate external events do not duplicate work

## Phase 7: Verification and application

Build:

* command Verifier
* independent Agent Verifier support
* exact-revision tracking
* proposal delivery
* apply delivery
* Approval gates
* accepted and applied state transitions

Exit criteria:

* Agent completion is not treated as Verification
* a failing Verifier blocks acceptance
* a changed revision invalidates old Verification
* explicit Approval is enforced
* already authorized bounded work is not needlessly re-approved

## Phase 8: Official Agent catalog

Build:

* Coder
* Reviewer
* Researcher
* Project Manager
* Chief
* required Skills
* required Policies
* Pattern guides

Exit criteria:

* each Agent installs through the same registry contract
* each Agent can be edited locally
* each Agent passes `doctor`
* the complete Chief to worker to review flow works end to end

## Phase 9: Slack Interface

Build after the Project and runtime contracts are stable.

The Slack Interface must use normal Tasks, Runs, Events, Results, cancellation, and Approvals.

It must not create a second source of truth.

---

# 36. V1 acceptance tests

V1 is implementation-complete when all of the following pass.

## Installation

1. `init` creates a valid VibeKit Project in a clean Pi project.
2. `add agent coder` installs the Agent and required dependencies.
3. the CLI shows all requested permissions before applying changes.
4. installation failure leaves the Project unchanged.
5. duplicate file ownership is rejected.
6. path traversal and absolute targets are rejected.

## Ownership and updates

7. local Agent edits are detected by `diff`.
8. an unchanged Module updates automatically.
9. a locally changed and upstream changed file produces a conflict.
10. `remove` does not delete a modified file.
11. a dependency still used by another Module is not removed.

## Composition

12. missing required dependencies fail.
13. dependency cycles fail.
14. conflicting Modules fail.
15. a capability with one provider resolves automatically.
16. a capability with several providers requires an explicit binding.

## Runtime

17. an Agent loads its Project, Agent, and Task contracts.
18. an Agent receives only granted Tools and State.
19. child Runs receive a filtered environment.
20. unauthorized delegation fails.
21. delegation cycles fail.
22. cancellation stops parent and child Runs.
23. timeout records `run.timed_out`.
24. cleanup occurs after success, failure, cancellation, and timeout.

## State and concurrency

25. Task claims prevent duplicate exclusive execution.
26. expired claims can be recovered.
27. revision conflicts stop stale writes.
28. State writes are atomic.
29. duplicate Interface events are ignored through idempotency keys.
30. separate coding Runs use separate worktrees.

## Verification and governance

31. an Agent Result alone cannot become accepted State.
32. required deterministic Verification blocks on failure.
33. independent review cannot be performed by the producing Agent.
34. Verification is tied to the exact candidate revision.
35. explicit Approval is required where Policy says it is.
36. Approval applies only to the exact reviewed action.
37. proposal mode does not apply the mutation.
38. apply mode applies only an accepted and authorized result.
39. self-modification checks both base hash and payload hash.

## Security

40. secret values do not appear in tracked VibeKit files.
41. secret values do not appear in Events or logs.
42. untrusted content cannot grant authority.
43. missing consequential-action Policy fails closed.
44. a Skill cannot grant permissions through instruction text.

## Validation

45. `doctor` detects every intentionally broken fixture.
46. all official registry Modules pass registry CI.
47. a fresh clone can reconstruct the same installed composition from tracked definitions and lockfiles.

---

# 37. Deferred work

The following are intentionally deferred:

* marketplace functionality
* third-party registries
* registry trust ratings
* graphical Project builder
* database State adapters
* remote State adapters
* distributed execution
* persistent Agent instances
* cross-machine claims
* automatic customized-file merging
* executable Pattern definitions
* complex workflow DSL
* cross-Project portfolio runtime, except the metadata-only local lifecycle Gateway defined by `Local-Gateway-Specification.md`
* hosted control plane
* remote telemetry
* Agent reputation systems

These may be added later through the same contracts.

---

# 38. Release decisions outside the implementation architecture

The supplied product shape does not settle:

* final product name
* final npm package names
* final domain names
* public license
* commercial licensing model
* hosted registry URL

Implementation should proceed using:

```text
VibeKit
vibekit
@useagentsio/vibekit
```

These names may be changed before public release.

The license must be chosen before publishing packages or registry payloads.

Every third-party dependency and copied module must preserve its required attribution.

---

# 39. Final architecture

```text
VibeKit
│
├── Standards
│   └── rules and contracts for safe composition
│
├── Components
│   ├── Providers
│   ├── Tools
│   ├── Skills
│   ├── Interfaces
│   ├── State
│   ├── Policies
│   └── Verifiers
│
├── Agents
│   ├── Chief
│   ├── Project Manager
│   ├── Coder
│   ├── Researcher
│   ├── Designer
│   ├── Reviewer
│   └── user-created Agents
│
├── Projects
│   ├── Project contract
│   ├── Agent bindings
│   ├── shared State
│   ├── Tasks
│   ├── Results
│   ├── Decisions
│   ├── Approvals
│   ├── Verifications
│   └── Events
│
└── Patterns
    └── documented ways to compose the system

                    ↓

                   Pi
       model and Agent execution runtime
```

# 40. Final product rule

Components are reusable pieces.

Agents are editable compositions of Components.

Projects are durable systems where Agents work against shared State.

Patterns explain useful ways to connect them.

Standards make independently built Modules compatible.

VibeKit handles composition, governance, installation, and Project continuity.

Pi runs the Agents.

The Project carries the work forward between Runs.
