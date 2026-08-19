# VibeKit Agents — Implementation TODOs

Completed optional Components (memory, interfaces, tools, policies, skills, verifier:schema, Host attach seams) shipped in `899ae8c`. This file now tracks **missing Provider Components** only.

---

## Binding rules (providers)

These are **installable registry Components**, not Host features.

- Each provider is `registry/components/provider/<name>/1.0.0/`.
- Users opt in with `vibekit add provider <name>`. Do **not** auto-install from `create` / `init` unless the user passes `--provider`.
- A Provider Component **configures Pi**. It must not rebuild a provider runtime Pi already supplies. Map `piProvider` to Pi's existing id. Add a Pi-compatible custom adapter only when Pi has no matching provider.
- Secrets are environment **references** only (`{ name, source: environment }`). Never store secret values.
- Runtime stays in Pi. VibeKit files: `module.yaml`, `config.schema.json`, `payload/provider.yaml`.
- After add: `vibekit doctor` is clean, `vibekit list` reports `INSTALLED: yes`.
- Also register the Pi id + secret name in `packages/pi/src/models-catalog.ts` `OFFICIAL_PROVIDERS` so `vibekit model` can list it.
- Rebuild `registry/index.json` (`pnpm registry:index`) and add the id to `tests/registry/official.test.ts`.
- Do **not** add Agent recipes.

Copy this existing module as the template: `registry/components/provider/openai/1.0.0/`.

### Exact import recipe (every API-key provider below)

For each missing id, do **all** of the following:

1. Confirm Pi already exposes the provider (`vibekit model` / Pi `ModelRuntime.getProviders()`). If yes, `piProvider` is that id. If no, stop and either wait for a Pi upgrade or add a Pi custom-provider adapter (see "Pi-missing" notes). Do not invent a second VibeKit inference client.
2. Create `registry/components/provider/<name>/1.0.0/module.yaml` from `provider:openai`:
   - `id: provider:<name>`
   - `type: provider`
   - `providesCapabilities: [provider.<name>]` (capability id: letters, digits, `.` or `-` only)
   - `secrets: [{ name: <ENV>, required: true|false, source: environment }]`
   - `files[0].target: .vibekit/components/providers/<name>.yaml`
   - `configuration.target: .vibekit/config/providers/<name>.yaml`
   - `healthCheck: { type: pi-provider, name: <piProvider> }`
3. Create `payload/provider.yaml`:

   ```yaml
   id: provider:<name>
   piProvider: <pi-id>
   description: Maps to the <Vendor> provider already supplied by Pi. Does not ship a replacement runtime.
   secretName: <ENV>
   defaultModel: <safe default from Pi catalog>
   ```

   For OAuth-only (no env key): omit `secretName`, set `auth: oauth`, `secrets: []` (see `provider:openai-codex`).
4. Create `config.schema.json` with optional `model` and `baseUrl` strings (`additionalProperties: false`), matching `provider:openai`.
5. Append `{ id, name, secretName }` to `OFFICIAL_PROVIDERS` in `packages/pi/src/models-catalog.ts`.
6. Add `provider:<name>` to `officialIds` in `tests/registry/official.test.ts`.
7. Run `pnpm registry:index` and a focused test: `pnpm test tests/registry/official.test.ts`.
8. Document the id, secret, and default model in `docs/catalog/components.md` and the README official catalog table.

Do **not** add the provider to Host/core/pi dependencies. Do **not** write API keys into YAML.

---

## Already in the official registry (do not re-add)

| VibeKit id | Pi id | Auth | Notes |
| :--- | :--- | :--- | :--- |
| `provider:openai` | `openai` | `OPENAI_API_KEY` | Direct OpenAI API. |
| `provider:openai-codex` | `openai-codex` | Pi `/login` OAuth | ChatGPT / Codex. No env secret. |
| `provider:opencode-go` | `opencode-go` | `OPENCODE_API_KEY` | OpenCode Go. |
| `provider:xai` | `xai` | `XAI_API_KEY` (optional; Pi OAuth preferred) | Grok. |
| `provider:openrouter` | `openrouter` | `OPENROUTER_API_KEY` | Multi-model router. |

---

## Source catalogs (review)

### OpenClaw official / bundled providers

