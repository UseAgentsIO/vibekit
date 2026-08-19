# `project.yaml` Configuration Reference

`.vibekit/project.yaml` is the Project contract. Host-aware projects use **`schemaVersion: 2`**. Schema: `schemas/project.schema.json`.

---

## Annotated example

This matches `createDefaultProject` plus typical `create` / `add` bindings. Authorization modes are `deny` | `standing` | `explicit`. Tracking modes are `git` | `local` | `ephemeral`. Isolation is `process` | `worktree`. Delivery is `proposal` | `apply`.

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
    id: gpt-4.1

host:
  retainedConversations: 20
  maxParallelConversations: 4
  sameConversationPolicy: serialize
  shutdownGraceMs: 30000

interfaceBindings:
  terminal-main:
    definition: interface:terminal
    enabled: true
    defaultAgent: chief
    config: .vibekit/config/interfaces/terminal-main.yaml

pi:
  compatibility: ">=0.50.0"

state:
  backend: state:repository
  path: .vibekit/state
  tracking:
    conversations: local
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

delegation:
  chief:
    - coder
    - reviewer

capabilityBindings: {}

policies:
  - policy:least-privilege

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
  default: []

sources:
  canonical:
    - .vibekit/project.yaml
    - .vibekit/installed.json
  derived: []
  untrusted: []
```

`vibekit create` uses binding name `terminal-main` (not `terminal`).

---

## Field reference

### Root
- `schemaVersion` *(integer)*: `2` for Host runtime (V1 documents used `1`; `vibekit migrate` upgrades).
- `id`: `project:<slug>`
- `name`, `root`, optional `defaultAgent` (binding name, e.g. `chief`)

### `host`
- `retainedConversations`, `maxParallelConversations`, `shutdownGraceMs`
- `sameConversationPolicy`: only `serialize`

### `interfaceBindings`
Map of binding name → `{ definition, enabled, defaultAgent, config? }`.

### `agentBindings`
Map of binding name → `{ definition }` (module ID such as `agent:chief`).

### `delegation`
Binding name → list of target **binding names** the Agent may delegate to.

### `execution`
- `defaultIsolation` / `mutationIsolation`: `process` or `worktree` (there is no `none`)
- `maxParallelRuns`, `defaultTimeoutMs`, `maxDelegationDepth`

### `authorization`
- `default` and per-action values: `deny` | `standing` | `explicit`
- There is no `autonomous` or `review` mode

### `state.tracking`
Each kind: `git` (commit), `local` (on disk, typically gitignored by layout), `ephemeral` (runtime). There is no `track` or `ignore` string.

### `pi`
- `compatibility`: Pi version range (official modules use `>=0.50.0`)
