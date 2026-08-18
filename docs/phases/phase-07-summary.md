# Phase 7 summary — Verification and application

Phase 7 implements verification, proposal/apply delivery, and Approval gates under `@useagentsio/core`. Filesystem State stores remain the source of truth. Agent completion is not Verification, acceptance, or apply.

## Test results

```text
pnpm exec tsc -b packages/core     → pass
pnpm exec vitest run tests/verification → 1 file, 11 tests passed
pnpm test                          → 11 Phase 7 tests passed
                                   (full workspace also ran Phase 6 files that
                                    are still in progress and not owned here)
pnpm typecheck                     → packages/core pass; remaining errors are
                                    in packages/pi/src/delegate.ts (Phase 6)
```

| File | Tests |
| --- | ---: |
| `tests/verification/acceptance.test.ts` | 11 |

Acceptance tests 31–39 (spec §36):

31. a completed Agent Result is not accepted State
32. a failing `verifier:command` blocks acceptance
33. the producing Agent cannot satisfy `independentReview`
34. a later candidate revision invalidates the old Verification
35. Project/Task `explicit` requires a durable Approval; `standing` does not re-approve
36. Approval matches only the exact action, target, and scope
37. `delivery.mode: proposal` refuses apply and writes no files
38. `delivery.mode: apply` requires an accepted and authorized Result
39. self-modification checks base hash and payload hash; the proposer cannot approve itself

## Files created or updated

### `@useagentsio/core`

- `packages/core/src/verify.ts` — candidate revision, command Verifier, independent-review contract, verification evaluation
- `packages/core/src/approval-gate.ts` — authorization mode, exact Approval matching, request/decide
- `packages/core/src/proposal.ts` — readiness, proposal delivery, accept without apply
- `packages/core/src/apply.ts` — apply-only-when-authorized, atomic writes, self-modification hashes
- `packages/core/src/index.ts` — append-only Phase 7 exports

### `@useagentsio/pi`

- `packages/pi/src/verify-hook.ts` — thin wrapper that calls core (does not start Pi)
- `packages/pi/src/index.ts` — append `verifyAfterRun` / `reviewAfterRun` / `evaluateVerification`

### Command Verifier payload

- `registry/components/verifier/command/1.0.0/payload/index.ts` — declared-command runner
- `registry/components/verifier/command/1.0.0/payload/verifier.yaml` — records exit code, evidence, exact revision

### Tests

- `tests/verification/helpers.ts`
- `tests/verification/acceptance.test.ts`

## Behavior

States stay separate:

```text
completed → verification passed → accepted → applied
```

- `runCommandVerification` executes a declared command, records exit code, evidence, and the exact candidate revision, and links the Verification onto the Result
- a passed Verification is valid only while `candidateRevision` still matches the Result artifacts
- `independentReview` requires a `review` Verification from a different Agent; recording a self-review fails closed
- `explicit` needs a durable approved Approval for that action/target/scope; `standing` is already authorized
- `acceptCandidate` may mark a Task accepted after those gates; it never applies
- `applyAcceptedResult` applies only when delivery is `apply`, the Task is accepted, Verification is current, and authorization permits it
- self-modification (`applySelfModification`) verifies the target base hash and the proposal payload hash before writing, and rejects self-approval

## Spec ambiguities resolved

1. **Candidate revision.** One artifact uses that artifact's `revision`. Several artifacts hash the sorted `path + revision` set as `sha256:<hex>`.
2. **Required Verifiers.** Callers pass `required` (typically `verifier:command`) plus optional `project.verification.default`. `policy:require-verification` with no Verifiers fails closed.
3. **Authorization combine.** Task mode, Project action override, and Project default: `deny` wins, then `explicit`, else `standing`.
4. **Applied state.** There is no `applied` Task/Result field. Apply is a gated write plus `artifact.changed` / `artifact.created` Events.
5. **Independent review.** Implemented as a Verification contract (`type: review`). The hook does not call Pi.
6. **Command source.** `runCommandVerification({ command })` or `.vibekit/config/verifiers/command.yaml`.