Anthropic (`ANTHROPIC_API_KEY`), OpenAI + ChatGPT/Codex OAuth, OpenCode Zen (`OPENCODE_API_KEY` / `OPENCODE_ZEN_API_KEY`), OpenCode Go, Google Gemini (`GEMINI_API_KEY` / `GOOGLE_API_KEY`), Google Vertex, Google Gemini CLI runtime, Z.AI (`ZAI_API_KEY`), Vercel AI Gateway (`AI_GATEWAY_API_KEY`), Arcee, BytePlus / BytePlus Plan, Cerebras, Chutes, ClawRouter, Cohere, DeepInfra, DeepSeek, Featherless, GitHub Copilot, GMI Cloud, Groq, Hugging Face, MiniMax / MiniMax Portal, Mistral, Moonshot, NVIDIA, Novita, Ollama Cloud, OpenRouter, Qianfan, Tencent TokenHub, Together, Venice, Volcengine / Volcengine Plan, xAI, Xiaomi / Xiaomi Token Plan, Kimi Coding (`KIMI_API_KEY`), Synthetic, LM Studio (`LM_API_TOKEN`), Ollama (local), vLLM, SGLang, plus custom `models.providers` OpenAI/Anthropic-compatible endpoints.

### Hermes bundled providers

Nous Portal (OAuth), OpenAI Codex (ChatGPT OAuth), OpenAI API (`openai-api` + `OPENAI_API_KEY`), GitHub Copilot + Copilot ACP, Anthropic (OAuth / `ANTHROPIC_API_KEY` / setup-token), OpenRouter, Fireworks (`FIREWORKS_API_KEY`), Novita, Vercel AI Gateway (`ai-gateway`), Z.AI (`GLM_API_KEY`), Kimi Coding / Kimi CN, Arcee, GMI, Actual Computer, MiniMax / MiniMax CN / MiniMax OAuth, xAI key + SuperGrok OAuth, Alibaba DashScope / Alibaba Coding Plan (`DASHSCOPE_API_KEY`), Kilo Code, Xiaomi, Tencent TokenHub, OpenCode Zen, OpenCode Go (`OPENCODE_GO_API_KEY`), CommandCode, DeepSeek, Hugging Face (`HF_TOKEN`), Gemini (`GOOGLE_API_KEY`), Vertex AI, Azure Foundry, AWS Bedrock, NVIDIA NIM, Ollama Cloud, Qwen OAuth, StepFun, LM Studio, Meta Model API (`MODEL_API_KEY`), custom OpenAI-compatible endpoint, plus local Ollama / vLLM via custom base URL.

---

## Priority 1 — import first (Pi already has these, or should)

These are the high-value gaps vs both catalogs. Most are API-key wrappers around a Pi provider. Import with the recipe above.

| Proposed id | Pi id (confirm) | Secret reference | Default model (confirm against live Pi catalog) | Source |
| :--- | :--- | :--- | :--- | :--- |
| `provider:anthropic` | `anthropic` | `ANTHROPIC_API_KEY` (required). OAuth stays in Pi `/login` like Codex — do not store tokens. | First Claude model from Pi catalog | Both |
| `provider:google` | `google` or `gemini` (use whatever Pi reports) | `GEMINI_API_KEY` required; document `GOOGLE_API_KEY` as alias in description only (one secret name in `module.yaml`) | First Gemini model from Pi catalog | Both |
| `provider:github-copilot` | `github-copilot` or `copilot` | `COPILOT_GITHUB_TOKEN` required; description may mention `GH_TOKEN` / `GITHUB_TOKEN` fallbacks Pi already reads | First Copilot catalog model | Both |
| `provider:groq` | `groq` | `GROQ_API_KEY` | First Groq model from Pi catalog | OpenClaw (Hermes via custom/HF) |
| `provider:mistral` | `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` if present | OpenClaw |
| `provider:deepseek` | `deepseek` | `DEEPSEEK_API_KEY` | First DeepSeek model from Pi catalog | Both |
| `provider:huggingface` | `huggingface` | `HF_TOKEN` (or `HUGGINGFACE_HUB_TOKEN` if that is what Pi uses — match Pi) | First HF router model from Pi catalog | Both |
| `provider:cerebras` | `cerebras` | `CEREBRAS_API_KEY` | First Cerebras model from Pi catalog | OpenClaw |
| `provider:minimax` | `minimax` | `MINIMAX_API_KEY` | First MiniMax chat model from Pi catalog | Both |
| `provider:moonshot` | `moonshot` or `kimi` | `MOONSHOT_API_KEY` | First Kimi model from Pi catalog | Both |
| `provider:nvidia` | `nvidia` | `NVIDIA_API_KEY` | First NIM model from Pi catalog | Both |
| `provider:azure` | `azure` or `azure-foundry` | `AZURE_OPENAI_API_KEY` (or whatever Pi names) | Require `baseUrl` in config.schema (`required: ["baseUrl"]` if Pi needs an endpoint) | Hermes |
| `provider:amazon-bedrock` | `amazon-bedrock` or `bedrock` | No API key if Pi uses the AWS default chain. `secrets: []`. Document `AWS_REGION` / `AWS_PROFILE` as process env, not YAML. | First Bedrock model from Pi catalog | Both |
| `provider:ollama` | `ollama` | none (`secrets: []`). Local. | Require `baseUrl` default `http://127.0.0.1:11434/v1` in `provider.yaml` + config schema | Both |
| `provider:opencode` | `opencode` (Zen, distinct from `opencode-go`) | `OPENCODE_API_KEY` or `OPENCODE_ZEN_API_KEY` — use the name Pi expects | First Zen model from Pi catalog | Both |

