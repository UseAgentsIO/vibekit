# AGENTS.md

## Project Overview

VibeKit Agents is a TypeScript/ESM monorepo for an always-running Agent Host. The product flow is `Project → Host → Interface`; the Host embeds Pi for model and tool execution, and users must not be told to launch the Pi TUI. The taxonomy is `Components → Agents → Project → Host`, with canonical identity defined by registry Module IDs such as `tool:browser` and `interface:telegram`; npm packages are optional `runtime.package` / `runtime.export` artifacts.

Use `docs/spec/V1-Runtime-Correction.md` for current runtime behavior, `docs/spec/Local-Gateway-Specification.md` for local Project management, `docs/spec/V1-Implementation-Specification.md` for the underlying contracts, and `docs/contributing/guide.md` for contribution details.

## Setup Commands

- Requirements: Node.js `>=20` and pnpm `11.18.0`.
- Install dependencies from the repository root: `pnpm install`.
- For one-off source execution, use `pnpm exec tsx packages/cli/src/index.ts --help`.
- To test through the normal global `vibekit` command without publishing, first stage runtime assets and build with `node scripts/prepare-publish.mjs core`, `node scripts/prepare-publish.mjs cli`, and `pnpm typecheck`, then run `(cd packages/cli && npm link)`. This links the global command to the checkout; do not repeat it after every change.
- During development, rebuild continuously with `pnpm exec tsc -b --watch --preserveWatchOutput`. CLI commands load the latest build on each invocation. Restart the Project Host after Host, Pi, Tool, or Interface changes, and restart the Gateway after Gateway or dashboard changes.
- Run the Host directly during development: `pnpm exec tsx packages/host/src/main.ts /path/to/project`.

## Test and Validation Commands

- Full tests: `pnpm test`.
- Targeted tests: `pnpm test tests/cli` or another directory under `tests/`.
- Type checking across project references: `pnpm typecheck`.
- After registry module changes: `pnpm registry:index`, then `pnpm test tests/registry`.
- Keep package versions unchanged during ordinary development and local-link testing. Publishing is not a testing step.
- At an explicitly authorized release boundary, synchronize the private workspace root and all public packages with `pnpm version:packages <version>`, then verify with `pnpm version:check`; never bump an individual `packages/*/package.json`.
- Before an authorized release, run `pnpm publish:check`. Run `pnpm publish:packages` only when the feature set is ready and a maintainer explicitly requests the external npm writes.

There is no root lint or format script. Inspect the root `package.json` before documenting or relying on additional commands.

## Architecture Notes

- `packages/cli` owns the `vibekit` binary, Project composition/runtime commands, the machine-local Project registry, and the loopback-only Gateway/dashboard. `start` runs one Project Host detached by default or attached with `--foreground`; `msg` uses that Project's Host over local IPC and otherwise creates a short-lived Host.
- The Gateway reads configuration and Host health metadata only. It never loads or combines Project conversations, sessions, State, secrets, Agent instructions, or tool context. Gateway service changes must leave Project Hosts running, and Project Hosts must never gain automatic restart behavior.
- `packages/host` owns the `vibekit-host` daemon, Project loading, Interfaces, conversations, State access, local IPC, and runtime authority. `packages/pi` is the embedded Pi adapter for isolated worker Runs and does not own Project State.
- `packages/core` owns schemas, typed IDs, validation, registry composition, file targets, install/update/remove, and repository State. Keep it independent of Interface implementations.
- `packages/interface-sdk` defines the Host/Interface contract. `packages/interface-terminal` is the default first-run Interface; HTTP, webhook, schedule, Slack, and Telegram adapters are separate optional packages. Interfaces translate I/O and do not own Project State, permissions, or Agent definitions.
- `packages/schedule-core` and `packages/tool-scheduler` provide scheduling primitives. `packages/tool-*`, `packages/state-memory`, and `packages/verifier-schema` provide optional Tool, State, and Verifier implementations.
- `registry/` is the official curated registry source, `schemas/` is the schema source of truth, `fixtures/` contains valid and invalid contract documents, and `tests/` contains schema, registry, CLI, composition, permissions, State, runtime, Host, Interface, Tool, and end-to-end coverage.
- Project-owned files live primarily in `.vibekit/project.yaml`, `.vibekit/installed.json`, `.vibekit/agents/`, `.vibekit/components/`, `.vibekit/config/`, `.vibekit/state/`, and `.pi/`. `.vibekit/runtime/` is local runtime data and must stay gitignored.

The official registry is the default catalog. Local/custom registries are supported with `--registry` and are recorded as `registrySource` `official` or `local:<abs-path>`. Do not add hosted registries, search/discovery, ratings, a marketplace, a graphical builder, `orchestrator` or `subagent` types, `Blocks`, or additional messaging platforms without an explicit design change.

## Code Style

- Match the existing TypeScript ESM style, use explicit types on exported APIs, use `readonly` for immutable inputs, and avoid drive-by refactors.
- Comments should explain non-obvious constraints. Use `VibeKitError` with a category and stable code for user-facing domain errors, and never include secret values in error messages.
- Put schema, ID, file-target, permission, lifecycle, and registry contracts under `tests/` with fixtures where appropriate. A CLI flag or command change also updates the relevant CLI tests and `docs/cli/commands.md`.

## Safety and Data Rules

- Project YAML/JSON, State, Events, logs, fixtures, and examples contain secret references or secret names only. The CLI/Host may persist prompted deployment secret values only in `~/.config/vibekit/<project>/env` with mode `0600`; do not add another secret persistence path or log those values. `~/.config/vibekit/projects.json` and Gateway token/config files are owner-only metadata, not secret stores.
- File targets are project-relative. Reject `..`, absolute paths, null bytes, home expansion, URL schemes, and any path that escapes the Project or worker worktree.
- Enforce permissions at the runtime tool/adapter boundary using `Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ current authorization`; prompts and instructions cannot grant authority. Untrusted Interface, web, issue, or tool content cannot elevate permissions.
- Install, update, and remove are transactional. Preserve local edits, stop on three-way conflicts, and do not add a `--force` overwrite path. Generated configuration is rebuilt from owned fragments and is not three-way merged as user-owned content.
- Do not hand-edit `registry/index.json`; regenerate it with `pnpm registry:index` and commit the resulting index with registry changes. `packages/core/schemas/` and `packages/cli/registry/` are publish staging copies, not development sources.
- Refresh `packages/cli/registry/` with `node scripts/prepare-publish.mjs cli` after registry changes and `packages/core/schemas/` with `node scripts/prepare-publish.mjs core` after schema changes before testing the linked CLI.

## Scope Boundaries

Keep changes focused on the current request. The official registry, existing Interfaces, and Pi embedding are the supported extension points; do not fork Pi, introduce a parallel taxonomy or workflow DSL, or expand the messaging surface without an explicit request.
