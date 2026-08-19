# VibeKit runtime and libraries

The running product is the Agent Host (`@useagentsio/host`, binary `vibekit-host`). Users talk to a Project with `vibekit create`, `vibekit msg`, and `vibekit start`. Pi is embedded inside the Host. Do not launch the Pi TUI and do not treat `init` / `add` / `doctor` as the finished product.

Taxonomy: Components → Agents → Project → Host. Canonical identity is the registry Module ID (`tool:browser`, `interface:telegram`). npm packages are optional `runtime.package` / `runtime.export` implementation artifacts.

`vibekit-host` loads `kind: interface` Modules by importing `runtime.package` and calling `runtime.export`. `factories` on `VibeKitHost.start` are a testing seam; production loads Interfaces from installed Module runtime metadata. Terminal (`interface:terminal` → `@useagentsio/interface-terminal` / `createTerminalInterface`) is the default first-run Interface. Slack and Telegram are optional shipped Interfaces (`interface:slack`, `interface:telegram`). A running Host listens on `.vibekit/runtime/host.sock`; `vibekit msg` must reuse that socket instead of starting a second process. The terminal Interface collects Approval decisions (`y` / `n`) and forwards them through `InterfaceServices.approve`.

The official registry is the default curated catalog. Independently authored Modules can be installed from a local/custom registry path (`--registry`, recorded as `registrySource` `official` | `local:<abs-path>`). Hosted registries, search/discovery, ratings, and a marketplace are not implemented.

`tool:github` 1.1.0 is executable (`pi-extension`, `@useagentsio/tool-github`). 1.0.0 remains config-only.

Permissions are enforced at the runtime boundary (Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ authorization). Policies are runtime governance, not prompt text.

Use `@useagentsio/core` for schemas, IDs, Project State, installation contracts, verification, and proposal/apply decisions. Use `@useagentsio/pi` as the embedded adapter that resolves a Project and Agent into an isolated worker Run. Use `@useagentsio/interface-sdk` when attaching an Interface. The Host persists conversations and State; the adapter does not.

Install the libraries with:

```bash
npm install @useagentsio/core @useagentsio/pi @useagentsio/host @useagentsio/interface-sdk
```

## Validate documents

Validate untrusted YAML or JSON before using it:

```ts
import { parseAndValidateYaml } from "@useagentsio/core";

const parsed = parseAndValidateYaml("agent", yamlText);
if (!parsed.valid) {
  throw new Error(JSON.stringify(parsed.errors));
}
const agent = parsed.data;
```

Use `validateDocument` for parsed values and the typed ID helpers for Module, Project, and runtime IDs. Do not construct invalid uppercase, spaced, or untyped identifiers and do not accept schema versions other than the current supported integer.

## Work with repository State

Open State from a resolved Project:

```ts
import { createRepositoryState, readProjectDocument } from "@useagentsio/core";

const project = readProjectDocument(projectRoot);
const state = createRepositoryState({ projectRoot, project });
const created = state.tasks.create(task);
```

Use the store's expected revision or expected hash on updates. Let lifecycle validation reject stale writes and invalid transitions. Treat Events as append-only and never place secret values or private chain-of-thought in them.

## Run one Agent

Pass a schema-valid Task and an installed Project binding:

```ts
import { runManaged } from "@useagentsio/pi";

const outcome = await runManaged({
  projectRoot,
  bindingName: "coder",
  task,
  signal,
});
```

Use `runIsolated` when the caller will manage persistence, claims, concurrency, and idempotency itself. Use `prepareIsolatedRun` to inspect the resolved Project, Agent, Task, effective configuration, bounded context, filtered environment, and Run ID without starting Pi. Inject `createSession` in unit tests. The Host omits it and embeds the default Pi coding-agent session. Mocked sessions are a test seam, not a product mode.

The adapter returns Events and a Result. `runIsolated` does not persist them. The Host persists State and owns persistent conversation sessions. `runManaged` can use repository State, claims, concurrency, idempotency, worktree isolation, and process isolation around a worker Run.

## Shape the Task correctly

Provide the Task's objective, constraints, acceptance criteria, required capabilities, assigned Agent, path/resource scope, delivery mode, authorization state, status, revision, and timestamps. Match `projectId` to the Project and `assignedAgent` to the selected binding's definition.

Use `delivery.mode: proposal` to produce a verified candidate without applying the consequential mutation. Use `delivery.mode: apply` only when current authorization permits the exact action. Do not add redundant approval when standing authorization already covers the bounded action; require a scoped Approval when Project Policy says `explicit`.

## Delegate through the adapter

Expose `agent_delegate` only when the parent has the `agent.delegate` capability and both Agent and Project contracts allow the target. Use `executeDelegation` or the registered delegation tool so VibeKit validates the target, Task, graph, depth, child count, scope, and bounded context before starting the child.

Do not forward the whole parent conversation or environment. Pass the child objective, necessary context, constraints, acceptance criteria, expected output, relevant Decisions, allowed State, authorized tools, and only required secret references.

## Verify and apply separately

Use command verification and independent review against the exact candidate revision. A producing Agent cannot independently review its own result. Build a proposal from the Result and Verifications, then call an apply path only when delivery mode, verification, Policy, and authorization all allow it.

Interpret the records precisely:

- A completed Run means execution ended successfully.
- A Result means the Agent returned its output contract.
- Passed Verifications mean the exact candidate met their contracts.
- Acceptance means an authority accepted the proposed transition.
- Application means the authorized mutation actually happened.

Report each state separately.

## Handle termination

Pass an `AbortSignal` for cancellation. Preserve timeout, cancellation, child propagation, session disposal, temporary worktree/process cleanup, claim release, and final Events. Treat required cleanup failure as Run failure rather than claiming completion.
