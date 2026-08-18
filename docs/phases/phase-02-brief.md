# Phase 2 implementation brief

Read after Phase 1 is merged. Implement only Phase 2.

## Goal
Official in-repo registry + `vibekit` CLI foundation: `init`, `add`, `list`, and `.vibekit/installed.json`.

## Packages
- `@useagentsio/core` — module graph, dependency/conflict/capability resolution, file-target validation, installed-manifest types (already have schemas)
- `vibekit` (`packages/cli`) — user-facing commands
- `registry/` — official registry payloads

## Registry layout (spec §18)
```
registry/
├── index.json
├── components/<family>/<name>/<version>/
│   ├── module.yaml
│   ├── config.schema.json   (when configurable)
│   └── payload/
└── agents/<name>/<version>/
    ├── module.yaml
    └── payload/
        ├── agent.yaml
        └── instructions.md
```

`index.json` lists Module ID, version, checksum, compatibility, path. Registry CI helpers SHOULD validate every schema, reject absolute/traversal targets, duplicate IDs, missing licenses, undeclared deps, and compute checksums.

## Minimal registry payload for Phase 2 exit criteria
Enough to:
1. `init` a clean Pi fixture
2. `add` one Component (recommend `policy:least-privilege` or `verifier:command` — small payload)
3. `add agent coder` resolving required deps

Ship at least:
- `policy:least-privilege`
- `policy:require-verification`
- `verifier:command`
- `state:repository`
- `tool:filesystem`
- `tool:execution`
- `skill:software-development`
- `agent:coder` (required deps only)

Other catalog entries may be stubs that validate, or wait for Phase 8. Prefer valid installable stubs over empty folders.

## `init` (spec §16.1)
1. verify target is a usable Pi project (look for `.pi/` or `package.json` + documented Pi markers; if missing, create a minimal Pi fixture layout: `.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`)
2. detect package manager (pnpm/npm/yarn from lockfile)
3. create `.vibekit/`
4. create `.vibekit/project.yaml` (valid Project contract, no Agents unless user chose one)
5. create `.vibekit/installed.json`
6. record VibeKit core / Pi adapter as workspace dependencies when running inside this monorepo; do not publish to npm
7. install thin Pi extension entry point under `.pi/extensions/vibekit/` (stub that loads later)
8. add `.gitignore` rules for `.vibekit/runtime/`
9. run `doctor` (Phase 2 doctor may be a subset: schema + ownership + deps; full doctor list is §16.7 — implement what you can, leave later checks as structured "not-yet-implemented" only if they would be dishonest; prefer implementing schema/module/ownership/dep checks)
10. report created/changed files

## `add` (spec §16.2)
Resolve → required deps → compatibility → file ownership → conflicts → show permissions → prompt config (non-interactive `--yes` for tests) → secret refs only → stage → validate → apply atomically → update installed.json → doctor.

Atomic flow §17.4: plan → stage → validate schemas/ownership/project → apply → update manifest → clean staging. Failure leaves previous valid state.

## `list` (spec §16.3)
Show id, version, source, and the four separate statuses: installed / configured / available / verified.

## Ownership
Exclusive: one Module owns the file. Generated: VibeKit builds from fragments. Duplicate exclusive ownership is rejected. Path traversal and absolute targets rejected (use `@useagentsio/core` helpers).

## Tests to add (`tests/cli/`, `tests/registry/`, `tests/composition/`)
Map to acceptance tests 1–6 and 12–16 as far as Phase 2 can prove them.

## Out of scope
`diff`/`update`/`remove` (Phase 3), State stores (Phase 4), Pi runs (Phase 5+), full Agent catalog polish (Phase 8).
