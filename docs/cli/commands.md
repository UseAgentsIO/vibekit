# CLI Command Reference

Comprehensive reference for the `vibekit` CLI commands.

---

## 1. `vibekit create`

Creates a new runnable Agent Project in one step.

### Usage
```bash
vibekit create [options] [dir]
```

### Description
Writes a schemaVersion 2 Project, installs `agent:<name>`, `provider:<id>`, and `interface:<name>` into `installed.json`, sets `defaults.model`, and binds `terminal-main` (or `<interface>-main`).

### Options
- `[dir]`: Target directory (default: current directory).
- `--agent <name>`: Starter Agent to install (default: `assistant`; use `--example headquarters` or an explicit Agent selection for a Chief-led Project).
- `--provider <name>`: Provider ID (default: `openai`).
- `--model <id>`: Model ID. Interactive create can pick from Pi’s catalog. With `--yes` and no `--model`, the CLI uses the first catalog model or a known-provider default (`openai` → `gpt-4.1`).
- `--interface <name>`: Interface component to bind (default: `terminal`; headquarters example defaults to `telegram`).
- `--example <name>`: Scaffold a named example. `headquarters` installs Chief + Personal + Telegram.
- `-y, --yes`: Skip confirmation prompts. Prompts for missing required module secrets unless `--yes`.
- `--dir <path>`: Project directory override.
- `--registry <path>`: Custom registry root.

### Examples
```bash
# Interactive setup in a new folder
vibekit create my-agent

# Non-interactive automated creation
vibekit create my-agent --agent chief --provider openai --model gpt-5 --yes

# Copyable Headquarters example (Chief + Personal + Telegram)
vibekit create ~/headquarters --example headquarters --provider openai --yes
```

---

## 2. `vibekit msg`

Sends a single turn through the Host to the configured Agent and provider.

### Usage
```bash
vibekit msg [options] <text>
```

### Description
Sends one turn on the local CLI conversation and prints the Agent’s response. If a Host daemon is already running for the Project (`.vibekit/runtime/host.sock`), the turn is submitted over local IPC. Otherwise the CLI starts a short-lived in-process Host, then stops it.

### Examples
```bash
vibekit msg "Summarize the project status"
vibekit msg --dir ./my-agent "Check for uncommitted files"
```

---

## 3. `vibekit start`

Starts the Agent Host service daemon in the background (or attached with `--foreground`).

### Usage
```bash
vibekit start [options]
```

### Description
Starts the Host daemon detached in the background. Missing required secrets are prompted and persisted securely in the local deployment store (`~/.config/vibekit/<project>/env`, mode `0600`) so subsequent launches run without re-exporting credentials. Once healthy, `vibekit start` returns while the Host service continues running.

To run attached in the current terminal, pass `--foreground` (`-f`).

### Examples
```bash
vibekit start
vibekit start --foreground
vibekit start --dir ./my-agent
```

---

## 4. `vibekit status`

Displays the current health and status of the Project, Host, and Interfaces.

### Usage
```bash
vibekit status [options]
```

### Description
Checks `.vibekit/project.yaml`, active conversation records, running worker locks, configured Interface adapters, and verifies Host daemon health over local IPC.

### Examples
```bash
vibekit status
vibekit status --dir ./my-agent
```

---

## 5. `vibekit stop`

Gracefully shuts down the running Host service daemon and its Interfaces.

### Usage
```bash
vibekit stop [options]
```

### Description
Sends a graceful shutdown request to the running Host daemon over local IPC, shuts down all attached Interfaces, releases locks, and removes runtime status/socket files.

### Examples
```bash
vibekit stop
vibekit stop --dir ./my-agent
```

---

## 5. `vibekit model`

Interactively picks or sets the project model from Pi's live catalog.

### Usage
```bash
vibekit model [options] [provider/id]
```

### Description
Queries live model metadata from Pi and updates `defaults.model` in `.vibekit/project.yaml`.

### Options
- `[provider/id]`: Explicit provider and model pair (e.g., `openai/gpt-5`).
- `--provider <name>`: Provider identifier.
- `--model <id>`: Model identifier.
- `-y, --yes`: Apply non-interactively (requires `--provider` and `--model`).

### Examples
```bash
# Interactive model picker
vibekit model

# Explicit assignment
vibekit model --provider openai --model gpt-5 --yes
```

---

## 6. `vibekit init`

Initializes a Project and launches the interactive configuration wizard.

### Usage
```bash
vibekit init [options] [dir]
```

### Description
Writes `.vibekit/project.yaml` and `installed.json`, then presents a keyboard-driven setup wizard. Arrow keys navigate, space toggles selections, and Enter confirms.

### Options
- `-d, --defaults`: Skip wizard and initialize with empty default settings.
- `-y, --yes`: Non-interactive mode.
- `--provider <name>`: Provider ID.
- `--model <id>`: Model ID.
- `--agent <name>`: Agent ID to install.
- `--interface <name>`: Interface ID.
- `--skill <name>`: Skill ID (repeatable).
- `--tool <name>`: Tool ID (repeatable).
- `--policy <name>`: Policy ID (repeatable).

### Examples
```bash
vibekit init
vibekit init ./my-app --defaults
```

---

## 7. `vibekit add`

Installs a Component or Agent from the official registry.

