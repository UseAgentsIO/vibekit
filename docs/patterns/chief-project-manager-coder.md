# Pattern: Chief → Project Manager → Coder

Documentation only. V1 does not execute Pattern files. Compose this flow with normal Agent bindings, Tasks, State, and Verification.

## Intent

A Chief keeps composition at the Project level. A Project Manager breaks the objective into scoped worker Tasks. One or more Coders implement those Tasks. The Chief does not implement the change, and the Project Manager does not write source.

## Modules

- `agent:chief`
- `agent:project-manager`
- `agent:coder`
- `agent:reviewer` (recommended after each coding Result)
- `state:repository`
- `policy:least-privilege`
- `policy:require-verification`

## Project shape

```yaml
agentBindings:
  chief:
    definition: agent:chief
  project-manager:
    definition: agent:project-manager
  coder:
    definition: agent:coder
  reviewer:
    definition: agent:reviewer

delegation:
  chief:
    - project-manager
    - coder
    - reviewer
  project-manager:
    - coder
    - reviewer
  coder: []
  reviewer: []

execution:
  maxDelegationDepth: 2
  maxParallelRuns: 4
  mutationIsolation: worktree
```

Depth accounting:

```text
chief (0) → project-manager (1) → coder (2)
```

That is the Project example maximum. Chief MUST NOT add another delegation hop beneath Coder.

## Flow

1. Interface input becomes a Task assigned to `chief`.
2. Chief delegates a scoping Task to `project-manager` when the work is more than one bounded change.
3. Project Manager writes worker Tasks with paths, acceptance criteria, dependencies, and delivery mode.
4. Project Manager delegates each implementation Task to `coder`. `maxDepth` for Project Manager is 1.
5. Each Coder Run uses its own worktree. Results return to Project State.
6. Required Verification and independent review proceed as separate Tasks. Project Manager may delegate review to `reviewer`.
7. Chief records Decisions from the aggregated Results. It does not merge worktrees itself.

## Guardrails

- Delegation is denied unless the Agent contract, Project graph, Task, and depth limits all allow it.
- Cycles are rejected. Coder and Reviewer have empty target lists.
- Project Manager and Chief deny `source.write`, `project.configure`, `module.install`, and `deploy.apply`.
- Optional worker Agents are not installed silently. Add `agent:coder` (and `agent:reviewer`) before this Pattern can run.
