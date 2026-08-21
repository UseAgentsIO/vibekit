# @useagentsio/cli

CLI for initializing Projects, installing Modules, and validating composition. The binary name is `vibekit`.

```bash
npm install --global --ignore-scripts @useagentsio/cli@latest
vibekit --help
vibekit add --help
```

The canonical first run creates the default Project without a second Project-local runtime install:

```bash
vibekit create my-agent --provider openai --model gpt-5 --yes
cd my-agent
vibekit msg "Hello! What can you help me with?"
```

```text
Usage: vibekit [options] [command]

compose Agents and Components into a Pi project
```

`--yes` is required for mutating commands when stdin is not a TTY. `--registry` selects a registry root. `--dir` selects the Project root.

See the [repository README](../../README.md) for the full command reference and catalog.