### Extra steps unique to Priority 1

- **`provider:anthropic`**: If Pi supports Claude Pro/Max OAuth, follow `provider:openai-codex` (`auth: oauth`, empty `secrets`) *or* ship API-key as the VibeKit module and leave OAuth to Pi `/login`. Do not implement a VibeKit OAuth flow.
- **`provider:google`**: One module only. Do not also add `provider:gemini`. Put Vertex / Gemini CLI in Priority 3.
- **`provider:github-copilot`**: Do not import Hermes `copilot-acp` (local CLI subprocess). That is not a Pi provider.
- **`provider:amazon-bedrock`**: No secret values. If Pi requires a region, add optional `region` to `config.schema.json` only.
- **`provider:ollama`**: `secrets` empty; `secretName` omitted. `required: false` for any dummy key. Health-check name must match Pi (`ollama`).
- **`provider:opencode`**: Do not collide with existing `provider:opencode-go`. Different `piProvider`.

---

## Priority 2 — import next (both catalogs, OpenAI-compatible)

Same recipe. Confirm Pi id before authoring. If Pi has no row, skip until Pi adds it (do not write a VibeKit HTTP client).

| Proposed id | Likely secret | Likely base (document only; Pi owns the URL) | Source |
| :--- | :--- | :--- | :--- |
| `provider:zai` | `ZAI_API_KEY` (Hermes also uses `GLM_API_KEY` — pick the name Pi uses) | Z.AI global / coding endpoint | Both |
| `provider:novita` | `NOVITA_API_KEY` | `https://api.novita.ai/openai/v1` | Both |
| `provider:vercel-ai-gateway` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/v1` | Both |
| `provider:arcee` | `ARCEEAI_API_KEY` | Arcee OpenAI-compat | Both |
| `provider:gmi` | `GMI_API_KEY` | `https://api.gmi-serving.com/v1` | Both |
| `provider:xiaomi` | `XIAOMI_API_KEY` | Xiaomi MiMo | Both |
| `provider:tencent-tokenhub` | `TOKENHUB_API_KEY` | TokenHub | Both |
| `provider:ollama-cloud` | `OLLAMA_API_KEY` | `https://ollama.com/v1` | Both |
| `provider:lmstudio` | `LM_API_KEY` or `LM_API_TOKEN` (match Pi) | `http://localhost:1234/v1` | Both |
| `provider:together` | `TOGETHER_API_KEY` | Together OpenAI-compat | OpenClaw |
| `provider:fireworks` | `FIREWORKS_API_KEY` | `https://api.fireworks.ai/inference/v1` | Hermes |
| `provider:kimi` | `KIMI_API_KEY` | Moonshot Anthropic-compat coding endpoint | Both (Hermes `kimi-coding`) |
| `provider:alibaba` | `DASHSCOPE_API_KEY` | DashScope compatible-mode `/v1` | Hermes (OpenClaw Qwen Cloud) |
| `provider:stepfun` | `STEPFUN_API_KEY` | `https://api.stepfun.com/v1` | Hermes |
| `provider:cohere` | `COHERE_API_KEY` | Cohere | OpenClaw |
| `provider:deepinfra` | `DEEPINFRA_API_KEY` | DeepInfra | OpenClaw |

