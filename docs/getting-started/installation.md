# Installation & Requirements

This guide details the system requirements, installation methods, and environment configuration for **VibeKit Agents**.

---

## System Requirements

- **Node.js**: `>= 20.0.0` (LTS recommended)
- **Operating System**: macOS, Linux, or Windows (WSL2 recommended for Windows)
- **Package Manager**: `pnpm` (version `11.x` pinned for repository development) or `npm` / `yarn` for consuming packages.
- **Git**: Required for worktree-based mutation isolation and version tracking.

---

## Package Scope Notice

> [!IMPORTANT]
> The unscoped npm package name `vibekit` is taken by an unrelated legacy project on npm.
> All official VibeKit packages are published under the **`@useagentsio`** scope:
> - CLI package: `@useagentsio/cli` (provides the `vibekit` binary)
> - Host package: `@useagentsio/host` (provides the `vibekit-host` binary)
> - Core libraries: `@useagentsio/core`, `@useagentsio/pi`, `@useagentsio/interface-sdk`, `@useagentsio/interface-terminal`
> - Optional packages: `@useagentsio/interface-http`, `@useagentsio/interface-webhook`, `@useagentsio/interface-schedule`, `@useagentsio/interface-slack`, `@useagentsio/interface-telegram`, `@useagentsio/tool-web`, `@useagentsio/tool-browser`, `@useagentsio/tool-github`, `@useagentsio/tool-mcp`, `@useagentsio/tool-process`, `@useagentsio/state-memory`, `@useagentsio/verifier-schema`

---

## Installation Methods

### Method 1: Global CLI Installation (Recommended for General Use)

Install `@useagentsio/cli` globally to have the `vibekit` command available everywhere:

```bash
npm install -g --ignore-scripts @useagentsio/cli@latest
```

Verify the installation:

```bash
vibekit --version
vibekit --help
```

### Method 2: On-Demand Execution with `npx`

If you prefer not to install the CLI globally, invoke it directly with `npx`:

```bash
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes
```

Once inside a project directory initialized by VibeKit, local tools and scripts can resolve the local installation.

### Method 3: Library Packages for TypeScript / Node.js Applications

If you are building custom agents, embedding the Host in an application, or building an interface adapter:

```bash
npm install @useagentsio/core @useagentsio/host @useagentsio/pi @useagentsio/interface-sdk @useagentsio/interface-terminal
```

Or with `pnpm`:

```bash
pnpm add @useagentsio/core @useagentsio/host @useagentsio/pi @useagentsio/interface-sdk @useagentsio/interface-terminal
```

---

## Environment Variables & Provider Credentials

VibeKit enforces strict credential isolation: **API secrets are never stored in project files, manifests, logs, or state snapshots**.

Instead, project files reference environment variable names, which the Host resolves dynamically at runtime.

Set the appropriate environment variables for your chosen provider(s):

### OpenAI (`provider:openai`)
```bash
export OPENAI_API_KEY="sk-proj-..."
```

### OpenCode Go (`provider:opencode-go`)
```bash
export OPENCODE_API_KEY="opencode_..."
```

### xAI (`provider:xai`)
```bash
export XAI_API_KEY="xai-..."
```

### OpenRouter (`provider:openrouter`)
```bash
export OPENROUTER_API_KEY="sk-or-..."
```

### Local / unpublished registry path (development)

By default the CLI uses the official registry bundled inside `@useagentsio/cli`. Independently authored Modules can be installed from a local/custom registry path (`--registry <path>`). That path is recorded as `registrySource: "local:<absolute-path>"`. Hosted registries, search/discovery, and a marketplace are not implemented.

```bash
export VIBEKIT_REGISTRY="/path/to/vibekit/registry"
```

To add official modules, see [CONTRIBUTING.md](../../CONTRIBUTING.md) and [Module authoring](../contributing/module-authoring.md).

---

## Verifying Your Setup

Run the following sanity check to confirm your environment is ready:

```bash
node -v      # Must be >= 20.0.0
git --version # Must be present
echo $OPENAI_API_KEY # Should output your key reference or value
```
