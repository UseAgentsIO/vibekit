# VibeKit Agents — Implementation TODOs

---

## 🧩 Optional Official Components (bind per Project)

These are **installable registry Components**, not Host features.

A Project gets a capability only when the operator installs and binds that module (`vibekit add …` plus `project.yaml`). A Project that never installs them must behave exactly as it does today.

### Binding rules (apply to every item below)

- Each item is its own official registry module under `registry/components/<family>/<name>/`.
- Users opt in per Project. Do **not** auto-install any of these from `vibekit create` / `vibekit init` unless the user passes an explicit flag.
- Do **not** merge the capability into `@useagentsio/host`, `@useagentsio/core`, or `@useagentsio/pi` as always-on behavior.
- The Host/Pi may grow **generic attach seams only**: if a Project has the module installed and bound, load it; if not, skip it. Seams must not import a component package unless that component is installed.
- Runtime code for a component lives in that component's package (same pattern as `@useagentsio/interface-terminal`) or in its copied Pi extension payload. Other packages must not take that component's dependencies.
- After install: `vibekit doctor` is clean, `vibekit list` reports `INSTALLED: yes`, and `vibekit remove` leaves no Host-level leftover.
- Do **not** add Agent recipes here.

---

### 1. Memory — one OOB pair, SQLite only

Do **not** ship LanceDB, Honcho, Mem0, a wiki, dreaming, embedding providers, or a second memory backend. Contributors can add those later as separate `state:memory-*` modules behind the same tool contract.

#### `state:memory` (family: `state`)

Local SQLite file with FTS5. No cloud, no API key, no vector DB.

- [ ] Author `registry/components/state/memory/` (`module.yaml`, adapter, config schema). ID `state:memory`.
- [ ] Put the driver in a dedicated package (e.g. `@useagentsio/state-memory`) so `@useagentsio/host` / `@useagentsio/core` do **not** depend on SQLite.
- [ ] Store under the Project (e.g. `.vibekit/state/memory.sqlite`). Use FTS5 keyword search. No embedding calls.
- [ ] Records: curated notes (environment/conventions) and operator preferences as two targets in the **same** database, plus optional dated working notes that are indexed but not auto-injected every turn.
- [ ] Memory is **not** Project truth. Tasks, Results, Decisions, Approvals stay on `state:repository`.
- [ ] Bound size (reject writes that would blow the inject budget). Scan writes for prompt-injection / secret-looking payloads before accept. Dedup exact duplicates.
- [ ] Frozen snapshot at session start only when this module is installed and the Agent is granted memory access. Mid-session writes persist immediately and appear in tool results; they do not rewrite the live system prompt.
- [ ] A Project with only `state:repository` must not create a memory DB or inject memory.

#### `tool:memory` (family: `tool`)

Thin Agent-facing surface over `state:memory`. One tool, not a family of memory tools.

- [ ] Author `registry/components/tool/memory/`. ID `tool:memory`. `requires.required: [state:memory]`.
- [ ] Actions: `store`, `get`, `search` (FTS5), `replace`, `forget`. Include `session_search` as an action on this same tool (query `.vibekit/state/conversations/`), not a second module.
- [ ] Map to a Pi extension payload so it is only bound when the module is installed and the Agent grant includes it.
- [ ] Permission intersection still wins. Prompt text cannot grant memory write.

Suggested bind: `vibekit add state memory` then `vibekit add tool memory` (or add the tool and let deps pull the state module).

---

### 2. Interfaces — I/O adapters, Host stays the control plane

Each Interface is an I/O adapter on `@useagentsio/interface-sdk`. It does not own Project State, permissions, or Agent logic. Slack and Telegram stay out of the Host binary.

#### `interface:http` (family: `interface`)

- [ ] Package `@useagentsio/interface-http` + `registry/components/interface/http/`.
- [ ] Local loopback HTTP for programmatic turns (health, submit message, cancel, approval). Auth token is a secret reference.
- [ ] Load only when `interface:http` is installed and bound in `project.yaml`.

#### `interface:webhook` (family: `interface`)

