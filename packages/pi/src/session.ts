import { configurationInvalid, fail } from "./fail.js";
import type { ResolvedModel } from "./model.js";
import type { PiSessionEvent } from "./events.js";

export interface PiSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PiSessionEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

export interface CreatePiSessionOptions {
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly systemPrompt: string;
  readonly model: ResolvedModel;
}

export type CreatePiSession = (options: CreatePiSessionOptions) => Promise<PiSession>;

interface PiSdk {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
  SessionManager: { inMemory: (cwd?: string) => unknown };
  DefaultResourceLoader: new (options: Record<string, unknown>) => {
    reload: () => Promise<void>;
  };
  SettingsManager?: { inMemory: (settings?: Record<string, unknown>) => unknown };
  ModelRuntime?: {
    create: (options?: Record<string, unknown>) => Promise<{
      getModel: (provider: string, id: string) => unknown;
    }>;
  };
}

export async function createPiAgentSession(
  options: CreatePiSessionOptions,
): Promise<PiSession> {
  const sdk = await loadPiSdk();
  const loader = new sdk.DefaultResourceLoader({
    cwd: options.cwd,
    systemPromptOverride: () => options.systemPrompt,
  });
  await loader.reload();

  const sessionOptions: Record<string, unknown> = {
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(options.cwd),
    customTools: [],
  };

  if (options.tools.length === 0) {
    sessionOptions.noTools = "all";
  } else {
    sessionOptions.tools = [...options.tools];
  }

  if (sdk.SettingsManager !== undefined) {
    sessionOptions.settingsManager = sdk.SettingsManager.inMemory({
      compaction: { enabled: false },
    });
  }

  if (sdk.ModelRuntime !== undefined) {
    const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
    const model = modelRuntime.getModel(options.model.provider, options.model.id);
    if (model === undefined || model === null) {
      throw configurationInvalid(
        "model_unavailable",
        `Resolved model ${options.model.provider}/${options.model.id} is not available to Pi`,
        { provider: options.model.provider, id: options.model.id },
      );
    }
    sessionOptions.model = model;
    sessionOptions.modelRuntime = modelRuntime;
  }

  const { session } = await sdk.createAgentSession(sessionOptions);
  return session;
}

async function loadPiSdk(): Promise<PiSdk> {
  const specifier = "@earendil-works/pi-coding-agent";
  try {
    return (await import(specifier)) as PiSdk;
  } catch (error) {
    throw fail(
      "unavailable",
      "pi_sdk_unavailable",
      "Pi SDK @earendil-works/pi-coding-agent is not installed",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
