# State & Persistence

VibeKit treats state as a first-class, durable, machine-verifiable system artifact. All agent activity produces structured records stored in `.vibekit/state/`.

---

## State Directory Organization

The default state backend (`state:repository`) organizes records in clear subdirectories:

```text
.vibekit/state/
├── tasks/                 # task_<uuid>.yaml
├── results/               # result_<uuid>.yaml
├── decisions/             # decision_<uuid>.yaml
├── approvals/             # approval_<uuid>.yaml
├── verifications/         # verification_<uuid>.yaml
├── events/                # append-only event log
└── conversations/         # conversation_<uuid>.yaml (Host ConversationStore)
```

In addition, an untracked runtime scratch directory is used for process coordination:
```text
.vibekit/runtime/          # Gitignored: PID locks, claim leases, worktrees
```

---

## Core State Documents

### 1. Task (`TaskDocument`)
Represents an actionable request assigned to an agent.
- **ID**: `task_<uuid>`
- **Fields**:
  - `objective`, `constraints`, `acceptanceCriteria`
  - `assignedAgent`: Module ID (`agent:coder`) or `null`
  - `delivery.mode`: `proposal` or `apply`
  - `authorization.state`: `deny` | `standing` | `explicit`
  - `status`: `open`, `claimed`, `running`, `blocked`, `review`, `accepted`, `failed`, `cancelled`

### 2. Result (`ResultDocument`)
The record produced when a Worker Run finishes.
- **ID**: `result_<uuid>`
- **Fields**:
  - `taskId`, `runId`, `agentId`
  - `status`: `completed` or `failed`
  - `summary`, `artifacts` (`path` + `revision`), `evidence`, `unresolvedIssues`
  - `verificationIds`, `discoveredConstraints`, `recommendedNextActions`

### 3. Decision (`DecisionDocument`)
Records key architectural or strategic decisions made during a project lifecycle.
- **ID**: `decision_<uuid>`
- **Fields**:
  - `question`, `decision`, `reason`, `evidence`
  - `status`: `proposed`, `accepted`, `rejected`, `disputed`, `superseded`
  - `authority`, `producedBy`

### 4. Approval (`ApprovalDocument`)
Captures explicit human authorization for high-impact or policy-gated operations.
- **ID**: `approval_<uuid>`
- **Fields**:
  - `action`, `target`, `scope`, `taskId`, optional `resultId`
  - `status`: `pending`, `approved`, `rejected`, `expired`
  - `requestedAuthority`, `requestedAt`, `decidedAt`, `expiresAt`

### 5. Verification (`VerificationDocument`)
Records the outcome of independent verification checks (e.g., unit test runs, linter checks).
- **ID**: `verification_<uuid>`
- **Fields**:
  - target revision / verifier module ID
  - `status`: `pending`, `passed`, `failed`, `skipped`

### 6. Event (`EventDocument`)
Fine-grained audit trail emitted during an execution turn.
- **Fields**: `id` (`event_<uuid>`), `type` (string), `projectId`, optional `taskId` / `runId`, `actor`, `timestamp`, `data` (no secret values).

---

## State Tracking Configuration

State tracking behavior is configured in `.vibekit/project.yaml` under `state.tracking`:

```yaml
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
```

### Tracking modes
- **`git`**: Intended to be committed (default for `decisions`).
- **`local`**: On disk under `.vibekit/state/`; not the Git-backed history.
- **`ephemeral`**: Runtime only (default for `runtime`, under `.vibekit/runtime/`).
