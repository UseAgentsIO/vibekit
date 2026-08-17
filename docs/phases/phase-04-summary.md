# Phase 4 summary — Project State

Phase 4 implements the `state:repository` adapter under `packages/core/src/state/`. Filesystem records are the source of truth. `@vibekit/core`’s `index.ts` is owned by Phase 2 and is not updated; tests import the adapter from `packages/core/src/state/index.ts`.

## Test results

```text
./node_modules/.bin/vitest run tests/state  → 4 files, 20 tests passed
./node_modules/.bin/tsc -b                  → pass
```

`pnpm test tests/state` was not used: the workspace `package.json` is mid-edit by Phase 2 (`ERR_PNPM_INVALID_DEPENDENCY_NAME` empty dependency name), and this phase must not run `pnpm install`. Vitest and `tsc -b` were invoked directly.

| File | Tests |
| --- | ---: |
| `tests/state/repository.test.ts` | 6 |
| `tests/state/concurrency.test.ts` | 8 |
| `tests/state/events.test.ts` | 3 |
| `tests/state/atomic.test.ts` | 3 |

Exit criteria covered:

- State survives process restart (new adapter instance reads the same files)
- conflicting writes are rejected (`conflict` / `state_revision_conflict` / `state_hash_conflict`)
- stale claims can be recovered (`recoverStale` and again on `open()`)
- Events are append-only (prior JSONL lines are preserved; truncated last line is ignored)
- no partial State writes remain after failure (crash between temp write and rename; leftovers cleaned on open)

## Files created

### Adapter (`packages/core/src/state/`)

- `index.ts` — public Phase 4 API
- `types.ts` — claim/lock/store types
- `constants.ts` — `state:repository` defaults
- `errors.ts` — `VibeKitError` helper
- `atomic.ts` — same-dir temp file + `rename`; leftover `.tmp` cleanup
- `locks.ts` — exclusive lock files (`wx`) with bounded leases
- `tracking.ts` — spec §8.3 git / local / ephemeral layout
- `store.ts` — Task / Result / Decision / Approval / Verification YAML stores
- `events.ts` — append-only `.vibekit/state/events/YYYY-MM-DD.jsonl`
- `claims.ts` — claim/lease store + stale recovery (Phase 6 uses this)
- `repository.ts` — `createRepositoryState()` / `RepositoryState`

### Tests (`tests/state/`)

- `helpers.ts`
- `repository.test.ts`
- `concurrency.test.ts`
- `events.test.ts`
- `atomic.test.ts`

## Layout and tracking

Records live under `.vibekit/state/<kind>/` as `{id}.yaml`.

Events: `.vibekit/state/events/YYYY-MM-DD.jsonl` (append only; never rewritten).

Claims and locks (runtime / ephemeral):

- `.vibekit/runtime/claims/<claim_id>.json`
- `.vibekit/runtime/locks/<name>.lock`

Default tracking (spec §8.3):

```yaml
decisions: git
tasks: local
results: local
approvals: local
verifications: local
events: local
runtime: ephemeral
```

`open()` writes `.vibekit/state/.gitignore` so local kinds are ignored and `decisions/` stays committable. Runtime is always ignored (`*`). A kind set to `ephemeral` is stored under `.vibekit/runtime/state/<kind>/`.

## Concurrency

- Document updates require `expectedRevision` (Tasks, Claims) or `expectedHash` (other records).
- Mismatch throws `VibeKitError` category `conflict`.
- Status changes go through `assertTransition`.
- Documents are validated with `validateDocument` / `parseAndValidateYaml` / `parseAndValidateJson`.
- Writes take an exclusive lock, then temp-file + rename.
- Exclusive claims: one active claim per Task; expired leases are removed and the Task can be claimed again.

## Spec ambiguities resolved

1. **Document file format.** Spec examples are YAML; Events are JSONL. Stores use `{id}.yaml`. Claims and locks are JSON (runtime, not reviewed in git).
2. **Hash vs revision.** Tasks (and claims) use incrementing `revision`. Results / Decisions / Approvals / Verifications have no revision field, so optimistic concurrency uses a `sha256:` content hash of the on-disk file.
3. **Auto-increment.** If an updated Task is sent with the current revision, the store writes `current + 1`. Sending `current + 1` is also accepted. Any other jump is `invalid_input`.
4. **Claim records.** There is no claim schema. Records include spec §28.1 fields plus `exclusive` and `revision`. IDs are `claim_<uuid>`.
5. **Stale lock recovery.** A lock whose `expiresAt` is `<= now` is unlinked. Same-owner acquire renews the lease. Foreign unexpired acquire is `resource_busy`.
6. **Crash during Event append.** A truncated final JSONL line is skipped on read so prior Events remain canonical.
7. **Phase 2 export.** Tests import `../../packages/core/src/state/index.js` so they do not depend on `packages/core/src/index.ts`.
