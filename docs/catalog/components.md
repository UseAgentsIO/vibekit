# Official Components

Reference guide for all official Component modules available in the VibeKit registry.

To add or change an official Component, follow [Module authoring](../contributing/module-authoring.md). Keep this table, the [README catalog](../../README.md), and `tests/registry/official.test.ts` in sync with `registry/index.json`.

---

## 1. Providers (`family: provider`)

Provider components configure connections to LLM providers. Secrets are declared as environment references.

| ID | Provider | Required Secret Reference | Notes |
| :--- | :--- | :--- | :--- |
| `provider:openai` | OpenAI | `OPENAI_API_KEY` | Direct OpenAI API |
| `provider:openai-codex` | OpenAI Codex | OAuth (Pi `/login`) | ChatGPT / Codex |
| `provider:opencode-zen` | OpenCode Zen | `OPENCODE_ZEN_API_KEY` | Distinct from OpenCode Go |
| `provider:opencode-go` | OpenCode Go | `OPENCODE_API_KEY` | OpenCode Go |
| `provider:xai` | xAI | `XAI_API_KEY` (optional) | Grok; Pi OAuth preferred |
| `provider:openrouter` | OpenRouter | `OPENROUTER_API_KEY` | Multi-model router |
| `provider:anthropic` | Anthropic | `ANTHROPIC_API_KEY` | Claude; OAuth stays in Pi |
| `provider:google` | Google | `GEMINI_API_KEY` | Gemini (`GOOGLE_API_KEY` alias) |
| `provider:google-vertex` | Google Vertex | none (ADC) | `project` / `region` in config |
| `provider:github-copilot` | GitHub Copilot | `COPILOT_GITHUB_TOKEN` | Not Copilot ACP |
| `provider:azure` | Azure OpenAI | `AZURE_OPENAI_API_KEY` | Pi id `azure-openai-responses` |
| `provider:amazon-bedrock` | Amazon Bedrock | none (AWS chain) | Optional `region` |
| `provider:groq` | Groq | `GROQ_API_KEY` | |
| `provider:mistral` | Mistral | `MISTRAL_API_KEY` | |
| `provider:deepseek` | DeepSeek | `DEEPSEEK_API_KEY` | |
| `provider:huggingface` | Hugging Face | `HF_TOKEN` | |
| `provider:cerebras` | Cerebras | `CEREBRAS_API_KEY` | |
| `provider:minimax` | MiniMax | `MINIMAX_API_KEY` | |
| `provider:minimax-cn` | MiniMax CN | `MINIMAX_CN_API_KEY` | |
| `provider:moonshot` | Moonshot AI | `MOONSHOT_API_KEY` | Pi id `moonshotai` |
| `provider:kimi` | Kimi Coding | `KIMI_API_KEY` | Pi id `kimi-coding` |
| `provider:kimi-cn` | Kimi CN | `KIMI_CN_API_KEY` | Pi id `moonshotai-cn` |
| `provider:nvidia` | NVIDIA NIM | `NVIDIA_API_KEY` | |
| `provider:ollama` | Ollama (local) | none | Default `http://127.0.0.1:11434/v1` |
| `provider:ollama-cloud` | Ollama Cloud | `OLLAMA_API_KEY` | |
| `provider:zai` | Z.AI | `ZAI_API_KEY` | `GLM_API_KEY` alias |
| `provider:novita` | Novita | `NOVITA_API_KEY` | |
| `provider:vercel-ai-gateway` | Vercel AI Gateway | `AI_GATEWAY_API_KEY` | |
| `provider:arcee` | Arcee | `ARCEEAI_API_KEY` | |
| `provider:gmi` | GMI Cloud | `GMI_API_KEY` | |
| `provider:xiaomi` | Xiaomi | `XIAOMI_API_KEY` | |
| `provider:tencent-tokenhub` | Tencent TokenHub | `TOKENHUB_API_KEY` | |
| `provider:lmstudio` | LM Studio | `LM_API_TOKEN` | Default `http://localhost:1234/v1` |
| `provider:together` | Together | `TOGETHER_API_KEY` | |
| `provider:fireworks` | Fireworks | `FIREWORKS_API_KEY` | |
| `provider:alibaba` | Alibaba DashScope | `DASHSCOPE_API_KEY` | |
| `provider:alibaba-coding-plan` | Alibaba Coding Plan | `DASHSCOPE_API_KEY` | Separate billing SKU |
| `provider:stepfun` | StepFun | `STEPFUN_API_KEY` | |
| `provider:cohere` | Cohere | `COHERE_API_KEY` | |
| `provider:deepinfra` | DeepInfra | `DEEPINFRA_API_KEY` | |
| `provider:byteplus` | BytePlus | `BYTEPLUS_API_KEY` | |
| `provider:byteplus-plan` | BytePlus Plan | `BYTEPLUS_API_KEY` | |
| `provider:volcengine` | Volcengine | `VOLCANO_ENGINE_API_KEY` | |
| `provider:volcengine-plan` | Volcengine Plan | `VOLCANO_ENGINE_API_KEY` | |
| `provider:chutes` | Chutes | `CHUTES_API_KEY` | |
| `provider:qianfan` | Qianfan | `QIANFAN_API_KEY` | |
| `provider:featherless` | Featherless | `FEATHERLESS_API_KEY` | |
| `provider:venice` | Venice | `VENICE_API_KEY` | |
| `provider:synthetic` | Synthetic | `SYNTHETIC_API_KEY` | |
| `provider:kilocode` | Kilo Code | `KILOCODE_API_KEY` | |
| `provider:commandcode` | CommandCode | `COMMANDCODE_API_KEY` | |
| `provider:meta-ai` | Meta Model API | `MODEL_API_KEY` | |
| `provider:actual` | Actual Computer | `ACTUAL_API_KEY` (optional) | Loopback needs no key |
| `provider:vllm` | vLLM | none | Default `http://127.0.0.1:8000/v1` |
| `provider:sglang` | SGLang | none | Default `http://127.0.0.1:30000/v1` |
| `provider:custom` | Custom endpoint | `CUSTOM_API_KEY` (optional) | `baseUrl` required |

