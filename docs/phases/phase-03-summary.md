# Phase 3 summary — Safe ownership and updates

Phase 3 is implemented under `vibekit/`. `pnpm typecheck` and `pnpm test` both pass. This phase was not committed: the working tree also contains Phase 4/5/8 files owned by other agents.

## Test results

```text
pnpm typecheck  → tsc -b  (pass)
pnpm test       → 31 files, 165 tests passed
```

Phase 3 files:

| File | Tests |
| --- | ---: |
| `tests/core/update.test.ts` | 6 |
| `tests/cli/diff.test.ts` | 2 |
| `tests/cli/update.test.ts` | 3 |
| `tests/cli/remove.test.ts` | 3 |

Acceptance tests covered (spec §36):

7. local Agent edits are detected by `diff` (`agent:coder` instructions) and nothing is written
8. an unchanged Module updates automatically (`1.0.0` → `1.1.0`)
9. locally changed + upstream changed file → `update_conflict` and the entire Module update stops
10. `remove` does not delete a modified file (`remove_modified`)
11. a dependency still used by another Module is not removed

Also covered: incompatible requested versions are refused; unchanged exclusive files are removed; generated configuration is rebuilt on a successful update.

## Files created or updated

### `@vibekit/core`

- `packages/core/src/diff.ts` — compare installed registry version, current user files, and newest compatible registry version
- `packages/core/src/update.ts` — three-way plan/apply, compatibility, generated config rebuild, transactional staging
- `packages/core/src/remove.ts` — safe removal, unused-dep cascade, shared-dep retention
- `packages/core/src/index.ts` — append-only Phase 3 exports

### `vibekit` CLI

- `packages/cli/src/commands/diff.ts`
- `packages/cli/src/commands/update.ts`
- `packages/cli/src/commands/remove.ts`
- `packages/cli/src/cli.ts` — wire `diff` / `update` / `remove` and extend help

### Tests

- `tests/cli/diff.test.ts`
- `tests/cli/update.test.ts`
- `tests/cli/remove.test.ts`
- `tests/core/update.test.ts`

Checksum helpers in `checksum.ts` were sufficient; `hash.ts` was not added.

## Behavior

Three-way (spec §16.5):

```text
base = installed registry version
local = current user-owned file
upstream = requested (default: newest compatible) registry version
```

- local == base → replace with upstream
- upstream == base → keep local
- local == upstream → mark current
- both changed → report every conflicting path and stop; no file is written
- no `--force` in V1

`diff` is read-only. `update` and `remove` reuse staging, `planInstall` for newly required deps, and `doctor` after apply. Both require `--yes` when non-interactive and about to mutate.

Removal (spec §16.6):

- unchanged exclusive files and default config fragments may be deleted
- unused required dependencies are removed with the Module
- a dependency still required by another installed Module remains
- a Module still required by another installed Module is refused (`module_in_use`)
- any modified exclusive file or customized fragment stops the whole removal

Generated configuration:

- Modules own fragments under `.vibekit/config/<type>/<name>.yaml` (or the path declared by the Module)
- `.vibekit/runtime/generated/config.yaml` is rebuilt from remaining fragments
- generated files are not exclusively owned and are never three-way merged

Compatibility: `update` without a version pin selects the newest compatible registry entry. An explicit incompatible version (`type:name@x.y.z`) is refused.

## Spec ambiguities resolved

1. **Selector form.** Commands accept `type:name`, `type name`, and `type:name@version` so they match the spec examples and the Phase 2 `add <type> <name>` style.

2. **Newest compatible vs requested version.** `diff` always compares against the newest compatible registry version. `update` uses that version unless the user pins `@version`.

3. **Unused dependencies on remove.** Shared deps still required by another Module stay. Unreferenced required deps of the removed Module are removed with it, unless they were modified (that stops removal).

4. **Config fragments have no stored hash.** Install records them only on `configurationPaths`. Base content is reconstructed from the installed registry version’s default fragment (`stringifyYaml(defaultConfigFor(module))`).

5. **Generated files are derived.** They are rewritten after a successful update/remove and are not listed as exclusive ownership in `installed.json`.

6. **Already current.** Same installed version, no payload writes, and no deletes is a no-op (`Already current`) and does not require `--yes`.

## Orchestrator notes

Do not commit this phase from a mixed index. Phase 3 paths only:

```text
packages/core/src/diff.ts
packages/core/src/update.ts
packages/core/src/remove.ts
packages/core/src/index.ts
packages/cli/src/commands/diff.ts
packages/cli/src/commands/update.ts
packages/cli/src/commands/remove.ts
packages/cli/src/cli.ts
tests/cli/diff.test.ts
tests/cli/update.test.ts
tests/cli/remove.test.ts
tests/core/update.test.ts
docs/phases/phase-03-summary.md
```
