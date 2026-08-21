# Quickstart

VibeKit gives you one assistant, a model, useful abilities, memory, and a connection without making you assemble a runtime first. Install it once, run the product command, and answer the short setup questions.

## Start here

The public release path will use one product package. This package is not published yet; use the local tarball check in the [contributor guide](../contributing/guide.md) for this checkout.

When `@useagentsio/vibekit` is published, the complete user path is:

```bash
# Install the product once. This leaves the durable vibekit command on PATH.
npm install --global --ignore-scripts @useagentsio/vibekit@latest

# Run VibeKit. On the first run it creates the Project and opens the conversation.
vibekit
```

During setup, choose a model service and model, provide the requested authentication, and keep the useful default assistant, abilities, memory, and terminal connection unless you want to customize them. VibeKit stores only secret references in the Project; prompted credentials belong in the owner-only local deployment store.

When the terminal conversation opens, send a real request:

```text
Help me plan the next three things I should finish today.
```

The assistant replies in the same conversation. That first reply is your first successful conversation and the readiness proof that the model, Host, abilities, memory, and connection are working together.

## Useful next actions

After the first conversation, these commands cover the common follow-ups:

```bash
vibekit status                 # See the Project, model sign-in, connections, and Host health
vibekit model                  # Change the model for this Project
vibekit config                 # Review user-facing configuration
vibekit connect telegram       # Add a Telegram connection with guided pairing
vibekit add tool browser       # Give the assistant another ability
vibekit doctor                 # Check and safely repair mechanical issues
```

Use `vibekit` again inside the Project directory to reopen the terminal conversation. Use `vibekit msg "..."` when a script needs one turn instead of an interactive connection.

For the user-facing command list, see the [CLI reference](../cli/commands.md). For the mental model behind assistants, Projects, and connections, see [Core Concepts](core-concepts.md). Technical registry and Module details belong in [Module Authoring](../contributing/module-authoring.md), not in this first path.
