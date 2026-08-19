# AGENTS.md

## Project Overview
VibeKit Agents V1: an always-running Agent Host on top of Pi. Components, Agents, and Projects remain the taxonomy. The Host is the running product. Pi is the embedded model/tool engine. This monorepo implements `vibekit` (CLI), `vibekit-host` (Host), `@useagentsio/core`, `@useagentsio/pi`, `@useagentsio/interface-sdk`, `@useagentsio/interface-terminal`, optional Slack and Telegram Interfaces, and the official registry. Canonical identity is the registry Module ID (`tool:browser`, `interface:telegram`); npm packages are optional `runtime.package` / `runtime.export` artifacts.

Normative spec: `docs/spec/V1-Implementation-Specification.md`. Runtime correction (supersedes the old `init`/`add`/`doctor` front door): `docs/spec/V1-Runtime-Correction.md`. Phase briefs: `docs/phases/`.

## Setup Commands
- Install: `pnpm install` (from `vibekit/`)
- Node `>=20`. Package manager: pnpm 11.18.0

## Test and Validation Commands
- `pnpm test` — vitest
- `pnpm typecheck` — `tsc -b`

## Architecture Notes
- Host is the running product. Users talk to a Project through an Interface; they do not launch the Pi TUI.
- `packages/host` — `@useagentsio/host`, binary `vibekit-host`
- `packages/cli` — `@useagentsio/cli`, binary `vibekit`: install/management (`init` `add` `list` `diff` `update` `remove` `doctor`) plus `create` `msg` `start`
- `packages/core` — schemas, IDs, validation, lifecycles, errors, compatibility, file targets
- `packages/pi` — embedded Pi adapter; not a user-facing runtime
- `packages/interface-sdk` — Interface contract
- `packages/interface-terminal` — default first-run terminal Interface
- `packages/interface-slack` — optional Slack Interface
- `packages/interface-telegram` — optional Telegram Interface
- `schemas/` — JSON Schema source of truth
- `registry/` — official Components and Agents (default curated catalog)
- `fixtures/` — valid/invalid documents from the spec
- `tests/` — schema, registry, CLI, composition, permissions, state, runtime, e2e

Do not fork Pi. Do not add a marketplace, hosted registries, search/discovery, ratings, graphical builder, `orchestrator` type, `subagent` type, or `Blocks`. The official registry is the default curated catalog; independently authored Modules can be installed from a local/custom registry path (`--registry`, recorded as `registrySource` official | local:<abs-path>). Slack and Telegram are optional shipped Interfaces; do not add more messaging platforms unless asked.

## Safety and Data Rules
- Secrets are references only. Never store secret values in YAML, JSON, Events, logs, or fixtures.
- File targets must be relative; reject `..`, absolute paths, null bytes.
- Installation/update/remove must be transactional. Do not overwrite conflicting user edits.
- Permissions are enforced at the runtime boundary, not in prompts.

## Implementation order
Phases 1–8 are sequential. Implement only the current phase's exit criteria. Slack and Telegram are optional shipped Interfaces; do not add more messaging platforms unless asked.
