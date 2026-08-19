# VibeKit Agents — Implementation TODOs

Optional Components shipped in `899ae8c`. Official Provider catalog expansion is in the current tree.

## Done

- Memory, interfaces, tools, policies, skills, `verifier:schema`, Host attach seams.
- **56 Provider Components** in `registry/components/provider/` (5 original + 51 imported from the OpenClaw/Hermes gap list).
- `packages/pi/src/models-catalog.ts` `OFFICIAL_PROVIDERS` lists Pi ids + secret names.
- `tests/registry/official.test.ts` and `docs/catalog/components.md` match `registry/index.json`.

Install with `vibekit add provider <name>`. `create` / `init` do not install extras unless `--provider` is passed. Modules are Pi config wrappers (secret reference + `piProvider`). They do not ship a second inference client.

## Pi id remaps (VibeKit name ≠ Pi name)

| VibeKit id | `piProvider` |
| :--- | :--- |
| `provider:azure` | `azure-openai-responses` |
| `provider:moonshot` | `moonshotai` |
| `provider:kimi` | `kimi-coding` |
| `provider:kimi-cn` | `moonshotai-cn` |

## Not imported (not VibeKit Provider Components)

Nous Portal, Copilot ACP, Claude CLI / Gemini CLI runtimes, Qwen OAuth, MiniMax OAuth, SuperGrok-only modules, ClawRouter, Hermes named `custom_providers` lists, embedding / image / TTS vendors.

## Follow-ups (optional)

- [ ] Confirm live `vibekit model` listing for vendors Pi already ships (Anthropic, Google, Groq, …) against a real key.
- [ ] For vendors Pi does **not** yet expose (Ollama local, vLLM, SGLang, Novita, Arcee, GMI, …), add a Pi custom-provider adapter only if a Project needs them at runtime. The registry entries already exist as declarations.
- [ ] Do not auto-install any of these from `create` / `init`.
