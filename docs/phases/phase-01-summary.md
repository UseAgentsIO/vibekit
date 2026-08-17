# Phase 1 summary — Schemas and contracts

Phase 1 is implemented under `vibekit/`. `pnpm typecheck` and `pnpm test` both pass.

## Test results

```text
pnpm typecheck  → tsc -b  (pass)
pnpm test       → 7 files, 83 tests passed
```

| File | Tests |
| --- | ---: |
| `tests/schemas/documents.test.ts` | 25 |
| `tests/core/ids.test.ts` | 23 |
| `tests/core/file-targets.test.ts` | 18 |
| `tests/core/lifecycles.test.ts` | 6 |
| `tests/core/schema-version.test.ts` | 4 |
| `tests/core/compatibility.test.ts` | 4 |
| `tests/core/errors.test.ts` | 3 |

Exit criteria covered:

- every extracted spec example validates
- invalid IDs fail
- unsupported `schemaVersion` values fail
- invalid lifecycle transitions fail
- schemas have focused fixture tests

## Files created

### Workspace

- `package.json`
- `pnpm-workspace.yaml` (`packages/*`, plus `allowBuilds.esbuild` for pnpm 11)
- `pnpm-lock.yaml`
- `tsconfig.json`
- `tsconfig.base.json`
- `vitest.config.ts`
- `.gitignore`
- `README.md`

### Packages

- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`
- `packages/core/src/ids.ts`
- `packages/core/src/schema-version.ts`
- `packages/core/src/validate.ts`
- `packages/core/src/lifecycles.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/compatibility.ts`
- `packages/core/src/file-targets.ts`
- `packages/core/src/types.ts`
- `packages/cli/package.json` (stub)
- `packages/cli/README.md`
- `packages/pi/package.json` (stub)
- `packages/pi/README.md`

### Schemas

- `schemas/module.schema.json`
- `schemas/component.schema.json`
- `schemas/agent.schema.json`
- `schemas/project.schema.json`
- `schemas/registry-entry.schema.json`
- `schemas/installed-module.schema.json`
- `schemas/installed.schema.json`
- `schemas/task.schema.json`
- `schemas/result.schema.json`
- `schemas/decision.schema.json`
- `schemas/approval.schema.json`
- `schemas/verification.schema.json`
- `schemas/event.schema.json`

### Fixtures

Valid (spec examples with legal replacements, plus invented complete records):

- `fixtures/valid/component-tool-github.yaml` (§10)
- `fixtures/valid/agent-coder.yaml` (§11)
- `fixtures/valid/project.yaml` (§12)
- `fixtures/valid/task.yaml` (§21)
- `fixtures/valid/result.yaml` (§22)
- `fixtures/valid/event.json` (§26)
- `fixtures/valid/secret-reference.yaml` (§31)
- `fixtures/valid/decision.yaml`
- `fixtures/valid/approval.yaml`
- `fixtures/valid/verification.yaml`
- `fixtures/valid/registry-entry.yaml`
- `fixtures/valid/installed-module.json`
- `fixtures/valid/installed.json`

Invalid:

- `fixtures/invalid/uppercase-module-id.yaml`
- `fixtures/invalid/space-in-id.yaml`
- `fixtures/invalid/missing-schema-version.yaml`
- `fixtures/invalid/schema-version-2.yaml`
- `fixtures/invalid/absolute-file-target.yaml`
- `fixtures/invalid/path-traversal-target.yaml`
- `fixtures/invalid/inline-secret-value.yaml`

### Tests

- `tests/tsconfig.json`
- `tests/helpers.ts`
- `tests/schemas/documents.test.ts`
- `tests/core/ids.test.ts`
- `tests/core/schema-version.test.ts`
- `tests/core/lifecycles.test.ts`
- `tests/core/file-targets.test.ts`
- `tests/core/compatibility.test.ts`
- `tests/core/errors.test.ts`

## Spec ambiguities resolved

1. **Agent vs Component required fields.** §10 requires Component `compatibility`, `source`, and `license`. The §11 Agent example omits them. Those fields are required on Component and registry-entry, optional on Agent, so the spec example validates.

2. **`healthCheck` is conditional.** §10.1 requires a health check “when runtime verification is possible”. The schema treats it as optional.

3. **`schemaVersion` error category.** Missing or non-integer values are `invalid_input`. An integer other than `1` is `compatibility_error` (`schema_version_unsupported`).

4. **Decision / Approval / Verification field names.** Spec §§23–25 list required concepts in prose, not YAML. Fixtures and schemas use camelCase aligned with Task / Result / Event: `producedBy`, `createdAt`, `taskId`, `resultId`, `requestedAt`, `decidedAt`, `expiresAt`, `candidateRevision`, `startedAt`, `finishedAt`, `exitCode`, `observedFailures`, `skipReason`.

5. **`installed.json` shape.** §17.1 lists recorded fields, not a document example. The aggregate is `{ schemaVersion, modules: InstalledModule[] }`.

6. **Event `taskId` / `runId`.** The §26 example includes both. Not every event type has a Task or Run, so those fields are optional and may be `null`.

7. **Evidence transitions.** §27.1 lists evidence states but no table. Implemented fail-closed: `proposed`/`observed`/`inferred` can move to accepted/rejected/disputed/unresolved/superseded as appropriate; accepted/rejected/disputed/unresolved can move to `superseded`; `superseded` is terminal; same-state is invalid.

8. **`agent:research` vs `agent:researcher`.** This spec copy’s §12 example uses `agent:chief`, `agent:coder`, and `agent:reviewer`. The project fixture keeps those catalog IDs and also binds `agent:researcher`.

9. **Pi compatibility strings.** `compatibility.pi` may be a semver range or a declared non-range string. Non-range strings match exactly.

10. **Secret values.** Module/Agent/Project/Event schemas have no raw-value field. Secret objects allow only `name`, `source`, and optional `required`. An extra `value` property fails validation.

11. **pnpm 11 build scripts.** `allowBuilds.esbuild: true` lives in `pnpm-workspace.yaml` so Vitest’s esbuild postinstall can run.
