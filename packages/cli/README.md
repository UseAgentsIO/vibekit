# vibekit

CLI for initializing Projects, installing Modules, and validating composition.

From the monorepo root (packages are not on npm yet):

```bash
pnpm exec tsx packages/cli/src/index.ts --help
```

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
