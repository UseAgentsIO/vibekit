# VibeKit Projects and composition

Use `.vibekit/project.yaml` as the canonical Project contract and `.vibekit/installed.json` as CLI-managed installation state. Use one Project per repository or workspace root.

## Know the owned surfaces

Commit Project contracts, installed manifests, local Agent definitions and instructions, Policies, Verifiers, non-secret configuration, and accepted Decisions when appropriate. Keep `.vibekit/runtime/` ignored because it contains claims, locks, staging, generated configuration, and temporary Run data.

Treat these paths by role:

```text
.pi/                         Pi-native extensions, skills, prompts, settings
.vibekit/project.yaml        canonical VibeKit composition
.vibekit/installed.json      CLI-managed versions, ownership and hashes
.vibekit/agents/             editable installed Agent recipes
.vibekit/components/         installed Policies, Verifiers and State adapters
.vibekit/config/             canonical per-Module configuration fragments
.vibekit/state/              Tasks, Results, Decisions, Approvals, Verifications, Events
.vibekit/runtime/            ephemeral locks, claims, staging and generated files
```

Never treat generated runtime files as canonical Project State.

## Select an official Agent

- Use `agent:coder` for bounded source changes with command verification.
- Use `agent:reviewer` for independent review without source-write authority.
- Use `agent:researcher` for cited research without source-write authority by default.
- Use `agent:project-manager` to scope Tasks and delegate to coder, reviewer, or researcher.
- Use `agent:chief` to compose Project Manager, coder, reviewer, and researcher work.

Install an Agent through the CLI, then customize its copied `.vibekit/agents/<name>/agent.yaml` and `instructions.md`. Keep its required input, output, capability, permission, delegation, isolation, verification, completion, and escalation contracts internally consistent.

## Compose capabilities and authority

Bind an Agent by name under `agentBindings`, then bind required capabilities to installed Components under `capabilityBindings`. Use stable lowercase IDs such as `agent:coder`, `tool:filesystem`, and `verifier:command`; display names never belong in references.

Resolve capabilities in this order: explicit Agent binding, explicit Project binding, one compatible installed provider, guided selection, then failure. Never choose randomly between several providers.

Define delegation in both places that constrain it:

- The Agent contract must allow the target, depth, and parallel child count.
- The Project delegation graph must allow the binding-to-binding edge.

The current Task must also permit delegation. Reject missing targets, excess depth or child count, and cycles.

Keep authorization separate from capabilities and permissions. Use `deny`, `standing`, or `explicit` per Project action. Require a durable scoped Approval for an exact consequential action when its mode is `explicit`; do not turn one approval into continuing general authority.

## Configure models and State

Resolve a model in this order: allowed Task override, Project Agent binding, Agent default, Project default, then error. Honor `allowTaskOverride` and `allowProjectOverride`; do not infer that a catalog entry is runnable without live configuration.

Use `state:repository` for V1 durable State. Set each record class to `git`, `local`, or `ephemeral`. A safe default keeps Decisions in Git, Tasks/Results/Approvals/Verifications/Events local, and runtime state ephemeral. Never commit secret values through any tracking mode.

Write shared Module settings as separate `.vibekit/config/<type>/<name>.yaml` fragments. Let VibeKit combine them under `.vibekit/runtime/generated/`; do not let Modules blindly edit a shared generated file.

## Validate manual edits

Preserve `schemaVersion: 1`, typed IDs, relative paths, compatible Module references, an acyclic delegation graph, and bound required capabilities. After editing the Project or an Agent, run `vibekit doctor` and inspect every finding before running an Agent.
