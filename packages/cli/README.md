# @useagentsio/cli

CLI for initializing Projects, installing Modules, and validating composition. The binary name is `vibekit`.

```bash
npm install -g --ignore-scripts @useagentsio/cli@0.1.1
vibekit --help
```

Install **0.1.1 or later**. `0.1.0` does not run when invoked through the global `vibekit` shim.

```text
vibekit init [dir] [--yes] [--registry <path>]
vibekit add <type> <name> [--yes] [--registry <path>] [--dir <path>]
vibekit list [--registry <path>] [--dir <path>]
vibekit diff <type:name> [--registry <path>] [--dir <path>]
vibekit update <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit remove <type:name> [--yes] [--registry <path>] [--dir <path>]
vibekit doctor [--registry <path>] [--dir <path>]
```

`--yes` is required for mutating commands when stdin is not a TTY. `--registry` selects a registry root. `--dir` selects the Project root.

See the [repository README](../../README.md) for the full command reference and catalog.