### Usage
```bash
vibekit add [options] <type> <name>
# Or using selector syntax:
vibekit add [options] <type:name>
```

### Description
Resolves required dependencies, calculates file target collisions, displays requested permissions, and atomically copies module files into `.vibekit/`.

### Arguments
- `<type>`: `provider` | `tool` | `skill` | `interface` | `state` | `policy` | `verifier` | `agent`
- `<name>`: Module name (e.g., `coder`, `filesystem`, `openai`).

### Examples
```bash
vibekit add agent coder --yes
vibekit add tool filesystem --yes
vibekit add policy require-verification --yes
```

---

## 8. `vibekit list`

Lists all installed Modules and available registry components.

### Usage
```bash
vibekit list [options]
```

### Description
Displays a table of Module ID, version, source, and four flags:
1. **Installed**: Recorded in `.vibekit/installed.json`.
2. **Configured**: Referenced from `project.yaml` (policies, verification, agent bindings, state backend) **or** all recorded `configurationPaths` exist.
3. **Available**: Present in the official registry index (not “loaded in the Host”).
4. **Verified**: Every installed file still exists and its hash matches the manifest (no local edit).

### Examples
```bash
vibekit list
```

---

## 9. `vibekit diff`

Performs a read-only three-way comparison for an installed Module.

### Usage
```bash
vibekit diff [options] <module>
```

### Description
Compares the installed base registry version, your local project modifications, and the latest compatible upstream registry version. Does not modify any files.

### Examples
```bash
vibekit diff agent:coder
vibekit diff tool:filesystem
```

---

## 10. `vibekit update`

Updates an installed Module using a three-way merge algorithm.

### Usage
```bash
vibekit update [options] <module>
```

### Description
Safely updates module files to upstream versions. If upstream updated a file but you did not modify it locally, the file updates cleanly. If both upstream and local files changed, the operation **halts on conflict** without overwriting your changes. There is no `--force` flag in V1.

### Examples
```bash
vibekit update agent:coder --yes
vibekit update tool:github@1.1.0 --yes
```

---

## 11. `vibekit remove`

Safely uninstalls a Module from the project.

### Usage
```bash
vibekit remove [options] <module>
```

### Description
Deletes exclusive, unmodified files belonging to the module. If you have locally edited a file, removal is stopped to protect your work. Dependencies shared with other installed modules remain untouched.

### Examples
```bash
vibekit remove skill:research --yes
vibekit remove agent:reviewer --yes
```

---

## 12. `vibekit doctor`

Runs comprehensive diagnostic checks on the project configuration and file tree.

### Usage
```bash
vibekit doctor [options]
```

### Description
Validates:
- JSON schema conformity for `project.yaml` and `installed.json`.
- File hash checksums against the installed manifest.
- Module dependency completeness and cycle detection.
- Permission consistency and file path scopes.
- Integrity of state directories and session locks.

`vibekit doctor` reports actionable errors and warnings. It never silently mutates consequential project settings.

### Examples
```bash
vibekit doctor
vibekit doctor --dir ./my-agent
```

---

## 13. `vibekit migrate`

Upgrades a legacy schemaVersion 1 project to the Host-aware schemaVersion 2 format.

### Usage
```bash
vibekit migrate [options]
```

### Description
Updates `.vibekit/project.yaml` by generating Host settings (`retainedConversations`, `maxParallelConversations`, `shutdownGraceMs`), adding default agent bindings, and verifying interface declarations.

### Examples
```bash
vibekit migrate --yes
```

---

## 14. `vibekit approve-pairing`

Approves a Telegram pairing code so that sender can talk to the Host.

### Usage
```bash
vibekit approve-pairing [options] <code>
```

Codes are 8 characters (from the bot). They expire after one hour. Stored in `.vibekit/runtime/pairing-telegram.json`.

### Examples
```bash
vibekit approve-pairing 7K3M9P2Q
```

---

## 15. `vibekit help`

Displays global help or in-depth documentation for a specific command.

### Usage
```bash
vibekit help [command]
```

### Examples
```bash
vibekit help
vibekit help create
```

---

## 16. `vibekit projects`

Maintains the owner-only machine registry used to keep Project identities and Project-scoped secrets isolated.

```bash
vibekit projects add /absolute/path/to/project
vibekit projects list
vibekit projects remove project:example
vibekit projects locate project:example /new/absolute/path
```

Paths are canonicalized. A Project ID can belong to only one path, relocation is allowed only after the old path is missing and unregistering never removes Project files, State, sessions or secrets.

---

## 17. `vibekit gateway` and `vibekit dashboard`

Runs one loopback-only Project Dashboard while every registered Project continues to execute in its own Host process.

```bash
vibekit gateway install [--port 9467]
vibekit gateway start|stop|restart|status|uninstall
vibekit gateway run [--port 9467]
vibekit dashboard [--port 9467]
```

`install` explicitly creates a per-user login service: launchd on macOS, systemd user service on Linux and WSL2, or Task Scheduler on native Windows. Gateway service changes never start, stop or restart Project Hosts. The dashboard can add existing Projects and control lifecycle, but cannot create Projects, send messages or edit Agent, model, permission or Interface configuration.

Gateway-launched Hosts do not inherit provider keys from the Gateway process. Run `vibekit start --dir /path/to/project` once to enter any missing credentials into that Project's owner-only deployment store, then stop it before managing it from the dashboard.
