# Official Components

Reference guide for all official Component modules available in the VibeKit registry.

---

## 1. Providers (`family: provider`)

Provider components configure connections to LLM providers. Secrets are declared as environment references.

| ID | Provider | Required Secret Reference | Notes |
| :--- | :--- | :--- | :--- |
| `provider:openai` | OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-5, o1/o3 series |
| `provider:openai-codex` | OpenAI Codex | OAuth Login | Coding-optimized completions |
| `provider:opencode-go` | OpenCode | `OPENCODE_API_KEY` | OpenCode API endpoint |
| `provider:xai` | xAI | `XAI_API_KEY` | Grok series models |
| `provider:openrouter` | OpenRouter | `OPENROUTER_API_KEY` | Multi-model routing |

---

## 2. Tools (`family: tool`)

Tool components grant agents concrete capabilities to interact with filesystems and runtime environments.

| ID | Runtime Kind | Included Tools / Features | Status in V1 |
| :--- | :--- | :--- | :--- |
| `tool:filesystem` | `pi-builtin` | `read`, `grep`, `find`, `ls`, `write`, `edit` | **Active** |
| `tool:execution` | `pi-builtin` | `bash` (command execution) | **Active** |
| `tool:github` | `config-only` | Declares `GITHUB_TOKEN` requirement | **Config Only** (Unavailable as executable tool) |

---

## 3. Skills (`family: skill`)

Skill components supply structured instructions, prompt templates, and best practices to Pi worker sessions.

| ID | Focus | Description |
| :--- | :--- | :--- |
| `skill:software-development` | Coding | Best practices for test-driven development, git hygiene, and clean refactoring. |
| `skill:research` | Analysis | Guidelines for evidence gathering, citations, and comparative analysis. |

---

## 4. Interfaces (`family: interface`)

Interfaces translate external communication protocols into Host tasks and conversation turns.

| ID | Package | Status |
| :--- | :--- | :--- |
| `interface:terminal` | `@useagentsio/interface-terminal` | **Shipped & Active** (Provides stdio CLI and interactive terminal) |
| `interface:slack` | — | Planned (Future release) |
| `interface:telegram` | — | Planned (Future release) |

---

## 5. Policies (`family: policy`)

Policies enforce runtime invariants across all agent runs in a project.

| ID | Purpose | Description |
| :--- | :--- | :--- |
| `policy:least-privilege` | Security | Blocks ungranted path access and restricts command execution to explicit white-lists. |
| `policy:require-verification` | Integrity | Requires passing independent verification before task results can be marked as accepted. |

---

## 6. Verifiers (`family: verifier`)

Verifiers execute deterministic checks against candidate changes.

| ID | Execution | Description |
| :--- | :--- | :--- |
| `verifier:command` | Shell Command | Executes automated test suites or linters (e.g., `npm test`, `vitest run`) against the exact candidate Git revision. |

---

## 7. State (`family: state`)

State components provide storage backends for project history.

| ID | Storage Model | Description |
| :--- | :--- | :--- |
| `state:repository` | Filesystem JSON | Stores state documents in `.vibekit/state/` subdirectories. Transparent, Git-friendly, and portable. |
