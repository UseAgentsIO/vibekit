import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface CatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}

export interface CatalogProvider {
  readonly id: string;
  readonly name: string;
  readonly secretName: string;
}

export const OFFICIAL_PROVIDERS: readonly CatalogProvider[] = [
  { id: "actual", name: "Actual Computer", secretName: "ACTUAL_API_KEY" },
  { id: "alibaba", name: "Alibaba DashScope", secretName: "DASHSCOPE_API_KEY" },
  { id: "alibaba-coding-plan", name: "Alibaba Coding Plan", secretName: "DASHSCOPE_API_KEY" },
  { id: "amazon-bedrock", name: "Amazon Bedrock", secretName: "AWS_REGION" },
  { id: "anthropic", name: "Anthropic", secretName: "ANTHROPIC_API_KEY" },
  { id: "arcee", name: "Arcee", secretName: "ARCEEAI_API_KEY" },
  { id: "azure-openai-responses", name: "Azure OpenAI", secretName: "AZURE_OPENAI_API_KEY" },
  { id: "byteplus", name: "BytePlus", secretName: "BYTEPLUS_API_KEY" },
  { id: "byteplus-plan", name: "BytePlus Plan", secretName: "BYTEPLUS_API_KEY" },
  { id: "cerebras", name: "Cerebras", secretName: "CEREBRAS_API_KEY" },
  { id: "chutes", name: "Chutes", secretName: "CHUTES_API_KEY" },
  { id: "cohere", name: "Cohere", secretName: "COHERE_API_KEY" },
  { id: "commandcode", name: "CommandCode", secretName: "COMMANDCODE_API_KEY" },
  { id: "custom", name: "Custom endpoint", secretName: "CUSTOM_API_KEY" },
  { id: "deepinfra", name: "DeepInfra", secretName: "DEEPINFRA_API_KEY" },
  { id: "deepseek", name: "DeepSeek", secretName: "DEEPSEEK_API_KEY" },
  { id: "featherless", name: "Featherless", secretName: "FEATHERLESS_API_KEY" },
  { id: "fireworks", name: "Fireworks", secretName: "FIREWORKS_API_KEY" },
  { id: "github-copilot", name: "GitHub Copilot", secretName: "COPILOT_GITHUB_TOKEN" },
  { id: "gmi", name: "GMI Cloud", secretName: "GMI_API_KEY" },
  { id: "google", name: "Google", secretName: "GEMINI_API_KEY" },
  { id: "google-vertex", name: "Google Vertex AI", secretName: "VERTEX_PROJECT_ID" },
  { id: "groq", name: "Groq", secretName: "GROQ_API_KEY" },
  { id: "huggingface", name: "Hugging Face", secretName: "HF_TOKEN" },
  { id: "kilocode", name: "Kilo Code", secretName: "KILOCODE_API_KEY" },
  { id: "kimi-coding", name: "Kimi For Coding", secretName: "KIMI_API_KEY" },
  { id: "lmstudio", name: "LM Studio", secretName: "LM_API_TOKEN" },
  { id: "meta-ai", name: "Meta Model API", secretName: "MODEL_API_KEY" },
  { id: "minimax", name: "MiniMax", secretName: "MINIMAX_API_KEY" },
  { id: "minimax-cn", name: "MiniMax CN", secretName: "MINIMAX_CN_API_KEY" },
  { id: "mistral", name: "Mistral", secretName: "MISTRAL_API_KEY" },
  { id: "moonshotai", name: "Moonshot AI", secretName: "MOONSHOT_API_KEY" },
  { id: "moonshotai-cn", name: "Moonshot AI CN", secretName: "KIMI_CN_API_KEY" },
  { id: "novita", name: "Novita", secretName: "NOVITA_API_KEY" },
  { id: "nvidia", name: "NVIDIA", secretName: "NVIDIA_API_KEY" },
  { id: "ollama", name: "Ollama", secretName: "OLLAMA_HOST" },
  { id: "ollama-cloud", name: "Ollama Cloud", secretName: "OLLAMA_API_KEY" },
  { id: "openai", name: "OpenAI", secretName: "OPENAI_API_KEY" },
  { id: "openai-codex", name: "OpenAI Codex", secretName: "OPENAI_API_KEY" },
  { id: "opencode", name: "OpenCode Zen", secretName: "OPENCODE_ZEN_API_KEY" },
  { id: "opencode-go", name: "OpenCode Go", secretName: "OPENCODE_API_KEY" },
  { id: "openrouter", name: "OpenRouter", secretName: "OPENROUTER_API_KEY" },
  { id: "qianfan", name: "Qianfan", secretName: "QIANFAN_API_KEY" },
  { id: "sglang", name: "SGLang", secretName: "SGLANG_API_KEY" },
  { id: "stepfun", name: "StepFun", secretName: "STEPFUN_API_KEY" },
  { id: "synthetic", name: "Synthetic", secretName: "SYNTHETIC_API_KEY" },
  { id: "tencent-tokenhub", name: "Tencent TokenHub", secretName: "TOKENHUB_API_KEY" },
  { id: "together", name: "Together", secretName: "TOGETHER_API_KEY" },
  { id: "venice", name: "Venice", secretName: "VENICE_API_KEY" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", secretName: "AI_GATEWAY_API_KEY" },
  { id: "vllm", name: "vLLM", secretName: "VLLM_API_KEY" },
  { id: "volcengine", name: "Volcengine", secretName: "VOLCANO_ENGINE_API_KEY" },
  { id: "volcengine-plan", name: "Volcengine Plan", secretName: "VOLCANO_ENGINE_API_KEY" },
  { id: "xai", name: "xAI", secretName: "XAI_API_KEY" },
  { id: "xiaomi", name: "Xiaomi", secretName: "XIAOMI_API_KEY" },
  { id: "zai", name: "Z.AI", secretName: "ZAI_API_KEY" },
];

export function secretNameForProvider(provider: string): string {
  return (
    OFFICIAL_PROVIDERS.find((entry) => entry.id === provider)?.secretName ??
    `${provider.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`
  );
}

export interface ModelCatalog {
  listProviders(): readonly CatalogProvider[];
  listModels(provider: string): Promise<readonly CatalogModel[]>;
  findModel(provider: string, id: string): CatalogModel | undefined;
  hasAuth(provider: string): boolean;
  saveApiKey(provider: string, apiKey: string): Promise<void>;
}

export async function openModelCatalog(options?: {
  readonly allowNetwork?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<ModelCatalog> {
  const allowNetwork = options?.allowNetwork !== false;
  const runtime = await ModelRuntime.create({
    allowModelNetwork: allowNetwork,
    refreshOnCreate: allowNetwork,
  });

  return {
    listProviders() {
      const fromPi = runtime.getProviders().map((provider) => {
        const id = String(
          (provider as { id?: string }).id ??
            (provider as { name?: string }).name ??
            "",
        );
        return {
          id,
          name: String((provider as { name?: string }).name ?? id),
          secretName: secretNameForProvider(id),
        };
      }).filter((provider) => provider.id.length > 0);
      const seen = new Set(fromPi.map((provider) => provider.id));
      return [
        ...OFFICIAL_PROVIDERS.filter((provider) => seen.has(provider.id) || fromPi.length === 0),
        ...fromPi.filter((provider) => !OFFICIAL_PROVIDERS.some((official) => official.id === provider.id)),
      ];
    },
    async listModels(provider: string) {
      let models: readonly { id: string; name?: string; provider?: string }[] = [];
      try {
        models = await runtime.getAvailable(provider);
      } catch {
        models = [];
      }
      if (models.length === 0) {
        models = runtime.getModels(provider);
      }
      return models.map((model) => ({
        provider,
        id: model.id,
        name: model.name ?? model.id,
      }));
    },
    findModel(provider: string, id: string) {
      const model = runtime.getModel(provider, id);
      if (model === undefined) {
        return undefined;
      }
      return { provider, id: model.id, name: model.name ?? model.id };
    },
    hasAuth(provider: string) {
      return runtime.hasConfiguredAuth(provider);
    },
    async saveApiKey(provider: string, apiKey: string) {
      await runtime.setRuntimeApiKey(provider, apiKey);
    },
  };
}
