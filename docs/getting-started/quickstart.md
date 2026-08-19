# Quickstart Guide

Get up and running with **VibeKit Agents** in less than two minutes.

---

## Prerequisites

Before starting, ensure you have:
- **Node.js**: `v20.0.0` or higher (`node -v`)
- **API Key**: An API key for your chosen AI provider (e.g., `OPENAI_API_KEY`)

---

## 1. Create a Project

Run the `@useagentsio/cli` creation wizard with `npx` (no global installation required):

```bash
# Set your provider API key in your environment
export OPENAI_API_KEY="sk-..."

# Create a project named 'my-agent'
npx --yes @useagentsio/cli@latest create my-agent --agent chief --provider openai --interface terminal --yes
```

This command automatically:
1. Initializes a `.vibekit/` directory with a valid `project.yaml` and `installed.json`.
2. Installs the **Chief** agent (`agent:chief`) along with its required policies and tools.
3. Binds the **OpenAI** provider (`provider:openai`) and the **Terminal** interface (`interface:terminal`).
4. Generates an embedded `.pi/` settings directory.

`--yes` without `--model` picks a default (catalog first, then `gpt-4.1` for OpenAI). After create, `vibekit list` should show the Agent, provider, and Interface as installed. To extend the official catalog, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## 2. Navigate and Send a Message

Change into the created directory and send your first message using `vibekit msg`:

```bash
cd my-agent
vibekit msg "Hello! What can you help me with?"
```

What happens under the hood:
- If a Host is already running for this Project, `msg` submits the turn over `.vibekit/runtime/host.sock`.
- Otherwise the CLI starts a short-lived in-process Host, then stops it.
- The Host resolves the `chief` binding, checks permissions, and uses `OPENAI_API_KEY` as a secret **reference**.
- Pi runs the turn; the Host writes `conversation_*.yaml` under `.vibekit/state/conversations/`.

---

## 3. Run the Foreground Terminal Interface

To maintain an interactive conversation with your Agent Project, run `vibekit start`:

```bash
vibekit start
```

This launches the always-running Host alongside the interactive Terminal interface:
- Type messages directly into the prompt.
- Conversation context is preserved across turns.
- Press `Ctrl+C` or type `exit` / `/exit` to quit. Approval prompts accept `y` / `n`.

---

## 4. Compose and Extend Your Project

Your project is not a fixed template—you own every file in it. You can inspect and add components anytime:

```bash
# Add a coder agent to allow the Chief to delegate coding tasks
vibekit add agent coder --yes

# Add filesystem tools
vibekit add tool filesystem --yes

# Add verification policies
vibekit add policy require-verification --yes

# Check project health and module statuses
vibekit list
vibekit doctor
```

---

## Next Steps

- Learn about [Core Concepts](core-concepts.md) (Taxonomy, State, and Host).
- Explore the [CLI Reference](../cli/commands.md) for all management options.
- Read about [Multi-Agent Patterns](../patterns/README.md) to understand how Chief delegates to Coders and Reviewers.
