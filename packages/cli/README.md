# @useagentsio/cli

CLI for initializing Projects, installing Modules, and validating composition. The binary name is `vibekit`.

```bash
npm install -g --ignore-scripts @useagentsio/cli@0.3.0
vibekit --help
vibekit add --help
```

Install **0.1.2 or later** for per-command help. `0.1.0` does not run when invoked through the global `vibekit` shim.

```text
Usage: vibekit [options] [command]

compose Agents and Components into a Pi project
```

`--yes` is required for mutating commands when stdin is not a TTY. `--registry` selects a registry root. `--dir` selects the Project root.

See the [repository README](../../README.md) for the full command reference and catalog.
