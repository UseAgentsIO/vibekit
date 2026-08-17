# Pattern: proposal → verification → approval → apply

Documentation only. V1 does not execute Pattern files. This is the default consequential-change path. Done, verified, accepted, and applied are different states.

## Intent

An Agent produces a candidate without applying the mutation. Deterministic Verification and any required independent review inspect the exact revision. Approval, when Policy requires it, covers only that reviewed action. Apply happens only after those gates pass.

## Modules

- Any producing Agent (`agent:coder`, `agent:researcher`, or a user Agent)
- `agent:reviewer` when judgment is required
- `verifier:command`
- `policy:require-verification`
- `policy:least-privilege`
- `state:repository`

## Task fields

```yaml
delivery:
  mode: proposal

authorization:
  state: standing
```

Use `delivery.mode: apply` only when the exact action is already authorized and Policy does not require a further Approval.

## Flow

```text
Task (proposal)
  → Run
  → Result (completed)
  → Verification (exact revision)
  → independent review when required
  → Approval when Policy requires it
  → accepted
  → apply
```

1. **Proposal.** The producing Agent records artifacts and evidence. Proposal mode MUST NOT apply the mutation.
2. **Verification.** `verifier:command` (and any other required Verifier) checks the exact candidate revision, commit, hash, or artifact set. A failing Verifier blocks acceptance. A later revision change invalidates the record.
3. **Independent review.** When judgment is required, `agent:reviewer` reviews the same revision. The producing Agent MUST NOT review its own work.
4. **Approval.** If Project Policy marks the action `explicit`, request Approval for that exact action. Do not add a redundant gate when the action is already authorized.
5. **Apply.** Only an accepted, authorized Result is applied. Apply delivery records the Event and the new Project State.

## States

| State | Meaning |
| --- | --- |
| completed | The Agent returned a Result |
| verification passed | Required Verifiers accepted the exact revision |
| accepted | The Result may change canonical Project State |
| applied | The accepted mutation was performed |

A Result may complete and fail Verification. A Result may pass Verification and wait for Approval. A Result may be accepted as a proposal without being applied.

## Guardrails

- Agent completion is not Verification.
- Approval applies only to the exact reviewed action and revision.
- Secret values stay in the environment. Definitions store `GITHUB_TOKEN` / `OPENAI_API_KEY` references only.
- Self-modification of Agent definitions, instructions, Skills, Policies, and Project contracts uses this same propose → inspect → approve → verify base revision → apply path.
