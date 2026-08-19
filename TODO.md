# Architecture realignment — remaining blockers

Provenance, generic Host loading, scheduler split, and catalog discovery **stay**. This list is the acceptance bar that is still open.

Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[>]` deferred

---

## P0 — Effective authority (release-blocking)

Owner: main

- [x] One `resolveEffectiveAuthority` used by persistent Host turns **and** Worker `prepareIsolatedRun`
- [x] Intersection: Agent requested ∩ Project binding ∩ installed provider actually provides ∩ Agent allow/deny+scope ∩ Task scope ∩ Policy ∩ authorization/Approval
- [x] Bind **only** those Tool modules; wrap `execute()` at Host so plugin code cannot be the security boundary
- [x] Pi builtins (`read`/`bash`/…) only when the effective provider is the corresponding installed Component (`tool:filesystem`, `tool:execution`, …)
- [x] Tests A–E (custom tool no binding; agent deny; task scope; explicit no Approval; Policy reduces grant)

## P0 — Runtime Policy participation

- [x] `policy:least-privilege` — missing grant is deny
- [x] `policy:schedule-no-recurse` — scheduled Runs cannot get schedule.write / scheduler tool
- [x] `policy:memory-write-approval` — memory.write requires Approval
- [x] `policy:untrusted-inbound` — inbound cannot expand grants (enforced by never expanding from message)
- [x] `policy:interface-pairing` — consulted as a runtime pairing requirement
- [x] `policy:require-verification` remains a verification gate (already exists)
- [x] Stop claiming runtime enforcement for policies that are not consulted

## P0 — `packages.dependencies` on install

- [x] `LoadedModule` keeps `packages`
- [x] `planInstall` / `applyInstall` merge declared npm deps into Project `package.json`
- [x] Implementation is loadable after `vibekit add` (file: / copy / package manager) without a second manual npm step
- [x] Test H: third-party package-backed Tool/Interface added → Host loads it

## P0 — Auxiliary State vs canonical Project State

- [x] Installing `state:*` other than `state:repository` MUST NOT set `project.state.backend`
- [x] `state:repository` remains canonical Project truth
- [x] `state:memory` / `tool:memory` bind only when installed **and** effectively granted

## P0 — Headquarters as a real fixture

- [x] Fix `registrySource: "project-local"`
- [x] Fix scheduler payload to `@useagentsio/tool-scheduler`
- [x] Fix invalid capabilityBindings (`agent.delegate`, `schedule.manage`)
- [x] Align `package.json` with runtime packages
- [x] Checked-in tree and `create --example headquarters` are one design
- [x] Tests copy the checked-in Project: schema + doctor + bindings + Host smoke (test J)

## P0 — Normative docs current truth

- [x] `docs/spec/V1-Runtime-Correction.md` updated or superseded
- [x] `CONTRIBUTING.md`, `AGENTS.md`, `docs/api/host.md`, `skills/vibekit/references/runtime.md`

Current truth: official registry is default curated; local/custom registries supported; no marketplace; Slack/Telegram are shipped if in this repo; registry IDs are identity.

---

## P1

- [x] `setupItemsFromRegistry`: registry available → identity set 100% from registry (no phantom official IDs). Test F
- [x] `deriveDelegation` from selected Agent contracts ∩ selected bindings. Test G
- [x] Interface binding config obeys Module configuration schema; no invalid CLI YAML; no `iface === "telegram"` special case in generic plumbing
- [x] doctor: capability provider installed + provides capability; Interface installed/executable; config schema; runtime package resolvable; integrityChecksum matches
- [x] `resolveInstalledModule` / Host bind fail if recorded integrityChecksum ≠ resolved Module directory checksum. Test I

---

## Verification

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] registry index check
- [x] doctor on every maintained example

---

## Keep (do not undo)

Generic source-aware runtime loader; no production Interface factories; `official` vs `local:<path>`; fail-closed missing local source; `schedule-core` / `interface-schedule` / `tool-scheduler`; no global Skills/Tools bag; Agent multi-select; completion ≠ verification ≠ acceptance ≠ apply.
