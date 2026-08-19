# Persistent Sessions vs. Worker Runs

VibeKit cleanly separates interactive human communication from automated task execution by maintaining two distinct session primitives: **Persistent Conversation Sessions** and **Worker Runs**.

---

## The Two-Session Model

```text
               ┌────────────────────────────────────────────────────────┐
               │              Human / External Interface                │
               └───────────────────────────┬────────────────────────────┘
                                           │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                          PERSISTENT CONVERSATION SESSION                              │
│  - Keyed by interface + account + conversationId                                      │
│  - Spans multiple human turns                                                         │
│  - Stores conversation history in .vibekit/state/conversations/                       │
│  - Does not execute unsafe mutations directly in main tree                           │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │
                        Dispatches Task(s) │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                 WORKER RUN(S)                                         │
│  - Keyed by run_id (run_*)                                                            │
│  - Short-lived, task-scoped execution                                                 │
│  - Isolated via process or Git worktree                                               │
│  - Receives bounded task objective, scoped tools, and path grants                     │
│  - Emits Events and ResultDocument; terminates upon task completion                  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Persistent Conversation Sessions

A **Persistent Conversation Session** represents an ongoing dialogue between a human operator and an agent.

### Key Characteristics
- **Identity & Keying**: Uniquely identified by `interfaceBinding:accountId:conversationId` (and `threadId` when present).
- **Longevity**: Survives across multiple CLI invocations (`vibekit msg`) or stays active during an interactive session (`vibekit start`).
- **State Storage**: Serialized to `.vibekit/state/conversations/conversation_<uuid>.yaml`.
- **Concurrency Control**: Requests on the same conversation key are serialized to prevent race conditions and conflicting agent turns.
- **Scope**: Carries conversational context, operator intent, and conversation-level attachments.

---

## 2. Worker Runs

A **Worker Run** is an ephemeral, bounded execution context created to accomplish a specific `Task`.

### Key Characteristics
- **Identity**: Tracked by a globally unique Run ID (e.g., `run_01j9abc...`).
- **Isolation Modes**:
  - `process`: Runs in a separate Node.js / Pi process with environment variable isolation.
  - `worktree`: Checks out an isolated Git worktree branch for mutating coding tasks.
- **Bounded Inputs**: Workers do **not** inherit the full chat transcript. Instead, they receive:
  - Task objective, constraints, and acceptance criteria.
  - Scoped tool capabilities (e.g., specific file paths or bash command masks).
  - Explicit secret references required for the run.
- **Outcomes**: Emits fine-grained `EventDocument` records and finishes with a structured `ResultDocument`.
- **Termination**: Terminates immediately upon task completion, failure, timeout, or operator cancellation.

---

## Comparison Matrix

| Property | Persistent Conversation Session | Worker Run |
| :--- | :--- | :--- |
| **Primary Purpose** | Human dialogue & intent capture | Bounded task execution |
| **Lifetime** | Long-lived (multi-turn) | Ephemeral (single task) |
| **Identifier** | `conversation_*` | `run_*` |
| **Filesystem State** | Shared workspace view | Isolated Git worktree / sandbox |
| **Context Scope** | Multi-turn conversational memory | Bounded task objective & constraints |
| **Tool Execution** | Read-only / conversational tools | Mutation tools (under path grants) |
| **Persistence** | Stored in `.vibekit/state/conversations/` | Emits `ResultDocument` to `.vibekit/state/results/` |
| **Concurrency** | Serialized per conversation key | Parallelized up to `maxParallelRuns` |

---

## Delegation & Child Runs

When an agent delegates a task (e.g., `agent:chief` delegates to `agent:coder`):
1. The parent agent invokes the `agent_delegate` tool with a target agent name and task parameters.
2. The Host verifies that delegation is permitted by `.vibekit/project.yaml` (`delegation.<parent>` contains `<target>`).
3. The Host checks that `currentDepth < maxDelegationDepth`.
4. A new **Worker Run** is spawned for the child agent with isolated worktree bounds.
5. Upon completion, the child worker's `ResultDocument` is returned directly to the parent worker as the tool result.
