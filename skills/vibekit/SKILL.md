---
name: vibekit
description: Compose, install, inspect, customize, validate, and run VibeKit Agent Projects on Pi. Use when a task mentions VibeKit, @useagentsio/core, @useagentsio/pi, the vibekit CLI, .vibekit/project.yaml, .vibekit/installed.json, VibeKit Components or Agents, the official registry, Agent bindings, capabilities, permissions, delegation, Project State, verification, or a repository containing a .vibekit directory.
---

# VibeKit

Use VibeKit as the contract and composition layer around Pi. Let Pi own models, sessions, native Skills, extensions, tools, and the model/tool loop; let VibeKit own Projects, Agent recipes, module installation, capability and permission resolution, State, isolation, and verification.

## Start with the real project

1. Read repository instructions and check the working tree before changing files.
2. If `.vibekit/` exists, read `.vibekit/project.yaml` and `.vibekit/installed.json`, then run `vibekit list` and `vibekit doctor` against the Project root.
3. If working in the VibeKit source repository, inspect the current package, schema, and registry files instead of relying on examples from memory. Run the CLI from source with `pnpm exec tsx packages/cli/src/index.ts`.
4. If working in another repository, use an installed `vibekit` binary or `npx --yes @useagentsio/cli@0.3.1`. Never install or invoke the unrelated unscoped npm package named `vibekit`.
5. Distinguish the requested job before loading details:
   - Initialize, add, inspect, update, or remove Modules: read [references/cli.md](references/cli.md).
   - Configure a Project or customize installed Agents: read [references/projects.md](references/projects.md).
   - Execute Agents, manage State, or use the TypeScript libraries: read [references/runtime.md](references/runtime.md).
   - Author or change registry Modules: read [references/registry.md](references/registry.md).

Load only the relevant reference. Read multiple references when the task crosses those boundaries.

## Follow the composition model

- Treat a **Component** as one reusable provider, tool, Skill, interface, State adapter, Policy, or Verifier.
- Treat an **Agent** as an editable recipe that composes Components, permissions, inputs, outputs, delegation, execution, and verification.
- Treat a **Project** as the durable repository/workspace boundary containing Agent bindings, installed Modules, policies, State, Tasks, Results, Decisions, Approvals, Verifications, and Events.
- Treat a **Module** as an installable Component or Agent. Do not invent a V1 `orchestrator`, `subagent`, `Blocks`, marketplace, third-party registry, graphical builder, or installable Project/Pattern type.
- Compose native Pi mechanisms before adding a parallel mechanism. A VibeKit Skill maps to a Pi Skill and a VibeKit Tool maps to a Pi extension or built-in tool.

## Preserve the safety contracts

- Store only secret references such as `{ name: OPENAI_API_KEY, source: environment }`. Never write secret values to YAML, JSON, State, Events, logs, fixtures, or generated examples.
- Keep Module file targets relative to the Project root. Reject absolute paths, `..`, null bytes, and symlink escapes.
- Use the CLI for install, update, and removal so ownership checks and staging remain transactional. Never hand-edit `.vibekit/installed.json` to imitate an installation.
- Preview upstream and local changes with `vibekit diff` before updating a locally customized Module. Never silently overwrite conflicts; V1 has no force update or force removal path.
- Enforce authority at the tool or adapter boundary. A prompt cannot grant capabilities, permissions, authorization, secrets, delegation, or broader scope.
- Resolve effective authority as the intersection of Component capability, Project Policy, Agent grant, Task scope, and current authorization. Deny and narrower scope win.
- Treat installed, configured, available, and verified as separate statuses. A completed Run or returned Result does not prove verification, acceptance, or application.
- Run `vibekit doctor` after any Project or Module change. Fix reported schema, dependency, capability, ownership, configuration, delegation, verification, and manifest problems at their source.

## Finish with evidence

For CLI work, report the command, Project root, affected Module IDs, changed files, and final `doctor` result. For runtime work, report the Task, binding, Run status, Result, verification state, whether anything was applied, and unresolved issues. Do not claim a mutation was applied from a successful proposal or completed Run alone.