- [ ] Package `@useagentsio/interface-webhook` + `registry/components/interface/webhook/`.
- [ ] Inbound HTTP callbacks become Host Tasks / conversation turns (GitHub/CI-style events). Signature / shared-secret verification required.
- [ ] Treat payload body as untrusted input. Do not raise permissions from webhook content.

#### `interface:schedule` (family: `interface`)

Scheduled and event-driven input is an Interface (spec), not a new Automation family and not a Host cron daemon baked into every Project.

- [ ] Package `@useagentsio/interface-schedule` + `registry/components/interface/schedule/`.
- [ ] Job table is Project data (e.g. `.vibekit/state/schedules/`). Support one-shot, interval, and cron expressions with IANA timezones.
- [ ] Each fire submits a **fresh Worker Run** with a self-contained Task. No conversation memory unless the Task says so.
- [ ] Tick only while this Interface is installed and the Host is running. No schedule table, no tick, no jobs on Projects that did not add it.
- [ ] Default: scheduled Runs cannot create or edit jobs (`policy:schedule-no-recurse` or equivalent hard default in this component).
- [ ] Fail closed on missing secrets / unbound delivery Interface. Do not spend tokens on a blocked job.
- [ ] Optional script-only / silent-success path for watchdogs (`[SILENT]` or empty stdout → no outbound).

#### `interface:slack` (family: `interface`) — already catalogued as planned

