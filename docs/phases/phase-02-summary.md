# Phase 2 summary — Registry and CLI foundation

Phase 2 is implemented under `vibekit/`. `pnpm typecheck` and `pnpm test` both pass.

## Test results

```text
pnpm typecheck  → tsc -b  (pass)
pnpm test       → 16 files, 101 tests passed
pnpm registry:index → 16 official registry entries
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
| `tests/core/install.test.ts` | 1 |
| `tests/cli/init.test.ts` | 1 |
| `tests/cli/add.test.ts` | 4 |
| `tests/cli/list.test.ts` | 1 |
| `tests/registry/official.test.ts` | 1 |
| `tests/registry/safety.test.ts` | 3 |
| `tests/composition/dependencies.test.ts` | 3 |
| `tests/composition/capabilities.test.ts` | 2 |
| `tests/composition/ownership.test.ts` | 2 |

Acceptance tests covered (spec §36, as far as Phase 2 allows):

1. `init` creates a valid Project in a clean fixture
2. `add` installs a Component; `add agent coder` installs required dependencies
3. requested permissions are printed before apply
4. a failed install leaves the previous Project unchanged (plan failure and mid-apply rollback)
5. duplicate exclusive ownership is rejected
6. path traversal and absolute targets are rejected
12. missing required dependencies fail
13. dependency cycles fail
14. conflicting Modules fail
15. one capability provider resolves
16. several providers require an explicit binding

## Files created or updated

### Workspace

- `package.json` — `registry:index` script, `tsx`
- `pnpm-lock.yaml`
- `tsconfig.json` — CLI project reference
- `tests/tsconfig.json` — CLI reference and `vibekit` path
- `vitest.config.ts` — `vibekit` alias
- `README.md`
- `scripts/build-registry-index.ts`

### `@useagentsio/core`

- `packages/core/src/constants.ts`
- `packages/core/src/checksum.ts`
- `packages/core/src/yaml.ts`
- `packages/core/src/module.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/registry.ts`
- `packages/core/src/registry-index.ts`
- `packages/core/src/graph.ts`
- `packages/core/src/capabilities.ts`
- `packages/core/src/ownership.ts`
- `packages/core/src/installed.ts`
- `packages/core/src/project.ts`
- `packages/core/src/install.ts`
- `packages/core/src/doctor.ts`
- `packages/core/src/errors.ts` — `containsLikelySecret`
- `packages/core/src/index.ts`

### `vibekit` CLI

- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/README.md`
- `packages/cli/src/index.ts`
- `packages/cli/src/cli.ts`
- `packages/cli/src/args.ts`
- `packages/cli/src/output.ts`
- `packages/cli/src/paths.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/add.ts`
- `packages/cli/src/commands/list.ts`
- `packages/cli/src/commands/doctor.ts`

### Schemas

- `schemas/project.schema.json` — empty `agentBindings` allowed

### Official registry

Required Phase 2 modules:

- `policy:least-privilege`
- `policy:require-verification`
- `verifier:command`
- `state:repository`
- `tool:filesystem`
- `tool:execution`
- `skill:software-development`
- `agent:coder`

Additional valid V1.0.0 stubs also present and indexed:

- `policy` / `verifier` / `state` / `tool` / `skill` companions
- `provider:openai`
- `tool:github`
- `skill:research`
- `interface:terminal`
- `agent:reviewer`, `agent:researcher`, `agent:project-manager`, `agent:chief`

`registry/index.json` lists id, version, checksum, compatibility, and path.

### Tests

- `tests/helpers.ts`
- `tests/cli/*`
- `tests/registry/*`
- `tests/composition/*`
- `tests/core/install.test.ts`

## Spec ambiguities resolved

1. **Empty Project Agent bindings.** §12.1 and the Project schema previously implied at least one binding (`minProperties: 1`), but §16.1 / Phase 2 say `init` creates a valid Project with no Agents. `agentBindings` may now be empty.

2. **Product compatibility vs package version.** Registry modules declare `vibekit: ^1.0.0`. The npm workspace version remains `0.1.0`. Resolution uses product constant `VIBEKIT_VERSION = "1.0.0"` and `PI_RUNTIME_VERSION = "0.50.0"`.

3. **Agent `module.yaml` vs installed `agent.yaml`.** Registry Agents keep install metadata (files, source, license, compatibility) on `module.yaml`. `payload/agent.yaml` is the user-editable Agent contract copied into `.vibekit/agents/<name>/`.

4. **Declared but uninstalled Project references.** After `init`, `state.backend` is `state:repository` even though that Module is not installed. Doctor treats missing required deps of *installed* Modules as errors. Uninstalled Project declarations are not hard failures, so a fresh `init` can pass doctor.

5. **Capability auto-binding.** `add` does not write `capabilityBindings` when a Tool is the sole provider. The resolver uses spec §14.3: Agent binding → Project binding → exactly one compatible installed provider → fail if several. Never picks randomly.

6. **“Explicit Agent binding”.** The Agent schema has no per-capability binding map. The resolver accepts an Agent-level binding as an input for later phases; Project `capabilityBindings` is the V1 document field.

7. **Optional and recommended dependencies.** They are shown and never installed automatically. `agent:coder` still lists `tool:github` as optional and `policy:require-verification` as recommended.

8. **Extra catalog stubs.** Phase 2 only required eight modules. Additional official stubs that validate are included and indexed. Registry CI rejects missing licenses, unsafe targets, duplicate IDs, undeclared required deps, and likely secrets.

9. **Non-interactive `add`.** Tests use `--yes`. Without `--yes` and without a TTY, `add` fails closed rather than prompting.
