# State & Persistence

VibeKit treats state as a first-class, durable, machine-verifiable system artifact. All agent activity produces structured records stored in `.vibekit/state/`.

---

## State Directory Organization

The default state backend (`state:repository`) organizes records in clear subdirectories:

```text
.vibekit/state/
├── tasks/                 # TaskDocument records (task_*.json)
├── results/               # ResultDocument records (result_*.json)
├── decisions/             # DecisionDocument records (decision_*.json)
├── approvals/             # ApprovalDocument records (approval_*.json)
├── verifications/         # VerificationDocument records (verification_*.json)
├── events/                # EventDocument streaming records (event_*.json)
└── conversations/         # ConversationDocument records (conversation_*.json)
```

In addition, an untracked runtime scratch directory is used for process coordination:
```text
.vibekit/runtime/          # Gitignored: PID locks, claim leases, worktrees
```

---

## Core State Documents

### 1. Task (`TaskDocument`)
Represents an actionable request assigned to an agent.
- **ID**: `task_<nanoid>`
- **Fields**:
  - `objective`: High-level goal string.
  - `assignedAgent`: Bound agent name (e.g., `chief`, `coder`).
  - `constraints`: List of execution boundaries (e.g., "Do not modify package.json").
  - `acceptanceCriteria`: Specific conditions required for completion.
  - `delivery`: Object declaring mode (`direct`, `proposal`, `pr`).
  - `status`: `pending`, `claimed`, `running`, `completed`, `failed`, `cancelled`.

### 2. Result (`ResultDocument`)
The immutable record produced when a Worker Run finishes.
- **ID**: `result_<nanoid>`
- **Fields**:
  - `taskId`: Associated task reference.
  - `runId`: Specific run instance.
  - `status`: `success`, `failure`, `timeout`, `cancelled`.
  - `summary`: Human-readable summary of actions taken.
  - `artifacts`: List of generated or modified files with SHA-256 hashes.
  - `evidence`: Verification proof, test logs, or command execution outputs.
  - `unresolvedIssues`: Explicit list of blocked or remaining items.

### 3. Decision (`DecisionDocument`)
Records key architectural or strategic decisions made during a project lifecycle.
- **ID**: `decision_<nanoid>`
- **Fields**:
  - `title`: Short summary of the decision.
  - `context`: Background information and alternatives considered.
  - `status`: `proposed`, `accepted`, `rejected`, `superseded`.
  - `decidedBy`: Agent or human author.

### 4. Approval (`ApprovalDocument`)
Captures explicit human authorization for high-impact or policy-gated operations.
- **ID**: `approval_<nanoid>`
- **Fields**:
  - `taskId` / `action`: The gated operation requiring review.
  - `requestedBy`: Agent seeking approval.
  - `status`: `pending`, `approved`, `rejected`.
  - `decision`: Reviewer comments and timestamp.

### 5. Verification (`VerificationDocument`)
Records the outcome of independent verification checks (e.g., unit test runs, linter checks).
- **ID**: `verification_<nanoid>`
- **Fields**:
  - `targetRevision`: Git commit SHA or artifact hash verified.
  - `verifier`: Module ID of the verifier (e.g., `verifier:command`).
  - `status`: `passed`, `failed`, `error`.
  - `logs`: Raw stdout/stderr evidence.

### 6. Event (`EventDocument`)
Fine-grained audit trail emitted during an execution turn.
- **Fields**:
  - `runId` / `taskId`: Correlation IDs.
  - `type`: `tool_call`, `tool_result`, `text_delta`, `lifecycle`, `error`.
  - `timestamp`: ISO-8601 string.
  - `payload`: Structured event details.

---

## State Tracking Configuration

State tracking behavior is configured in `.vibekit/project.yaml` under `state.tracking`:

```yaml
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

### Tracking Modes
- **`track`**: Committed to source control. Serves as permanent project memory.
- **`ephemeral`**: Kept locally on disk for debugging and inspection, but omitted from long-term history or pruned periodically.
- **`ignore`**: Never committed or persisted across project wipes (e.g., `.vibekit/runtime/`).
