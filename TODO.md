# Product simplification and package consolidation

This is the remaining acceptance bar for making VibeKit install and feel like one product while preserving its runtime safety and Project isolation.

Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[>]` deferred

---

## P0 — Clean-machine product path (release-blocking)

- [x] Ship one canonical installation path that leaves a durable `vibekit` command on `PATH`
- [x] Run the published quickstart in a clean temporary home with no pre-existing global VibeKit installation
- [x] Make the released CLI resolve its bundled official registry, schemas, built-in Interfaces, and runtime implementations
- [x] Prevent source builds from scaffolding unpublished package versions; use local workspace artifacts during development and published versions only at a verified release boundary
- [x] Release the runtime, official registry, schemas, and built-in implementations as one atomic versioned artifact
- [x] Do not print `Created` or return success until the Project loads, required capabilities resolve, the default Interface loads, and the next documented command is executable
- [x] Verify the exact README commands verbatim against packed or published artifacts before release
- [x] Add a release smoke test that creates the default Project and proves one controlled provider response
- [x] Make failures identify the broken artifact or dependency and provide one exact repair action

## P0 — Actual Pi app interoperability: invalid registry-owned extensions

Verified defect: installing `tool:execution@1.0.0` or `tool:filesystem@1.0.0` copies a non-extension TypeScript stub into Pi's project extension discovery path. Running the actual Pi app from an affected Project discovers those files and exits before the TUI starts.

Evidence and root cause:

- `registry/components/tool/execution/1.0.0/module.yaml` maps `payload/index.ts` to `.pi/extensions/execution/index.ts`
- `registry/components/tool/filesystem/1.0.0/module.yaml` maps `payload/index.ts` to `.pi/extensions/filesystem/index.ts`
- The copied payloads export only named metadata constants, `executionTool` and `filesystemTool`
- Pi extensions must default-export a factory function receiving `ExtensionAPI`
- Pi 0.84.2's loader imports the default export, rejects non-functions with `Extension does not export a valid factory function`, records a fatal extension diagnostic, and exits with status 1
- Directly loading the two current Project files with Pi 0.84.2 returns two invalid-factory errors and zero loaded extensions
- This Project's `.vibekit/installed.json` records both Modules at version `1.0.0`, installed on 2026-08-20, and records the two `.pi/extensions/.../index.ts` files as exclusively owned
- Both Modules already declare `runtime.kind: pi-builtin`; execution uses Pi's built-in `bash`, while filesystem uses Pi's built-in `read`, `grep`, `find`, `ls`, `write`, and `edit`
- The payload stubs therefore provide no runtime behavior and should not be Pi extensions
- This is a VibeKit registry defect scoped to Projects containing either Module, not a global Pi defect
- Do not attribute the defect's introduction to Pi 0.84.2: the published Pi 0.84.1 loader contains the same invalid-factory check and fatal startup diagnostic. A local upgrade may have exposed an existing bad Project file, but the compared loader behavior does not prove that 0.84.2 introduced it

Required resolution:

- [x] Remove `.pi/extensions/execution/index.ts` from the file ownership of the corrected `tool:execution` Module
- [x] Remove `.pi/extensions/filesystem/index.ts` from the file ownership of the corrected `tool:filesystem` Module
- [x] Delete the pointless registry payload stubs rather than converting them into no-op default-export factories
- [x] Keep both Modules as `runtime.kind: pi-builtin` capability and authorization declarations backed by Pi's real built-in tools
- [ ] Publish the corrected immutable Module versions; do not rewrite an already released immutable Module version in place
- [x] Make Module update remove unchanged exclusively owned obsolete extension files transactionally
- [x] Preserve the existing conflict behavior when a user modified either installed stub; report the exact obsolete path instead of force-deleting local edits
- [x] Add a targeted migration or Doctor finding for affected Projects that still contain either registry-owned stub
- [x] Make `vibekit doctor` identify the owning Module, invalid extension path, installed version, and corrected update or cleanup action
- [x] Add a registry invariant: a `runtime.kind: pi-builtin` Module must not install a file under `.pi/extensions/` unless that file is a real default-exported Pi extension factory with required runtime behavior
- [x] Add a test that loads every registry-owned `.pi/extensions/` entry through the installed Pi extension loader and requires zero load errors
- [x] Add an upgrade test that installs the affected `1.0.0` Module, updates to the corrected version, removes the unchanged obsolete file, and preserves a locally modified copy as a conflict
- [x] Add a generated-Project integration test proving Projects with filesystem and execution capabilities do not create these extension stubs
- [x] Run the actual Pi app from a corrected affected Project and verify startup reaches the TUI without an extension-load diagnostic
- [x] Verify Pi's built-in filesystem and `bash` tools remain available to the VibeKit Host only through effective-authority binding after the stubs are removed
- [x] Verify `vibekit msg`, persistent Host turns, and isolated worker Runs still enforce the same filesystem and execution scopes after the cleanup

Acceptance criteria:

- Actual Pi starts successfully from a Project containing VibeKit filesystem and execution Components
- `.pi/extensions/execution/index.ts` and `.pi/extensions/filesystem/index.ts` are absent unless independently user-authored
- Pi reports zero extension loading errors for registry-owned Project files
- VibeKit continues using Pi's built-in tools for these Components with no loss of runtime authorization enforcement
- Existing Projects receive a safe update or an actionable conflict without silent deletion of local edits

## P0 — Useful default composition

- [x] Stop creating a Project containing only `agent:chief` when no worker Agents are installed
- [x] Make one capable general-purpose Agent the default first-run experience
- [x] If Chief remains an offered preset, install the worker Agents required by its delegation contract
- [x] Give the default Agent scoped filesystem read/write, command execution, web search, and persistent memory capabilities
- [x] Resolve the default Agent's capabilities through the existing Agent recipe and capability planner
- [x] Do not introduce a new `bundle:*` Module type; Agent recipes are the presets
- [x] Install and configure persistent memory by default while keeping canonical Project State separate
- [x] Ship one built-in default Interface that requires no Project-local runtime package installation
- [x] Prove the default composition can complete a useful task rather than merely produce a model response
- [x] Provide optional complete presets such as general assistant, coding project, and Chief-led team without exposing their internal Module assembly during setup

## P1 — Consolidate 20 packages into one product package

- [ ] Publish one product package containing the `vibekit` binary, Core, Host, Pi adapter, official registry, schemas, built-in Interfaces, Tools, State, scheduling, and verification
- [x] Choose the final package name and migration boundary; prefer one scoped product package rather than another family of packages
- [x] Fold `@useagentsio/cli` into the product package
- [x] Fold `@useagentsio/core` into the product package
- [x] Fold `@useagentsio/host` into the product package
- [x] Fold `@useagentsio/pi` into the product package
- [x] Fold `@useagentsio/interface-sdk` into the product package unless an external consumer proves a separately versioned SDK is needed
- [x] Fold all first-party `interface-*` packages into internal source modules
- [x] Fold `schedule-core` into the product package
- [x] Fold `state-memory` into the product package
- [x] Fold all first-party `tool-*` packages into internal source modules
- [x] Fold `verifier-schema` into the product package
- [x] Preserve clear internal source ownership with directories such as `core`, `host`, `pi`, `interfaces`, `tools`, `state`, and `verifiers` without separate npm manifests
- [x] Resolve built-in registry implementations through internal runtime identifiers instead of npm package names
- [x] Reserve npm-backed runtime packages for independently distributed third-party Components
- [x] Remove VibeKit runtime dependencies from ordinary generated Project `package.json` files
- [x] Do not create `package.json`, lockfiles, or `node_modules` for a Project unless it explicitly contains custom JavaScript or TypeScript dependencies
- [x] Install the VibeKit runtime once per user rather than once per Project
- [x] Replace multi-package version synchronization and dependency-order publishing with one artifact version and one publish operation
- [x] Provide temporary deprecated compatibility packages only if existing consumers require a migration window
- [x] Stop publishing compatibility packages after the documented migration window
- [x] Inventory every currently published legacy `@useagentsio/*` package and version before changing npm state
- [x] Prepare the exact npm cleanup sequence without publishing, unpublishing, deprecating, or changing versions before owner authentication and approval
- [ ] After local validation and explicit owner approval, unpublish legacy packages where npm permits it and deprecate any package/version that npm will not allow to be unpublished, pointing users to `@useagentsio/vibekit`
- [x] Verify the final local tarball, clean-machine install, migration path, and full test suite before any npm publish or cleanup write
- [x] Extract `@useagentsio/sdk` later only when a real external Component author needs independent contracts and versioning

## P1 — One product entry point

- [x] Make bare `vibekit` the primary product command
- [x] On first launch, run setup automatically
- [x] After setup, open the interactive Terminal Interface or the configured primary Interface
- [x] Ask only for model authentication during the default setup path
- [x] Choose the default Agent, capabilities, memory, Interface, State, policies, and runtime settings automatically
- [x] Offer one explicit `Customize setup` branch for advanced choices
- [x] End setup inside a working conversation instead of printing a sequence of additional commands
- [x] Make `vibekit setup` rerunnable, idempotent, and preserving of existing user choices
- [x] Keep explicit Project creation under an advanced builder command such as `vibekit project create`
- [x] Keep `vibekit msg` as a scripting and automation command rather than the primary interactive experience
- [x] Ensure every first-run path performs the same final readiness and conversation proof

## P1 — Hide runtime topology

- [x] Remove Host, Gateway, IPC, short-lived Host, and daemon topology from first-run decisions and copy
- [x] Start and manage the default Host automatically
- [x] Keep the Host alive automatically when an enabled Interface requires persistence
- [x] Ensure opening the dashboard or enabling a remote Interface starts or installs the Gateway as needed
- [x] Keep Project Hosts isolated internally while presenting one product-level lifecycle
- [x] Ask only whether VibeKit should remain available after login when persistent operation is needed
- [x] Hide LaunchAgent, systemd, and Task Scheduler details outside diagnostics and advanced documentation
- [x] Make `vibekit status` summarize installation, Project, model authentication, Host, Gateway, Interfaces, and Doctor findings in user language
- [x] Make `vibekit stop` stop the relevant user-visible runtime without deleting Projects, State, sessions, or secrets
- [x] Retain advanced per-Project and per-service controls for operators without putting them in the primary flow

## P1 — Minimal configuration and clear ownership

- [x] Provide one supported configuration facade through `vibekit config`, setup, and the dashboard
- [x] Write only user choices and explicit overrides into Project configuration
- [x] Move untouched concurrency, timeout, State tracking, authorization, isolation, trust-source, and verification defaults into runtime normalization
- [x] Make a minimal Project valid without materializing every effective runtime field
- [x] Add an effective-config inspection command for advanced debugging
- [x] Clearly separate user-authored definitions from generated manifests, bindings, caches, and normalized runtime files
- [x] Keep secrets separate from ordinary Project configuration
- [x] Make setup manage the approved per-Project deployment secret store so manual environment exports are optional
- [x] Add one secret-management command that shows required secret names and configured status without revealing values
- [x] Support setting, rotating, and removing deployment secrets through that command
- [x] Promote the existing Agent `instructions.md` as the obvious persona, tone, boundary, and behavior surface
- [x] Expose Agent instruction editing through the dashboard or one clear CLI action
- [x] Keep sessions, locks, logs, pairing requests, process metadata, and caches out of version control by default
- [x] Keep only deliberately portable Agent definitions and selected durable State in Project repositories
- [x] Do not add a second simplified configuration format; simplify the existing model with defaults and a facade

## P1 — Make extensions optional to understand

- [x] Hide Provider, Tool, Skill, Interface, State, Policy, Verifier, and Agent taxonomy from normal setup
- [x] Present ordinary choices as model, abilities, instructions, memory, and connections
- [x] Let users choose actions such as `Enable web search` or `Connect Telegram` while resolving Modules internally
- [x] Keep `add`, `diff`, `update`, and `remove` as advanced Component and customized-Project commands
- [x] Show human display names before Module IDs in ordinary output
- [x] Show exact Module IDs only in verbose, authoring, or diagnostic output
- [x] Use the bundled official registry automatically without exposing registry-source selection during normal use
- [x] Keep `--registry` for local Component development and advanced deployments
- [x] Do not add hosted registry discovery, ratings, or a marketplace to solve onboarding
- [x] Keep transactional ownership, integrity checks, and three-way Component updates under the simplified surface

## P1 — Powerful but bounded defaults

- [x] Ask which workspace folder the Agent may use instead of asking users to design a Project architecture
- [x] Derive path grants, Task scope, and mutation isolation from the selected workspace and preset
- [x] Allow ordinary reads and reversible work inside the selected workspace without repeated ceremony
- [x] Keep destructive deletion, deployments, outbound messages, purchases, and irreversible configuration changes explicitly authorized
- [x] Make permission denials explain the blocked action, reason, and exact setting or approval needed in user language
- [x] Make approval prompts show the exact action, target, and consequence before the user decides
- [x] Keep the effective-authority intersection enforced at the runtime boundary rather than relying on prompts
- [x] Tune the curated single-user default for useful autonomy without weakening multi-user or untrusted-interface boundaries

## P2 — Channels and pairing

- [x] Add one guided connection flow such as `vibekit connect telegram`
- [x] Prompt for the channel token, configure the Interface, ensure persistent runtime availability, and wait for the first message in one flow
- [x] Keep unknown-sender pairing and expiring approval codes
- [x] Show pending pairing requests in the primary Interface or dashboard with an explicit Approve action
- [x] Keep `vibekit approve-pairing` for terminal and automation use
- [x] Guide the first verified sender into the visible owner identity during setup
- [x] Ship built-in channel implementations with the product runtime but load and configure only enabled channels
- [x] Do not remove pairing or sender authorization in the name of competitor parity

## P2 — Diagnostics and safe repair

- [x] Add `vibekit doctor --fix` for safe mechanical repairs
- [x] Allow safe repair of generated directories, owner-only file modes, generated indexes, stale locks, and derived configuration
- [x] Never auto-fix permissions, local edits, model selection, security policy, or user State without explicit approval
- [x] Add a redacted minimal provider-connection probe
- [x] Distinguish missing credentials, provider rejection, network failure, and model unavailability
- [x] Verify that the installed runtime, bundled registry, schemas, and built-in exports belong to the same release
- [x] Resolve and load every enabled Interface during Doctor checks
- [x] Validate every enabled Interface's required secrets and local startup
- [x] End every non-fixable finding with one recommended repair action
- [x] Preserve a redacted disk-backed diagnostic report containing versions, checked paths, and results
- [x] Keep consequential repair explicit and fail closed when a safe repair is unavailable

## P2 — Documentation and language

- [x] Replace the current quickstart with only the canonical installation, bare `vibekit`, and the first successful conversation
- [x] Put useful examples and next actions after quickstart instead of an architecture diagram
- [x] Move Component schemas, Module IDs, registry ownership, package runtime exports, and process topology into authoring or advanced guides
- [x] Describe user-visible behavior before implementation machinery
- [x] Use one visually dominant product installation method
- [x] Keep source checkout, pnpm workspace, linking, publish staging, and registry-generation instructions in contributor documentation
- [ ] Execute every documented command sequence verbatim in a clean environment
- [x] Keep architecture documentation available without making it prerequisite reading for normal use
- [x] Use `assistant`, `model`, `abilities`, `memory`, and `connections` in ordinary product copy while retaining exact internal terminology in technical references

---

## Guardrails — keep, do not undo

- Generic source-aware runtime loading and fail-closed missing sources
- Capability, Policy, Agent grant, Task scope, and current authorization intersection at the runtime boundary
- Transactional Component install, update, and removal with local-edit preservation
- Project isolation for State, conversations, sessions, secrets, and processes
- Worktree isolation for mutating worker Runs
- Explicit approval for destructive and external effects
- Canonical repository State remaining distinct from optional memory
- Completion, verification, acceptance, and apply remaining separate states
- Official bundled registry plus explicit local/custom registry support
- Agent multi-select and complete Chief-led team compositions
- Interface sender pairing and untrusted-inbound enforcement

## Guardrails — do not build as simplification substitutes

- No new `bundle:*` Module type
- No parallel simplified configuration format
- No replacement persona format when `instructions.md` already exists
- No removal of pairing, authorization, worktree isolation, or transactional ownership
- No hosted marketplace, ratings, or registry discovery
- No Core, Host, or Pi rewrite before package consolidation, release correctness, defaults, and the product entry point are fixed
- No copying OpenClaw or Hermes internals; copy their abstraction boundary and first-run ownership
