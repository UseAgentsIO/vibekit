# VibeKit CLI

Use the CLI for Project initialization and Module lifecycle operations. Run commands from the Project root or pass `--dir <project-root>` explicitly.

## Choose the executable

In the VibeKit source repository, use:

```bash
pnpm exec tsx packages/cli/src/index.ts --help
```

Outside the source repository, prefer an installed `vibekit` binary. Otherwise use the scoped package:

```bash
npx --yes @useagentsio/cli@0.3.1 --help
```

Require Node 20 or later. Do not use the unscoped npm package `vibekit`; it is unrelated. Version `0.1.0` of `@useagentsio/cli` has a broken global bin, so use `0.1.2` or later.

## Inspect before mutating

For an existing Project, run:

```bash
vibekit list --dir <project-root>
vibekit doctor --dir <project-root>
```

Read `.vibekit/project.yaml`, `.vibekit/installed.json`, and the relevant installed Agent or Component files. Keep the four list states separate: installed, configured, available, and verified. Use `vibekit <command> --help` or `vibekit help <command>` for the current command-specific contract.

## Command surface

```text
vibekit create [dir] [--agent <name>] [--provider <id>] [--model <id>] [--interface <name>] [--yes]
vibekit msg <text> [--dir <path>]
vibekit start [--dir <path>]
vibekit init [dir] [--yes] [--registry <path>]
vibekit add <type> <name> [--yes] [--registry <path>] [--dir <path>]
vibekit list [--registry <path>] [--dir <path>]
vibekit diff <type:name> [--registry <path>] [--dir <path>]
vibekit update <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit remove <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit doctor [--registry <path>] [--dir <path>]
```

`create` is the first-path command. With `--yes` it installs the selected Agent, provider, and Interface and picks a default model when `--model` is omitted (first catalog model, then a known-provider fallback). `msg` sends one turn to a running Host over local IPC when `vibekit start` / `vibekit-host` is already up; otherwise it starts a short-lived in-process Host. `start` runs the Host plus the terminal Interface in the foreground.

Accept selectors as `type name`, `type:name`, or `type:name@version`. Accept `-y` as the short form of `--yes`, `-v` for the CLI version, and `-h` for help. Require `--yes` for noninteractive `add`, `update`, and `remove` operations.

Use `--registry <path>` to select a registry root. Otherwise let the CLI use `VIBEKIT_REGISTRY` or its bundled official registry.

## Initialize and compose

Create a Project, install an Agent and validate it:

```bash
vibekit init ./my-app
vibekit add agent coder --yes --dir ./my-app
vibekit list --dir ./my-app
vibekit doctor --dir ./my-app
```

Expect `init` to create `.vibekit/project.yaml`, `.vibekit/installed.json`, safe runtime ignore rules, and a minimal `.pi/` tree only when the target is not already a Pi project. Do not assume `init` installs an Agent.

When adding a Module, let the CLI resolve required dependencies, compatibility, capabilities, ownership, conflicts, requested permissions, configuration, and secret references. Required dependencies install with the Module; optional dependencies do not install silently and recommended dependencies remain recommendations.

## Update safely

Inspect before updating:

```bash
vibekit diff agent:coder --dir ./my-app
vibekit update agent:coder --yes --dir ./my-app
```

Interpret the three-way comparison as:

- Local equals installed base: replace it with upstream.
- Upstream equals installed base: keep the local file.
- Local equals upstream: mark it current.
- Local and upstream both changed: stop the entire Module update and report a conflict.

Do not look for a force flag; V1 deliberately has none. Resolve a conflict by understanding the local and upstream changes, preserving the intended customization, and rerunning a supported update path.

## Remove safely

```bash
vibekit remove skill:research --yes --dir ./my-app
```

Allow removal of unchanged exclusively owned files. Keep shared dependencies required by other Modules. Stop when an owned file has local modifications, and report the file instead of deleting it or manually dropping manifest ownership.

## Diagnose

Use `doctor` after each mutation and after manual edits to Project or Agent contracts. Treat a nonzero exit as unresolved. `doctor` reports schema and version failures, dependency cycles and conflicts, capability and Agent references, ownership and manifest integrity, missing configuration and secret references, delegation and Verifier problems, and runtime directory safety. It does not repair consequential issues.

If an installed Agent file was intentionally customized, expect `doctor` or `diff` to expose the local modification. That is evidence to preserve during updates, not a reason to overwrite it.
