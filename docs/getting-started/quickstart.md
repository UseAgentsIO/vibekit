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

---

## 2. Navigate and Send a Message

Change into the created directory and send your first message using `vibekit msg`:

```bash
cd my-agent
vibekit msg "Hello! What can you help me with?"
```

What happens under the hood:
- The `vibekit` CLI starts an in-process **Agent Host**.
- The Host resolves the `chief` agent binding, checks permissions, and connects to the provider using your `OPENAI_API_KEY`.
- Pi executes the turn inside an isolated session.
- The Host records the conversation turn to `.vibekit/state/conversations/` and prints the output to your terminal.

---

## 3. Run the Foreground Terminal Interface

To maintain an interactive conversation with your Agent Project, run `vibekit start`:

```bash
vibekit start
```

This launches the always-running Host alongside the interactive Terminal interface:
- Type messages directly into the prompt.
- Conversation context is preserved across turns.
- Press `Ctrl+C` or type `/quit` to exit.

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
