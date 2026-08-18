# Phase 8 e2e summary — Catalog install, doctor, composition

Phase 8 catalog drafts from `414b17f` already used the same registry contract as `agent:coder`. This pass proves they install through `vibekit add`, pass `doctor`, and run a Chief → Coder → Reviewer flow without a live LLM.

## Validation

```text
pnpm typecheck          → tsc -b  (pass)
pnpm test               → 38 files, 207 tests passed
```

| File | Tests |
| --- | ---: |
| `tests/end-to-end/catalog.test.ts` | 8 |
| `tests/end-to-end/catalog-flow.test.ts` | 1 |
| `tests/registry/official.test.ts` | 1 (expanded) |

## Exit criteria

| Criterion | Status |
| --- | --- |
| Each official Agent installs through `vibekit add` | Done. `coder`, `reviewer`, `researcher`, `project-manager`, and `chief` install with `--yes` on a fresh `init` Project. Required deps follow the same resolver as any other Module. |
| Each Agent can be edited locally | Done. Install copies `payload/agent.yaml` and `payload/instructions.md`. A local instructions edit is kept; `doctor` reports `installed_hash_mismatch` as a warning and still exits 0. |
| Each Agent passes `doctor` after install | Done. Per-Agent and all-five Projects exit 0 with `doctor: ok`. |
| Catalog IDs match `registry/index.json` | Done. Built index IDs equal the published 16-module list. No catalog YAML change, so `pnpm registry:index` was not required. |
| Chief → worker → review works end to end without a live LLM | Done. Injected `createSession` (same pattern as Phases 5–6). Command Verifier + proposal path. Independent review cannot be the producing Agent. Apply is refused for `delivery.mode: proposal`. |

## What the composition test does

1. `init` a fixture Project
2. `add` chief (and required deps), coder, reviewer, and `policy:require-verification`
3. Bind `chief → coder, reviewer` plus capability and model defaults in `project.yaml`
4. Create a Chief Task (`delivery.mode: proposal`)
5. `runManaged` Chief, then `executeDelegation` to coder and reviewer
6. `verifier:command` against the exact coder candidate revision
7. `recordIndependentReview` rejects `agent:coder` (`independent_review_self`) and accepts `agent:reviewer`
8. `createProposal` records a verified candidate; `applyAcceptedResult` refuses to write source

## Small product fixes (no new CLI commands)

- `createDefaultProject` now sets `defaults.model` to `openai` / `gpt-4.1`, matching the spec fixture. Official Agents declare `inherit` and otherwise cannot start a Run.
- `doctor` now validates installed `agent.yaml` documents, Agent binding references, and Project delegation cycles/targets.
- Reviewer `candidate` / Researcher `questions` inputs resolve from Task `context.references` and `objective` so catalog contracts work with the Task schema.

## Official catalog (unchanged)

```text
agent:chief@1.0.0
agent:coder@1.0.0
agent:project-manager@1.0.0
agent:researcher@1.0.0
agent:reviewer@1.0.0
interface:terminal@1.0.0
policy:least-privilege@1.0.0
policy:require-verification@1.0.0
provider:openai@1.0.0
skill:research@1.0.0
skill:software-development@1.0.0
state:repository@1.0.0
tool:execution@1.0.0
tool:filesystem@1.0.0
tool:github@1.0.0
verifier:command@1.0.0
```

## Files

- `packages/core/src/doctor.ts` — Agent schema, binding, and delegation checks
- `packages/core/src/project.ts` — default Project model
- `packages/pi/src/task.ts` — catalog input mapping
- `tests/end-to-end/catalog.test.ts`
- `tests/end-to-end/catalog-flow.test.ts`
- `tests/registry/official.test.ts`

Not done: live model/provider session, apply of real source, Slack (Phase 9), npm publish.
