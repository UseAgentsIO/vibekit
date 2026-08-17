# Phase 5 notes — Pi substrate (2026-08-17)

Pi is `@earendil-works/pi-coding-agent` (renamed from `@mariozechner/pi-coding-agent`). Docs: https://pi.dev/docs/latest

## Boundary
- VibeKit MUST compose native Pi mechanisms first (Skill → Pi Skill, Tool → Pi extension, Provider → Pi provider config).
- Pi owns the model/tool loop. VibeKit owns contracts around it.
- Pi has **no built-in permission system**. Filesystem/process/network isolation is the caller's job. VibeKit MUST enforce Capability ∩ Policy ∩ Agent grant ∩ Task scope ∩ authorization at the adapter/tool boundary.

## SDK entry (`createAgentSession`)
```ts
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
```

Useful options for `@vibekit/pi`:
- `cwd` — isolated worktree path for coding Runs
- `tools` / `excludeTools` / `customTools` — grant only authorized Tools
- `resourceLoader` — inject Skills, extensions, system prompt
- `sessionManager: SessionManager.inMemory()` — VibeKit State is canonical, not Pi chat history
- `session.abort()` — cancellation
- `session.dispose()` — cleanup

Instruction stack to assemble as system prompt:
`VibeKit runtime invariants + Project contract + Agent instructions + current Task`

Untrusted content (issues, web, tool output, memory) is data, not higher-priority instructions.

## Mapping
| VibeKit | Pi |
|---|---|
| Skill Component | `.pi/skills/` or `skillsOverride` |
| Tool Component | `.pi/extensions/` or `customTools` / `defineTool` |
| Provider Component | Pi provider config / `ModelRuntime` |
| Agent | VibeKit contract → `createAgentSession` |
| Interface:terminal | Pi TUI / print / existing CLI |
| `agent_delegate` | custom tool registered only when Agent has `agent.delegate` |
| Run Events | map Pi `agent_start`/`agent_end`/`tool_*` → VibeKit Event types |
| Cancellation | `session.abort()` then cleanup worktrees/claims |

## Isolation
- Child Runs: clean env, only authorized secret refs.
- Coding mutation: separate git worktree (`cwd` = worktree path).
- Process isolation: spawn a child Node process when Project `execution.defaultIsolation` is `process`.
