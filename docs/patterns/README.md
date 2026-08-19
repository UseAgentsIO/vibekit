# Multi-Agent Workflow Patterns

VibeKit treats workflow patterns as **documentation and compositions**, not as a rigid workflow engine or separate DSL.

You compose patterns using standard Agent recipes, delegation permissions, project policies, and state records.

---

## Documented Patterns

| Pattern | Focus | Description |
| :--- | :--- | :--- |
| **[Chief → Coder → Reviewer](chief-coder-reviewer.md)** | Code Implementation & Review | Chief delegates implementation to Coder and independent review to Reviewer. Reviewer is strictly isolated and cannot review its own work. |
| **[Chief → Project Manager → Coder](chief-project-manager-coder.md)** | Hierarchical Planning | Chief delegates epic breakdown to Project Manager, who generates discrete task records and delegates coding runs. |
| **[Parallel Coding Worktrees](parallel-coding-worktrees.md)** | Concurrent Coding | Multiple Coder runs operate simultaneously in isolated Git worktrees without filesystem collisions. |
| **[Proposal → Verification → Approval → Apply](proposal-verification-approval-apply.md)** | Controlled Mutation | Code changes are produced as candidate proposals, verified by automated checks, approved by humans, and applied atomically. |
| **[Researcher → Reviewer](researcher-reviewer.md)** | Evidence & Fact-Checking | Researcher compiles cited findings while Reviewer verifies claim accuracy and source reliability without code write grants. |

---

## Pattern Composition Principles

1. **No Orchestrator Abstraction**: Orchestration is accomplished by normal agent delegation (`agent_delegate`).
2. **Explicit Delegation Whitelist**: Parent agents can only delegate to agents explicitly listed in `.vibekit/project.yaml` under `delegation.<agent>`.
3. **Strict Separation of Duties**: Agents that generate code should not possess permissions to self-approve or self-review.

New patterns are documentation under `docs/patterns/` plus ordinary Agent/Project composition. Do not add a workflow DSL. Contribution contract: [CONTRIBUTING.md](../../CONTRIBUTING.md).
