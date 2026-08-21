# Contributing Guide

This guide covers the source checkout, focused checks, registry authoring, and local product validation. It is for contributors and maintainers; ordinary users should start with the [Quickstart](../getting-started/quickstart.md). The contribution contract and invariants live in the root [CONTRIBUTING.md](../../CONTRIBUTING.md). Official Agents and Components have their own [Module Authoring guide](module-authoring.md).

## 1. Prerequisites

- **Node.js** `>=20`
- **pnpm** `11.18.0` (pinned as packageManager in the root package.json)
- **Git**

## 2. Workspace setup

~~~bash
git clone https://github.com/UseAgentsIO/vibekit.git
cd vibekit
pnpm install
~~~

The published product boundary is one package, `@useagentsio/vibekit`, with the `vibekit` binary. The source checkout keeps the implementation areas together under the product CLI source tree while the consolidation is completed:

~~~text
packages/cli/src/
├── internal/core/         # schemas, IDs, registry, install/update/remove, State
├── internal/host/         # Host lifecycle, connections, conversations, IPC
├── internal/pi/           # embedded Pi adapter and Worker Runs
├── internal/interfaces/   # connection implementations and contract
├── internal/tools/        # built-in abilities
├── internal/state/        # memory and State adapters
└── internal/verifiers/    # verification implementations
~~~

The source of truth remains separate from generated Project data:

- registry/ — official catalog source; registry/index.json is generated
- schemas/ — JSON Schema source of truth
- fixtures/ — valid and invalid contract documents
- tests/ — schema, registry, CLI, composition, permissions, State, runtime, Host, connection, and end-to-end checks
- docs/ — product, architecture, catalog, patterns, specification, and contributor guidance

Do not create a Project-local VibeKit dependency tree to test a source change. The product runtime is installed once per machine; generated Projects should contain only independently distributed third-party dependencies when they actually need them.

## 3. Source development loop

Run the one-off CLI source entrypoint without publishing:

~~~bash
pnpm exec tsx packages/cli/src/index.ts --help
~~~

Run the consolidated Host directly when you need to inspect a Project process:

~~~bash
pnpm exec tsx packages/cli/src/internal/host/main.ts /path/to/project
~~~

Keep the TypeScript project references rebuilding while working on runtime code:

~~~bash
pnpm exec tsc -b --watch --preserveWatchOutput
~~~

Use the linked vibekit command in another terminal. A CLI-only change is loaded by the next command. Restart the relevant runtime after long-running code changes:

~~~bash
# After Host, Pi, Tool, or connection changes
vibekit stop
vibekit start

# After Gateway or dashboard changes
vibekit gateway restart
~~~

The temporary source-link path in the current checkout is:

~~~bash
(cd packages/cli && npm link)
hash -r
command -v vibekit
~~~

This link is a development convenience, not a published release and not evidence that `@useagentsio/vibekit` is live on npm. Do not run npm publish, npm unpublish, or a package-version synchronization command during ordinary development.

## 4. Checks

Run the smallest relevant check first, then the full checks before handing off a change:

~~~bash
pnpm test tests/cli       # Replace with the affected test area
pnpm typecheck

pnpm test                 # Full suite
pnpm typecheck
~~~

After registry Module changes, validate the source registry and regenerate its index through the supported command:

~~~bash
pnpm registry:index
pnpm test tests/registry
~~~

Never hand-edit registry/index.json. The root registry/ and schemas/ directories are development sources. Any package staging copy that remains during the transition is generated and must be refreshed by the package owner, not edited as a source.

## 5. Local product tarball

The consolidated package is local-only until a maintainer completes the release decision and explicitly authorizes npm publication. The final clean-machine proof must install the packed artifact into a temporary prefix and temporary home, then exercise the documented product path without inheriting an existing global VibeKit command.

The intended sequence is:

~~~bash
pnpm pack:product
node scripts/release-smoke.mjs /absolute/path/to/the/printed/@useagentsio-vibekit-tarball.tgz
~~~

The package owner still needs to provide the final tarball command and output contract after the one-product packer is complete. Until that handoff, the clean-home bullet is **pending** and must not be described as passed. Do not substitute an npm install, a linked workspace, an existing global command, or a source-only tsx run for this proof.

When the owner supplies the final artifact path, execute every documented sequence verbatim in a clean temporary home: install the tarball globally into a temporary prefix, verify vibekit --version, create the default Project, confirm no Project-local node_modules or lockfile is created, run the first documented message path, and confirm the bundled registry, schemas, Host, connections, abilities, and memory resolve from the product artifact.

## 6. Registry and Module authoring

The official registry is curated, not a marketplace. Use a local/custom registry path with --registry <path> when testing independently authored Modules. Keep canonical identity in the Module ID (tool:browser, interface:telegram), preserve immutable versions, and keep file ownership transactional.

For the full schema, identifier grammar, runtime metadata, internal vibekit:* runtime identifiers, external npm-backed Components, file targets, permission rules, and checklist, read [Module Authoring](module-authoring.md).

## 7. Code standards

- **TypeScript, ESM.** Match neighboring files, use explicit types on exported APIs, use readonly for immutable inputs, and avoid drive-by refactors.
- **Comments** explain non-obvious constraints, not what the next line does.
- **Errors** use VibeKitError with a category and stable code. Never stringify secrets into messages.
- **Contracts get tests.** Schema, ID, file-target, permission, lifecycle, State, and registry rules belong in focused tests and fixtures.
- **Runtime boundaries stay clear.** The Core source stays independent of connection implementations. Pi prepares isolated Runs and does not own Project State. The Host loads Projects, connections, conversations, and State.
- **Connections are adapters.** They translate I/O and do not create a second State store or own Agent definitions.

## 8. Tests and documentation that usually need an update

| Change | Also update |
| :--- | :--- |
| New official Module | tests/registry/official.test.ts, pnpm registry:index, catalog docs |
| Schema field | schemas/, valid/invalid fixtures, schema tests |
| CLI command or flag | CLI tests and docs/cli/commands.md |
| Host or connection behavior | Host/connection tests and the relevant advanced API reference |
| Permission or file-target rule | Core/composition tests and the Module Authoring guide |
| Product user journey | README, getting-started docs, and the clean tarball proof once the artifact exists |

Product claims must match running behavior. Secrets in examples are names and placeholders only, never live values. Patterns stay in docs/patterns/; they are documentation, not a workflow engine.

Normative runtime documents, in order of authority, are:

1. [V1 Runtime Correction](../spec/V1-Runtime-Correction.md)
2. [V1 Implementation Specification](../spec/V1-Implementation-Specification.md)
3. [PRD](../PRD.md)

## 9. Pull requests

1. Branch from main with a focused name.
2. Keep the diff to the stated concern.
3. Run pnpm typecheck and the relevant tests, then the full suite before opening a PR.
4. Describe what changed, how you verified it, and any remaining risk.
5. Target main.

Use this compact PR description:

~~~text
## Intent
<one or two sentences>

## Changes
- …

## Verification
- pnpm typecheck
- pnpm test
- <extra checks, e.g. pnpm registry:index, pnpm test tests/registry>

## Invariants
No marketplace / orchestrator / secret values / unsafe file targets.
~~~

## 10. Safety reminder

Never commit API keys, tokens, or session cookies. Worker environments receive only the secret names a Module declared. Path grants, Policies, and authorization gates are enforced in Host/Pi code, not in instructions.md. Install, update, and remove must preserve local edits, stop on conflicts, and never add a force overwrite path.
