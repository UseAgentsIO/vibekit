# Pattern: Chief → Coder → Reviewer

Documentation only. V1 does not execute Pattern files. Compose this flow with normal Agent bindings, Tasks, State, and Verification.

## Intent

A Chief turns an objective into one bounded implementation Task, a Coder produces a candidate, and a Reviewer independently checks that candidate. The Coder MUST NOT satisfy the independent-review requirement.

## Modules

- `agent:chief`
- `agent:coder`
- `agent:reviewer`
- `state:repository`
- `verifier:command`
- `policy:require-verification`
- `policy:least-privilege`
- `tool:filesystem`
- `tool:execution`

## Project shape

```yaml
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

execution:
  maxDelegationDepth: 2
  mutationIsolation: worktree

verification:
  default:
    - verifier:command
```

Chief `maxDepth` is 2, matching the Project example. Direct Chief → Coder is depth 1. Chief → Coder plus a sibling review Task is still inside that limit.

## Flow

1. The terminal Interface (or another Interface) creates a Task assigned to `chief`.
2. Chief records a child implementation Task with objective, constraints, acceptance criteria, and `delivery.mode: proposal`.
3. Chief delegates that Task to `coder`. The Coder Run uses worktree isolation and may write only granted paths.
4. Coder returns a Result with artifacts, evidence, and unresolved issues. Completion is not Verification.
5. `verifier:command` runs against the exact candidate revision.
6. Chief (or Project policy) creates a review Task assigned to `reviewer`, pointing at the Coder Result and producing Agent.
7. Reviewer reads the candidate. It MUST refuse if it produced the work. It records findings without writing source.
8. Acceptance requires the command Verification and the independent review. Apply is a later, authorized step.

## Guardrails

- Reviewer has no `source.write` grant.
- Coder `independentReview` is false; review is a separate Agent and Task.
- Several coding Runs MUST NOT share a working tree.
- A changed candidate revision invalidates prior Verification.
