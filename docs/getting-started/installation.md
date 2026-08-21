# Installation

VibeKit is designed to be installed once per machine. The installed product owns the Host, embedded model engine, official catalog, built-in abilities, memory, and connection adapters, so an ordinary Project does not need its own VibeKit package tree.

## Requirements

- Node.js `>=20.0.0`
- macOS, Linux, or Windows (WSL2 is recommended on Windows)
- A model service account or API credential for the model you select during setup

## Install the product

The public release path has one package and one command:

```bash
npm install --global --ignore-scripts @useagentsio/vibekit@latest
vibekit --version
vibekit
```

`@useagentsio/vibekit` is the planned product package and is not published yet. Do not run this public-install command against npm until the release has been explicitly published. For the current source checkout, build and test the local product tarball using the [contributor workflow](../contributing/guide.md#local-product-tarball).

On first launch, VibeKit asks for the model service and model authentication it needs, selects the General Assistant with bounded file, command, web-search, and memory abilities, checks a real conversation, and opens the configured connection. Choose **Customize setup** only when you need different abilities, a different workspace, or another connection.

Credentials are kept outside Project YAML, JSON, State, logs, and manifests. If you provide credentials interactively, VibeKit stores them in the owner-only local deployment store. If you use an environment variable instead, keep the value in your shell or secret manager and expose only its name to the Project.

## Connections and background availability

The terminal connection works immediately in the first path. To connect a channel later, use the guided command from inside the Project:

```bash
vibekit connect telegram
```

If a connection needs to receive messages while you are logged out, VibeKit can install its local Gateway service after setup:

```bash
vibekit gateway install
vibekit dashboard
```

The Gateway is loopback-only and reads health and configuration metadata. Each Project keeps its own Host, assistant, model, abilities, memory, sessions, State, and credentials. Gateway service actions never delete or stop Project data.

## Troubleshooting

Start with the user-facing checks:

```bash
vibekit status
vibekit doctor
vibekit setup
```

`status` summarizes readiness, `doctor` explains a broken dependency or file, and rerunning `setup` preserves existing choices while repairing missing setup steps. Use the [CLI reference](../cli/commands.md) for advanced Project and Module operations.

Contributors working from a source checkout should use the [Development Guide](../contributing/guide.md), which keeps local linking, registry generation, packaging, and release checks separate from this user installation path.
