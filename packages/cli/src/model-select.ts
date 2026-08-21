import { VibeKitError, type Registry } from "./internal/core/index.js";
import { readDeploymentSecrets, writeDeploymentSecret } from "./internal/host/index.js";
import {
  OFFICIAL_PROVIDERS,
  openModelCatalog,
  secretNameForProvider,
  type CatalogProvider,
  type ModelCatalog,
} from "./internal/pi/index.js";

import type { OutputBuffer } from "./output.js";
import { canPrompt, say } from "./prompt.js";
import { setupItemsFromRegistry } from "./setup-catalog.js";
import { BACK, isSubmit, resolveSelect, select, submit, text, type PromptResult } from "./ui/index.js";

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
  readonly verbose?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly registry?: Registry;
}): Promise<PromptResult<SelectedModel>> {
  if (input.provider !== undefined && input.model !== undefined) {
    return submit({
      provider: input.provider,
      id: input.model,
      name: input.model,
    }, 0);
  }

  const catalog = await openModelCatalog({ allowNetwork: true, env: input.env });

  for (;;) {
    const provider = await resolveProvider(input, catalog);
    if (!isSubmit(provider)) {
      return BACK;
    }
    const secret = await ensureProviderSecret(input, catalog, provider.value);
    if (!isSubmit(secret)) {
      if (input.provider !== undefined) {
        return BACK;
      }
      continue;
    }
    const model = await resolveModel(input, catalog, provider.value);
    if (!isSubmit(model)) {
      if (input.provider !== undefined && secret.asked !== true) {
        return BACK;
      }
      continue;
    }
    return submit(model.value);
  }
}

async function resolveProvider(
  input: {
    readonly out: OutputBuffer;
    readonly provider?: string;
    readonly yes: boolean;
    readonly verbose?: boolean;
    readonly registry?: Registry;
  },
  catalog: ModelCatalog,
): Promise<PromptResult<CatalogProvider>> {
  if (input.provider !== undefined) {
    return submit(
      OFFICIAL_PROVIDERS.find((entry) => entry.id === input.provider) ?? {
        id: input.provider,
        name: input.provider,
        secretName: secretNameForProvider(input.provider),
      },
      0,
    );
  }
  if (input.yes || !canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "provider_required",
      message: "Pass --provider, or run setup in a terminal to pick a model connection",
    });
  }

  const registryItems = providerItems(input.registry);
  const menuIds = orderedProviderIds(registryItems);
  const extras = catalog
    .listProviders()
    .filter((provider) => !menuIds.includes(provider.id));
  const moreId = "__more__";
  const officialById = new Map(OFFICIAL_PROVIDERS.map((provider) => [provider.id, provider]));
  const labels = new Map(registryItems.map((item) => [item.id, friendlyProviderLabel(item.label)]));
  const descriptions = new Map(
    registryItems.flatMap((item) =>
      item.description === undefined
        ? []
        : [[item.id, friendlyProviderDescription(item.description)]],
    ),
  );

  for (;;) {
    const firstPage = extras.length > 0 ? [...menuIds, moreId] : menuIds;
    const picked = await select({
      message: "Model connection",
      description: "Which model service should this project use?",
      searchable: true,
      options: firstPage.map((id) =>
        id === moreId
          ? { value: moreId, label: "More providers", id: moreId }
          : {
              value: id,
              label: labels.get(id) ?? friendlyProviderLabel(officialById.get(id)?.name ?? id),
              id,
              hint: input.verbose === true ? id : descriptions.get(id),
            },
      ),
    });
    if (!isSubmit(picked) || picked.value === undefined) {
      return BACK;
    }
    if (picked.value !== moreId) {
      const id = picked.value;
      return submit(
        officialById.get(id) ?? { id, name: labels.get(id) ?? id, secretName: secretNameForProvider(id) },
      );
    }
    const extra = await select({
      message: "Model connection",
      searchable: "type",
      options: extras.map((provider) => ({
        value: provider,
        label: friendlyProviderLabel(provider.name),
        id: provider.id,
        hint: input.verbose === true ? provider.id : undefined,
      })),
    });
    if (!isSubmit(extra) || extra.value === undefined) {
      continue;
    }
    return submit(extra.value);
  }
}

const DEFAULT_MODELS: Readonly<Record<string, string>> = {
  openai: "gpt-4.1",
  "openai-codex": "gpt-5-codex",
  xai: "grok-4",
  openrouter: "openai/gpt-4.1",
  "opencode-go": "opencode",
};

