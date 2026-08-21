# CLI Overview & Global Flags

The `vibekit` product command provides tools for creating, executing, managing, and diagnosing VibeKit Projects. The public product package will be `@useagentsio/vibekit`; users do not install the internal runtime areas separately.

---

## Invocation Syntax

```bash
vibekit [options] [command]
```

To display help:

```bash
vibekit --help
vibekit <command> --help
```

---

## Global Options

The following flags are accepted across all commands or where applicable:

| Flag | Short | Description |
| :--- | :--- | :--- |
| `--help` | `-h` | Display usage and help for any command. |
| `--version` | `-v` | Display the installed CLI version. |
| `--dir <path>` | — | Target project root directory (default: current working directory). |
| `--registry <path>` | — | Local official-catalog tree (this repo’s `registry/`). Default: bundled official registry or `VIBEKIT_REGISTRY`. |
| `--yes` | `-y` | Skip interactive confirmation prompts. **Required** when executing mutating commands in non-TTY environments (CI/CD scripts). |
| `--defaults` | `-d` | Use default parameters and bypass interactive setup wizards (used in `init`). |
| `--verbose` | — | Print machine IDs, detailed validation traces, and debug logs. |
| `--show-files` | — | Display the list of all created or modified files. |

---

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `VIBEKIT_REGISTRY` | Path to a local official-catalog tree (this repo’s `registry/`) for unpublished modules. Not a third-party marketplace. |
| `OPENAI_API_KEY` | API key used when configured with `provider:openai`. |
| `OPENCODE_API_KEY` | API key used when configured with `provider:opencode-go`. |
| `XAI_API_KEY` | API key used when configured with `provider:xai`. |
| `OPENROUTER_API_KEY` | API key used when configured with `provider:openrouter`. |

---

## Exit Codes

The CLI follows standard Unix exit code conventions:

| Exit Code | Meaning |
| :--- | :--- |
| `0` | Success. |
| `1` | Validation, usage, doctor errors, unknown command, or runtime failure. The CLI does not use exit code 2. |
