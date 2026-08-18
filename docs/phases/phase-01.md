# Phase 1 — Schemas and contracts

**Owner:** implementer subagent
**Depends on:** none
**Unlocks:** Phases 2–8

## Build
- IDs
- schema definitions
- schema validation
- lifecycle enums
- error types
- fixture documents
- compatibility parsing

## Exit criteria (spec §35)
- every example in the specification validates
- invalid IDs fail
- unsupported schema versions fail
- invalid lifecycle transitions fail
- schemas have focused tests

## Required artifacts
Monorepo under `vibekit/`:

```
packages/core/          @useagentsio/core
packages/cli/           vibekit (stub only)
packages/pi/            @useagentsio/pi (stub only)
schemas/*.schema.json
tests/schemas/
examples/ (fixtures from spec YAML/JSON)
```

JSON Schemas required:
- `module.schema.json`
- `component.schema.json`
- `agent.schema.json`
- `project.schema.json`
- `registry-entry.schema.json`
- `installed-module.schema.json` (and the installed.json aggregate)
- `task.schema.json`
- `result.schema.json`
- `decision.schema.json`
- `approval.schema.json`
- `verification.schema.json`
- `event.schema.json`

## `@useagentsio/core` public surface (Phase 1)
- typed ID parse/format/validate (`type:name`, runtime prefixes)
- `schemaVersion` integer, reject unsupported
- load + validate YAML/JSON documents
- lifecycle enums + transition tables
- failure categories from spec §32
- semver + compatibility range parse (`^1.0.0`, `>=20`)
- file-target safety helpers (relative, reject `..`, absolute, null bytes)

Do **not** implement CLI commands, registry install, Pi adapter, or catalog Agents in this phase beyond fixture documents.

## Spec references
Read `vibekit/docs/spec/V1-Implementation-Specification.md` sections 7–12, 17, 21–26, 32, 35 Phase 1.