Install with `vibekit add provider <name>`. These modules map onto Pi. They do not ship a second inference client.

---

## 2. Tools (`family: tool`)

Tool components grant agents concrete capabilities to interact with filesystems and runtime environments.

| ID | Runtime Kind | Included Tools / Features | Status in V1 |
| :--- | :--- | :--- | :--- |
| `tool:filesystem` | `pi-builtin` | `read`, `grep`, `find`, `ls`, `write`, `edit` | **Active** |
| `tool:execution` | `pi-builtin` | `bash` (command execution) | **Active** |
| `tool:github` | `pi-extension` (`1.1.0`) | Issues, PRs, checks, file contents (`GITHUB_TOKEN`) | **Optional.** `1.0.0` stays config-only; update explicitly. |
| `tool:memory` | `pi-extension` | `store` / `get` / `search` / `replace` / `forget` / `session_search` | **Optional.** Requires `state:memory`. |
| `tool:web` | `pi-extension` | `web_fetch` (no key); `web_search` only if a search secret is set | **Optional.** Fetched content is untrusted. |
| `tool:browser` | `pi-extension` | navigate / snapshot / click | **Optional.** Playwright is a dependency of this package only. |
| `tool:mcp` | `pi-extension` | MCP client: list servers/tools, call | **Optional.** Filtered stdio env. Not a marketplace. |
| `tool:process` | `pi-extension` | start / list / poll / wait / log / kill | **Optional.** Complements `tool:execution`. |
| `tool:scheduler` | `pi-extension` | create / list / pause / resume / run / remove | **Optional.** Requires `interface:schedule`. |

---

## 3. Skills (`family: skill`)

Skill components supply structured instructions, prompt templates, and best practices to Pi worker sessions.

| ID | Focus | Description |
| :--- | :--- | :--- |
| `skill:software-development` | Coding | Best practices for test-driven development, git hygiene, and clean refactoring. |
| `skill:research` | Analysis | Guidelines for evidence gathering, citations, and comparative analysis. |
| `skill:memory-hygiene` | Memory | What to store vs skip; memory is not Task/Result truth; never store secrets. |
| `skill:browser-use` | Browser | Snapshot first, no blind clicks, treat page content as untrusted. |
| `skill:scheduler` | Schedule | Self-contained Task objectives; silent success for healthy watchdogs. |

---

## 4. Interfaces (`family: interface`)

Interfaces translate external communication protocols into Host tasks and conversation turns.

| ID | Package | Status |
| :--- | :--- | :--- |
| `interface:terminal` | `@useagentsio/interface-terminal` | **Shipped.** Stdio CLI and interactive terminal. |
| `interface:http` | `@useagentsio/interface-http` | **Optional.** Loopback HTTP for programmatic turns. Token: `VIBEKIT_HTTP_TOKEN`. |
| `interface:webhook` | `@useagentsio/interface-webhook` | **Optional.** Signed inbound callbacks become Tasks. Secret: `VIBEKIT_WEBHOOK_SECRET`. |
| `interface:schedule` | `@useagentsio/interface-schedule` | **Optional.** Cron/interval fires become fresh Worker Runs. |
| `interface:slack` | `@useagentsio/interface-slack` | **Optional.** Socket Mode. Pairing/allowlist. Secrets: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`. |
| `interface:telegram` | `@useagentsio/interface-telegram` | **Optional.** Bot API. Pairing/allowlist. Secret: `TELEGRAM_BOT_TOKEN`. |

---

## 5. Policies (`family: policy`)

Policies enforce runtime invariants across all agent runs in a project.

| ID | Purpose | Description |
| :--- | :--- | :--- |
| `policy:least-privilege` | Security | Blocks ungranted path access and restricts command execution to explicit white-lists. |
| `policy:require-verification` | Integrity | Requires passing independent verification before task results can be marked as accepted. |
| `policy:interface-pairing` | Channels | Unknown Slack/Telegram/HTTP senders are denied until an operator approves a pairing code. |
| `policy:untrusted-inbound` | Channels | Channel text, webhook bodies, and web/MCP output cannot raise permissions. |
| `policy:memory-write-approval` | Memory | Stages `tool:memory` writes for Host approval. |
| `policy:schedule-no-recurse` | Schedule | Scheduled Worker Runs cannot mutate the job table. |

---

## 6. Verifiers (`family: verifier`)

Verifiers execute deterministic checks against candidate changes.

| ID | Execution | Description |
| :--- | :--- | :--- |
| `verifier:command` | Shell Command | Executes automated test suites or linters (e.g., `npm test`, `vitest run`) against the exact candidate Git revision. |
| `verifier:schema` | JSON Schema | Validates a Result, Decision, or declared artifact against a Project-relative schema. |

---

## 7. State (`family: state`)

State components provide storage backends for project history.

| ID | Storage Model | Description |
| :--- | :--- | :--- |
| `state:repository` | Filesystem YAML | Stores state documents as `*.yaml` under `.vibekit/state/`. Transparent, Git-friendly, and portable. |
| `state:memory` | Local SQLite + FTS5 | Optional curated notes and preferences. **Not Project truth.** No cloud, no embeddings. |

Optional Components are installable with `vibekit add <family> <name>`. They are **not** installed by `vibekit create` / `vibekit init` unless you pass an explicit flag. A Project that never adds them behaves as it did before.