async function resolveModel(
  input: {
    readonly out: OutputBuffer;
    readonly model?: string;
    readonly yes: boolean;
    readonly verbose?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  },
  catalog: ModelCatalog,
  provider: CatalogProvider,
): Promise<PromptResult<SelectedModel>> {
  if (input.model !== undefined) {
    const known = catalog.findModel(provider.id, input.model);
    if (known !== undefined) {
      return submit(known, 0);
    }
    return submit({ provider: provider.id, id: input.model, name: input.model }, 0);
  }
  if (input.yes || !canPrompt()) {
    const selected = await resolveDefaultModel(catalog, provider);
    if (selected !== undefined) {
      return submit(selected, 0);
    }
    throw new VibeKitError({
      category: "invalid_input",
      code: "model_required",
      message: "Pass --model, or run in a terminal to pick from the live list",
    });
  }

  const models = [...(await catalog.listModels(provider.id))];
  if (models.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "models_unavailable",
      message: `Pi has no models for ${provider.id}. Check that the provider is authenticated.`,
    });
  }

  const picked = await select({
    message: "Model",
    searchable: "type",
    manual: {
      parse: (raw) => ({ provider: provider.id, id: raw, name: raw }),
    },
    options: models.map((model) => ({
      value: model,
      label: model.name,
      id: model.id,
      hint: input.verbose === true && model.name !== model.id ? model.id : undefined,
    })),
  });
  if (!isSubmit(picked) || picked.value === undefined) {
    return BACK;
  }
  return submit(picked.value);
}

async function resolveDefaultModel(
  catalog: ModelCatalog,
  provider: CatalogProvider,
): Promise<SelectedModel | undefined> {
  let models: readonly SelectedModel[] = [];
  try {
    models = await catalog.listModels(provider.id);
  } catch {
    models = [];
  }
  const first = models[0];
  if (first !== undefined) {
    return first;
  }
  const id = DEFAULT_MODELS[provider.id];
  if (id === undefined) {
    return undefined;
  }
  return { provider: provider.id, id, name: id };
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
): Promise<PromptResult<void> & { readonly asked?: boolean }> {
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
    return { ...submit(undefined, 0), asked: false };
  }

  if (catalog.hasAuth(provider.id)) {
    return { ...submit(undefined, 0), asked: false };
  }

  if (input.yes || !canPrompt()) {
    say(`${provider.secretName} is not set. ${provider.name} calls will fail until it is.`);
    return { ...submit(undefined, 0), asked: false };
  }
  const value = await text({
    message: `${provider.name} API key`,
    secret: true,
    collapse: "saved",
  });
  if (!isSubmit(value)) {
    return { ...BACK, asked: true };
  }
  if (value.value.length === 0) {
    return { ...submit(undefined), asked: true };
  }
  writeDeploymentSecret(input.projectId, provider.secretName, value.value);
  process.env[provider.secretName] = value.value;
  await catalog.saveApiKey(provider.id, value.value);
  return { ...submit(undefined), asked: true };
}

export function formatSelectedModel(model: SelectedModel): string {
  return `Using ${model.provider} / ${model.id}`;
}

export function formatModelSummary(model: SelectedModel, providerName?: string): string {
  const via = providerName ?? providerDisplayName(model.provider);
  return `${model.name} via ${via}`;
}

export function providerDisplayName(id: string): string {
  return OFFICIAL_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
}

export async function pickProviderId(input: {
  readonly value?: string;
  readonly interactive: boolean;
  readonly verbose?: boolean;
  readonly registry?: Registry;
}): Promise<PromptResult<string | undefined>> {
  const items = providerItems(input.registry);
  const ids = orderedProviderIds(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const officialById = new Map(OFFICIAL_PROVIDERS.map((provider) => [provider.id, provider]));
  return resolveSelect({
    message: "Model connection",
    description: "Which model service should this project use?",
    value: input.value,
    interactive: input.interactive,
    skippable: true,
    searchable: true,
    noneLabel: "None",
    options: ids.map((id) => ({
      value: id,
      label: friendlyProviderLabel(byId.get(id)?.label ?? officialById.get(id)?.name ?? id),
      id,
      hint: input.verbose === true ? id : friendlyProviderDescription(byId.get(id)?.description),
    })),
  });
}

function providerItems(registry: Registry | undefined) {
  return setupItemsFromRegistry([], registry, "provider");
}

function friendlyProviderLabel(label: string): string {
  return label.replace(/\s+Provider$/i, "");
}

function friendlyProviderDescription(description: string | undefined): string | undefined {
  return description?.replace(/\bprovider\b/gi, "model service");
}

function orderedProviderIds(
  items: ReadonlyArray<{ readonly id: string }>,
): string[] {
  const liveIds = items.map((item) => item.id);
  if (liveIds.length === 0) {
    return OFFICIAL_PROVIDERS.map((provider) => provider.id);
  }
  const officialOrder = OFFICIAL_PROVIDERS.map((provider) => provider.id).filter((id) =>
    liveIds.includes(id),
  );
  const rest = liveIds.filter((id) => !officialOrder.includes(id));
  return [...officialOrder, ...rest];
}
