# AGENTS.md

## Project Overview
VibeKit Agents V1: composition, contracts, installation, registry, and validation on top of Pi. Pi owns the model/tool loop. This monorepo implements `vibekit` (CLI), `@useagentsio/core`, `@useagentsio/pi`, and the official registry.

Normative spec: `docs/spec/V1-Implementation-Specification.md`. Phase briefs: `docs/phases/`.

## Setup Commands
- Install: `pnpm install` (from `vibekit/`)
- Node `>=20`. Package manager: pnpm 11.18.0

## Test and Validation Commands
- `pnpm test` — vitest
- `pnpm typecheck` — `tsc -b`

## Architecture Notes
- `packages/core` — schemas, IDs, validation, lifecycles, errors, compatibility, file targets
- `packages/cli` — `init` `add` `list` `diff` `update` `remove` `doctor`
- `packages/pi` — Pi runtime adapter
- `schemas/` — JSON Schema source of truth
- `registry/` — official Components and Agents
- `fixtures/` — valid/invalid documents from the spec
- `tests/` — schema, registry, CLI, composition, permissions, state, runtime, e2e

Do not fork Pi. Do not add a marketplace, third-party registries, graphical builder, `orchestrator` type, `subagent` type, or `Blocks`.

## Safety and Data Rules
- Secrets are references only. Never store secret values in YAML, JSON, Events, logs, or fixtures.
- File targets must be relative; reject `..`, absolute paths, null bytes.
- Installation/update/remove must be transactional. Do not overwrite conflicting user edits.
- Permissions are enforced at the runtime boundary, not in prompts.

## Implementation order
Phases 1–8 are sequential. Implement only the current phase's exit criteria. Phase 9 (Slack) is out of scope unless explicitly requested.
