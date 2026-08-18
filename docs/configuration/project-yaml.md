# `project.yaml` Configuration Reference

The `.vibekit/project.yaml` file is the canonical specification of your VibeKit Agent Project.

---

## Schema Overview

VibeKit projects use **`schemaVersion: 2`** (Host-aware project format). Below is an annotated complete example:

```yaml
schemaVersion: 2
id: project:my-agent
name: my-agent
root: .

runtime:
  adapter: "@useagentsio/pi"
  host: "@useagentsio/host"

defaultAgent: chief

defaults:
  model:
    provider: openai
    id: gpt-5

host:
  retainedConversations: 50
  maxParallelConversations: 10
  sameConversationPolicy: serialize
  shutdownGraceMs: 5000

interfaceBindings:
  terminal:
    definition: interface:terminal
    enabled: true
    defaultAgent: chief

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
  filesystem: tool:filesystem
  execution: tool:execution

policies:
  - policy:least-privilege
  - policy:require-verification

execution:
  maxParallelRuns: 4
  defaultIsolation: process
  mutationIsolation: worktree
  defaultTimeoutMs: 300000
  maxDelegationDepth: 2

authorization:
  default: autonomous
  actions:
    file.write: review
    command.execute: review

verification:
  default:
    - verifier:command

sources:
  canonical:
    - "README.md"
    - "docs/**"
  derived:
    - "dist/**"
  untrusted:
    - "issues/**"

pi:
  compatibility: ">=0.1.0"

state:
  backend: state:repository
  path: .vibekit/state
  tracking:
    conversations: track
    decisions: track
    tasks: track
    results: track
    approvals: track
    verifications: track
    events: ephemeral
    runtime: ignore
```

---

## Field Reference

### Root Settings
- `schemaVersion` *(integer, required)*: Must be `2` for Host runtime compatibility.
- `id` *(string, required)*: Machine ID in format `project:<name>`.
- `name` *(string, required)*: Human-readable project display name.
- `root` *(string, required)*: Relative path to project root (usually `.`).
- `defaultAgent` *(string, optional)*: Agent binding used when no explicit agent is targeted in conversations.

### Host Runtime (`host`)
- `retainedConversations` *(integer, required)*: Maximum number of conversation records kept in state before pruning.
- `maxParallelConversations` *(integer, required)*: Maximum concurrent active conversation streams.
- `sameConversationPolicy` *(string, required)*: Concurrency policy for turns on identical conversation keys (must be `serialize`).
- `shutdownGraceMs` *(integer, required)*: Time in milliseconds to wait for worker runs to clean up during process termination.

### Interface Bindings (`interfaceBindings`)
Defines configured interface adapters:
- `definition` *(string, required)*: Module ID (e.g., `interface:terminal`).
- `enabled` *(boolean, required)*: Whether the interface is loaded on Host startup.
- `defaultAgent` *(string, required)*: Bound agent to direct incoming messages to.
- `config` *(string, optional)*: Path to interface configuration file.

### Agent Bindings (`agentBindings`)
Map local agent binding aliases to installed agent definitions:
```yaml
agentBindings:
  chief:
    definition: agent:chief
```

### Delegation (`delegation`)
Explicitly restricts which agents are permitted to delegate tasks to other agents:
```yaml
delegation:
  chief: [coder, reviewer]  # chief may delegate to coder and reviewer
  coder: []                 # coder cannot delegate
```

### Execution (`execution`)
Controls runtime isolation and safety limits:
- `maxParallelRuns` *(integer)*: Maximum concurrent worker sessions.
- `defaultIsolation` *(string)*: `none`, `process`, or `worktree`.
- `mutationIsolation` *(string)*: Isolation mode used for tasks that modify files (`worktree` strongly recommended).
- `defaultTimeoutMs` *(integer)*: Worker task timeout in milliseconds.
- `maxDelegationDepth` *(integer)*: Maximum allowed parent-to-child delegation chain depth.

### Authorization (`authorization`)
Configures approval gates for specific capability actions:
- `default`: `autonomous` (proceed without prompt) or `review` (require human approval).
- `actions`: Granular map of actions requiring explicit human approval (e.g., `file.write: review`).

### State & Tracking (`state`)
Defines the state storage driver and Git tracking behavior for state collections (`track`, `ephemeral`, `ignore`).
