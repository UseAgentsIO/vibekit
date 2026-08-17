# Phase 8 summary — Official Agent catalog

Catalog and Pattern documentation only. CLI install wiring, `doctor` e2e, runtime delegation, and `registry/index.json` generation stay with other phases.

## Validation

One-off `@vibekit/core` `parseAndValidateYaml` against every new `module.yaml` and every `payload/agent.yaml`. File targets, payload presence, secret-reference scan, and required-dependency presence also passed.

In-memory `buildRegistryIndex` (no write) resolved 16 official modules, including Phase 2 entries:

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

## New official Agents

Each Agent is `module.yaml` + editable `payload/agent.yaml` + `payload/instructions.md`. IDs are lowercase `type:name`. `schemaVersion: 1`.

| ID | Role |
| --- | --- |
| `agent:reviewer` | Independent review. No `source.write`. MUST NOT review its own producing work. `independentReview: true`. |
| `agent:researcher` | Cited research. No `source.write` or `repository.write` by default. Requires `skill:research`. |
| `agent:project-manager` | Tasking and scope. Delegation allowed to `coder`, `reviewer`, `researcher`. `maxDepth: 1`. |
| `agent:chief` | Composition. Delegation to `project-manager`, `coder`, `reviewer`, `researcher`. `maxDepth: 2` (Project example). |

`agent:coder` is unchanged (Phase 2).

## New official Components

| ID | Notes |
| --- | --- |
| `tool:github` | Spec §10 shape. Capabilities `repository.*`. Secret reference `GITHUB_TOKEN` from the environment. |
| `skill:research` | Pi Skill at `.pi/skills/research/SKILL.md`. Does not grant authority. |
| `provider:openai` | Pi provider config and `OPENAI_API_KEY` reference only. No rebuilt provider runtime. |
| `interface:terminal` | First Interface. Translates terminal I/O. Declares it does not own Project State. |

## Pattern documentation (`docs/patterns/`)

Docs-only. Not executable. Use normal Agent, Task, State, and Verification contracts.

- [Chief → Coder → Reviewer](../patterns/chief-coder-reviewer.md)
- [Chief → Project Manager → Coder](../patterns/chief-project-manager-coder.md)
- [Researcher → Reviewer](../patterns/researcher-reviewer.md)
- [proposal → verification → approval → apply](../patterns/proposal-verification-approval-apply.md)
- [parallel coding worktrees → independent integration](../patterns/parallel-coding-worktrees.md)

## Exit criteria

| Criterion | Status |
| --- | --- |
| Each Agent uses the same registry contract as `agent:coder` | Done |
| Each Agent is locally editable (`payload/agent.yaml`, `instructions.md`) | Done |
| Remaining §34.1 Components (`tool:github`, `skill:research`, `provider:openai`) and §34.3 `interface:terminal` | Done |
| §34.4 Pattern guides | Done |
| Each Agent passes `doctor` | Not run. Catalog only; doctor e2e is owned elsewhere. |
| Complete Chief → worker → review flow end to end | Documented as Patterns. Runtime wiring is owned by Phases 5–7. |

## Handoff

Phase 2 owns `registry/index.json` and the official-registry test ID list. After this catalog lands, regenerate the index (`pnpm registry:index`) and expand that expected-ID list to the 16 modules above. Do not treat this summary as an index write.
