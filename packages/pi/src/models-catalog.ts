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
  { id: "openai", name: "OpenAI", secretName: "OPENAI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", secretName: "OPENROUTER_API_KEY" },
  { id: "xai", name: "xAI", secretName: "XAI_API_KEY" },
  { id: "openai-codex", name: "OpenAI Codex", secretName: "OPENAI_API_KEY" },
  { id: "opencode-go", name: "OpenCode Go", secretName: "OPENCODE_API_KEY" },
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
