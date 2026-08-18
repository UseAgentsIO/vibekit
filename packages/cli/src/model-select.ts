import { VibeKitError } from "@useagentsio/core";
import { readDeploymentSecrets, writeDeploymentSecret } from "@useagentsio/host";
import {
  OFFICIAL_PROVIDERS,
  openModelCatalog,
  secretNameForProvider,
  type CatalogModel,
  type CatalogProvider,
  type ModelCatalog,
} from "@useagentsio/pi";

import type { OutputBuffer } from "./output.js";
import { askLine, canPrompt, pickChoice, say } from "./prompt.js";

const LIST_LIMIT = 40;

export interface SelectedModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}

export async function selectProviderAndModel(input: {
  readonly out: OutputBuffer;
  readonly projectId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly yes: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<SelectedModel> {
  const catalog = await openModelCatalog({ allowNetwork: true, env: input.env });
  const provider = await resolveProvider(input, catalog);
  await ensureProviderSecret(input, catalog, provider);
  return resolveModel(input, catalog, provider);
}

async function resolveProvider(
  input: {
    readonly out: OutputBuffer;
    readonly provider?: string;
    readonly yes: boolean;
  },
  catalog: ModelCatalog,
): Promise<CatalogProvider> {
  if (input.provider !== undefined) {
    return (
      OFFICIAL_PROVIDERS.find((entry) => entry.id === input.provider) ?? {
        id: input.provider,
        name: input.provider,
        secretName: secretNameForProvider(input.provider),
      }
    );
  }
  if (input.yes || !canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "provider_required",
      message: "Pass --provider, or run create/model in a terminal to pick one",
    });
  }

  const extras = catalog
    .listProviders()
    .filter((provider) => !OFFICIAL_PROVIDERS.some((official) => official.id === provider.id));
  const more: CatalogProvider = {
    id: "__more__",
    name: "More providers",
    secretName: "",
  };
  const firstPage = extras.length > 0 ? [...OFFICIAL_PROVIDERS, more] : [...OFFICIAL_PROVIDERS];
  const picked = await pickChoice(
    "Choose a provider",
    firstPage.map((provider) => ({
      label: provider.id === "__more__" ? provider.name : `${provider.name} (${provider.id})`,
      value: provider,
      id: provider.id,
    })),
  );
  if (picked.id !== "__more__") {
    return picked;
  }
  return pickChoice(
    "All providers",
    extras.map((provider) => ({
      label: `${provider.name} (${provider.id})`,
      value: provider,
      id: provider.id,
    })),
  );
}

async function resolveModel(
  input: {
    readonly out: OutputBuffer;
    readonly model?: string;
    readonly yes: boolean;
    readonly env?: NodeJS.ProcessEnv;
  },
  catalog: ModelCatalog,
  provider: CatalogProvider,
): Promise<SelectedModel> {
  if (input.model !== undefined) {
    const known = catalog.findModel(provider.id, input.model);
    if (known !== undefined) {
      return known;
    }
    say(`Using ${provider.id} / ${input.model} (not in Pi's current catalog)`);
    return { provider: provider.id, id: input.model, name: input.model };
  }
  if (input.yes || !canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "model_required",
      message: "Pass --model, or run in a terminal to pick from the live list",
    });
  }

  say(`Loading models for ${provider.name}...`);
  let models = [...(await catalog.listModels(provider.id))];
  if (models.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "models_unavailable",
      message: `Pi has no models for ${provider.id}. Check that the provider is authenticated.`,
    });
  }

  if (models.length > LIST_LIMIT) {
    const filter = await askLine(
      `${models.length} models. Type a filter, or press enter for the first ${LIST_LIMIT}`,
    );
    if (filter.length > 0) {
      const needle = filter.toLowerCase();
      models = models.filter(
        (model) =>
          model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle),
      );
    } else {
      models = models.slice(0, LIST_LIMIT);
    }
  }

  return pickChoice(
    `Choose a ${provider.name} model`,
    models.map((model) => ({
      label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
      value: model,
      id: model.id,
    })),
  );
}

async function ensureProviderSecret(
  input: {
    readonly out: OutputBuffer;
    readonly projectId: string;
    readonly yes: boolean;
    readonly env?: NodeJS.ProcessEnv;
  },
  catalog: ModelCatalog,
  provider: CatalogProvider,
): Promise<void> {
  const env = input.env ?? process.env;
  const stored = readDeploymentSecrets(input.projectId)[provider.secretName];
  const fromEnv = env[provider.secretName];
  const existing =
    (typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : undefined) ??
    (typeof stored === "string" && stored.length > 0 ? stored : undefined);

  if (existing !== undefined) {
    process.env[provider.secretName] = existing;
    if (!catalog.hasAuth(provider.id)) {
      await catalog.saveApiKey(provider.id, existing);
    }
    return;
  }

  if (catalog.hasAuth(provider.id)) {
    return;
  }

  if (input.yes || !canPrompt()) {
    say(`${provider.secretName} is not set. ${provider.name} calls will fail until it is.`);
    return;
  }
  const value = await askLine(
    `${provider.secretName} is not set. Paste a key (saved to Pi's auth store)`,
  );
  if (value.length === 0) {
    return;
  }
  writeDeploymentSecret(input.projectId, provider.secretName, value);
  process.env[provider.secretName] = value;
  await catalog.saveApiKey(provider.id, value);
  say(`Saved ${provider.name} credentials to Pi (~/.pi/agent/auth.json).`);
}

export function formatSelectedModel(model: SelectedModel): string {
  return `Using ${model.provider} / ${model.id}`;
}
