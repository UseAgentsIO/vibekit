# CLI Command Reference

Comprehensive reference for all 14 commands supported by the `vibekit` CLI.

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
- `--agent <name>`: Starter Agent to install (default: `chief`).
- `--provider <name>`: Provider ID (default: `openai`).
- `--model <id>`: Model ID. Interactive create can pick from Pi’s catalog. With `--yes` and no `--model`, the CLI uses the first catalog model or a known-provider default (`openai` → `gpt-4.1`).
- `--interface <name>`: Interface component to bind (default: `terminal`).
- `-y, --yes`: Skip confirmation prompts.
- `--dir <path>`: Project directory override.
- `--registry <path>`: Custom registry root.

### Examples
```bash
# Interactive setup in a new folder
vibekit create my-agent

# Non-interactive automated creation
vibekit create my-agent --agent chief --provider openai --model gpt-5 --yes
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

Starts the Agent Host in the foreground with the interactive terminal Interface.

### Usage
```bash
vibekit start [options]
```

### Description
Runs the Host in the foreground and attaches the terminal Interface. Type a message at the `>` prompt. Type `exit` or `/exit` to quit, or press `Ctrl+C`. Approval gates prompt `y` / `n`. While this process is up, `vibekit msg` in another terminal uses local IPC instead of starting a second Host.

### Examples
```bash
vibekit start
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
Checks `.vibekit/project.yaml`, active conversation records, running worker locks, and configured Interface adapters.

### Examples
```bash
vibekit status
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

## 14. `vibekit help`

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