If two source names map to one Pi id (e.g. `zai` vs `glm`, `kimi` vs `moonshot`), ship **one** VibeKit module using Pi's id. Mention the alias in `description` only.

---

## Priority 3 — import only after Pi has a provider id

Do not author these until `ModelRuntime.getProviders()` lists them, or until there is an explicit Pi custom-provider adapter in a later task.

| Proposed id | Why it waits | If/when Pi adds it |
| :--- | :--- | :--- |
| `provider:google-vertex` | ADC / service-account JSON path; not a single env key | Follow Bedrock: `secrets: []`, config `project` + `region` as non-secret fields |
| `provider:alibaba-coding-plan` | Separate DashScope billing SKU / base URL | Same `DASHSCOPE_API_KEY` as `provider:alibaba`, different `piProvider` |
| `provider:minimax-cn` | China endpoint + `MINIMAX_CN_API_KEY` | Clone `provider:minimax` with CN secret + `piProvider` |
| `provider:kimi-cn` | `KIMI_CN_API_KEY` | Clone `provider:kimi` |
| `provider:byteplus` / `provider:byteplus-plan` | OpenClaw plugin, China-intl ARK | API key `BYTEPLUS_API_KEY` |
| `provider:volcengine` / `provider:volcengine-plan` | Doubao / ARK CN | `VOLCANO_ENGINE_API_KEY` |
| `provider:chutes` | OpenClaw-only | `CHUTES_API_KEY` |
| `provider:qianfan` | OpenClaw-only | `QIANFAN_API_KEY` |
| `provider:featherless` | OpenClaw-only | `FEATHERLESS_API_KEY` |
| `provider:venice` | OpenClaw-only | `VENICE_API_KEY` |
| `provider:synthetic` | OpenClaw Anthropic-compat proxy | `SYNTHETIC_API_KEY` |
| `provider:kilocode` | Hermes-only | `KILOCODE_API_KEY` |
| `provider:commandcode` | Hermes-only | `COMMANDCODE_API_KEY` |
| `provider:meta-ai` | Hermes-only | `MODEL_API_KEY` |
| `provider:actual` | Hermes-only cluster/relay | `ACTUAL_API_KEY` optional on loopback |
| `provider:vllm` | Local server | Empty secrets; `baseUrl` default `http://127.0.0.1:8000/v1` |
| `provider:sglang` | Local server | Empty secrets; `baseUrl` default `http://127.0.0.1:30000/v1` |
| `provider:custom` | Generic OpenAI-compat | Required `baseUrl` in config; optional `CUSTOM_API_KEY` |

---

## Do not import (not VibeKit Provider Components)

These are not registry `provider:*` modules. Leave them out.

| Source item | Why |
| :--- | :--- |
| Nous Portal | Hermes subscription gateway + OAuth store. Not a Pi provider. |
| Copilot ACP | Spawns local `copilot --acp --stdio`. Not a model vendor. |
| Claude CLI / Gemini CLI runtimes | OpenClaw agent-runtime backends, not Provider Components. |
| Qwen OAuth, MiniMax OAuth, SuperGrok-only modules | Consumer OAuth portals. If Pi already covers xAI OAuth, keep using `provider:xai`. Do not add parallel OAuth modules. |
| OpenClaw ClawRouter | Their router product, not a vendor. Users who need it can use `provider:custom` later. |
| Named Hermes `custom_providers` lists | Project config, not official registry modules. |
| Embedding / image / TTS vendors | Not inference Providers in the VibeKit family. |

---

## Suggested first slice

Implement Priority 1 in this order so `vibekit add provider …` covers the common gap vs OpenClaw/Hermes without new runtimes:

1. `provider:anthropic`
2. `provider:google`
3. `provider:deepseek`
4. `provider:groq`
5. `provider:mistral`
6. `provider:huggingface`
7. `provider:ollama`
8. `provider:github-copilot`
9. `provider:minimax`
10. `provider:moonshot`
11. `provider:nvidia`
12. `provider:cerebras`
13. `provider:opencode` (Zen; keep `opencode-go`)
14. `provider:azure`
15. `provider:amazon-bedrock`

Then run `pnpm registry:index`, `pnpm typecheck`, and `pnpm test`.