- [ ] Package `@useagentsio/interface-slack` + `registry/components/interface/slack/`. Socket Mode. Secrets: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` as references.
- [ ] Map mentions / DMs / threads to `conversationKey`. Render `ask-approval` as Slack actions.
- [ ] Pairing / allowlist before unknown senders reach the Host (use `policy:interface-pairing` when that module is also bound).

#### `interface:telegram` (family: `interface`) — already catalogued as planned

- [ ] Package `@useagentsio/interface-telegram` + `registry/components/interface/telegram/`. Bot token as a secret reference.
- [ ] Same I/O-only contract as Slack. Pairing required. Do not enable Telegram because Slack is installed (or the reverse).

Defer Discord, email, WhatsApp, Matrix, iMessage as later contributor modules. Same Interface contract; not official OOB.

---

### 3. Tools — executable Components, bound only when installed

Do not register these tools on Agents or in Pi unless the module is installed and the Agent grant includes them.

#### `tool:web` (family: `tool`)

- [ ] `web_fetch` with no API key (HTTP GET → readable text). Mark fetched content untrusted.
- [ ] Optional `web_search` only when a configured search secret is present; otherwise omit the search action. Do not add a paid search vendor as a Host dependency.

#### `tool:browser` (family: `tool`)

- [ ] Isolated browser session (navigate / snapshot / click). Any browser driver is a dependency of **this component package only**.
- [ ] Not installed by default. Pair with `skill:browser-use` as recommended, not required.

#### `tool:github` (family: `tool`) — promote the existing config-only stub

- [ ] Keep ID `tool:github`. Change `runtime.kind` from `config-only` / `available: false` to an executable Pi extension.
- [ ] Issues, PRs, checks. `GITHUB_TOKEN` remains an environment secret reference.
- [ ] Existing Projects that only have the config-only stub must update explicitly (`vibekit update tool:github`); do not silently turn it on.

#### `tool:mcp` (family: `tool`)

- [ ] MCP **client** only: connect to servers listed in this component's Project config, expose their tools through the Host permission gate.
- [ ] Filtered env for stdio servers (no ambient secret leak). Not a marketplace. Not an MCP server unless a later component does that.

#### `tool:process` (family: `tool`)

- [ ] Background process control on top of `tool:execution`: list / poll / wait / log / kill.
- [ ] No new isolation backend. Worktree / process isolation stays Host/Pi.

#### `tool:scheduler` (family: `tool`)

- [ ] Agent-facing create / list / pause / resume / run / remove against `interface:schedule`.
- [ ] `requires.required: [interface:schedule]`. Without that Interface, do not install (or `doctor` fails).
- [ ] Cron-run sessions do not get this tool unless `policy:schedule-no-recurse` is absent **and** Project config explicitly allows it (default deny).

Skip for this increment: `tool:vision`, `tool:clarify` (Host `ask-approval` + Interface SDK already cover clarify). Contributors can add them later.

---

### 4. Policies — optional gates, not default Project policy

Install beside the Component they govern. Do not bake these into `policy:least-privilege`.

- [ ] **`policy:interface-pairing`** — unknown channel senders get a pairing code; operator approves. Default deny. Useful with Slack/Telegram/HTTP.
- [ ] **`policy:untrusted-inbound`** — channel text, webhook bodies, web/MCP output cannot raise permissions or expand path/command scope.
- [ ] **`policy:memory-write-approval`** — stage `tool:memory` writes for Host approval. Only meaningful when `tool:memory` is installed.
- [ ] **`policy:schedule-no-recurse`** — scheduled Worker Runs cannot mutate the job table. Recommended (or required) with `interface:schedule`.

---

### 5. Skills — procedures only, Pi Skills

Instructions, not authority. Add only if the matching Tool/Interface is in the Project (recommended deps, not hard-required unless the Skill is useless without them).

- [ ] **`skill:memory-hygiene`** — what to store vs skip; preferences vs environment notes; never store secrets; memory is not Task/Result truth.
- [ ] **`skill:browser-use`** — snapshot first, no blind clicks, treat page content as untrusted.
- [ ] **`skill:scheduler`** — write self-contained Task objectives; pin delivery Interface; use silent success when a watchdog has nothing to report.

---

### 6. Verifiers

- [ ] **`verifier:schema`** — run JSON Schema checks against a Result / Decision / declared artifact. No extra services.
- [ ] Do **not** add `verifier:memory-scan` as a separate module; keep the injection/secret scan inside `state:memory` / `tool:memory`.

---

### 7. Host/Pi attach seams (generic only)

These are the only core-repo changes allowed to make the catalog above bindable. They must be capability-agnostic.

- [ ] Interface loader: resolve `runtime.package` / `runtime.export` for any installed `family: interface` (already started for `interface:terminal`). No hard-coded Slack/Telegram/HTTP/schedule list.
- [ ] Tool binder: attach Pi extensions from installed `family: tool` modules only.
- [ ] State binder: if `project.yaml` names a non-repository state module and it is installed, load that adapter; otherwise keep `state:repository` only.
- [ ] Conversation / Worker Run context: inject memory snapshot **only** when `state:memory` is installed and the Agent grant includes memory.
- [ ] Tests: a stock `vibekit create` Project has none of these modules; adding and removing one module must not affect the others.

---

### Suggested official catalog (this increment)

| ID | Family | OOB? | External service? |
| :--- | :--- | :--- | :--- |
| `state:memory` | state | Yes — local SQLite + FTS5 | No |
| `tool:memory` | tool | Yes — requires `state:memory` | No |
| `interface:http` | interface | Yes | No |
| `interface:webhook` | interface | Yes | Caller-provided |
| `interface:schedule` | interface | Yes | No |
| `interface:slack` | interface | Optional bind | Slack |
| `interface:telegram` | interface | Optional bind | Telegram |
| `tool:web` | tool | Yes (`web_fetch`); search optional | Search key optional |
| `tool:browser` | tool | Optional bind | Driver in this package only |
| `tool:github` | tool | Optional bind (promote stub) | `GITHUB_TOKEN` |
| `tool:mcp` | tool | Optional bind | User MCP servers |
| `tool:process` | tool | Yes | No |
| `tool:scheduler` | tool | Yes — requires `interface:schedule` | No |
| `policy:interface-pairing` | policy | Optional bind | No |
| `policy:untrusted-inbound` | policy | Optional bind | No |
| `policy:memory-write-approval` | policy | Optional bind | No |
| `policy:schedule-no-recurse` | policy | Optional bind | No |
| `skill:memory-hygiene` | skill | Optional bind | No |
| `skill:browser-use` | skill | Optional bind | No |
| `skill:scheduler` | skill | Optional bind | No |
| `verifier:schema` | verifier | Optional bind | No |

Not in this increment (contributor later, same contracts): other memory backends, Discord/email/WhatsApp, vision, Host-as-MCP-server, embeddings providers.
