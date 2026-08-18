import { homedir } from "node:os";
import path from "node:path";

import { configurationInvalid, fail } from "./fail.js";
import type { ResolvedModel } from "./model.js";
import type { PiSessionEvent } from "./events.js";

export interface PiSession {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PiSessionEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

export interface PiCustomTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  execute(input: unknown): Promise<unknown> | unknown;
}

export interface CreatePiSessionOptions {
  readonly cwd: string;
  readonly tools: readonly string[];
  readonly customTools?: readonly PiCustomTool[];
  readonly systemPrompt: string;
  readonly model: ResolvedModel;
  readonly sessionManager?: unknown;
  readonly allowNetwork?: boolean;
  readonly onTextDelta?: (text: string) => void | Promise<void>;
}

export type CreatePiSession = (options: CreatePiSessionOptions) => Promise<PiSession>;

export interface PiSdk {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
  SessionManager: {
    inMemory: (cwd?: string) => unknown;
    create: (cwd: string, sessionDir?: string) => unknown;
    open: (sessionPath: string, sessionDir?: string) => unknown;
  };
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
  const agentDir = path.join(homedir(), ".pi", "agent");
  const loader = new sdk.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    systemPromptOverride: () => options.systemPrompt,
  });
  await loader.reload();

  const customTools = [...(options.customTools ?? [])];
  const tools = mergeToolNames(options.tools, customTools);
  const sessionOptions: Record<string, unknown> = {
    cwd: options.cwd,
    resourceLoader: loader,
    sessionManager: options.sessionManager ?? sdk.SessionManager.inMemory(options.cwd),
    customTools,
  };

  if (tools.length === 0) {
    sessionOptions.noTools = "all";
  } else {
    sessionOptions.tools = tools;
  }

  if (sdk.SettingsManager !== undefined) {
    sessionOptions.settingsManager = sdk.SettingsManager.inMemory({
      compaction: { enabled: false },
    });
  }

  if (sdk.ModelRuntime !== undefined) {
    const modelRuntime =
      options.allowNetwork === true
        ? await sdk.ModelRuntime.create()
        : await sdk.ModelRuntime.create({ allowModelNetwork: false });
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
  if (options.onTextDelta !== undefined) {
    const onTextDelta = options.onTextDelta;
    session.subscribe((event) => {
      const delta = assistantTextDelta(event);
      if (delta.length > 0) {
        void onTextDelta(delta);
      }
    });
  }
  return session;
}

export function assistantTextDelta(event: PiSessionEvent): string {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent?.type === "text_delta" &&
    typeof event.assistantMessageEvent.delta === "string"
  ) {
    return event.assistantMessageEvent.delta;
  }
  return "";
}

export function assistantTurnError(event: PiSessionEvent): string | undefined {
  const message = (event as PiSessionEvent & { message?: { stopReason?: string; errorMessage?: string } }).message;
  if (message?.stopReason === "error" && typeof message.errorMessage === "string") {
    return message.errorMessage;
  }
  const messages = (event as PiSessionEvent & { messages?: Array<{ stopReason?: string; errorMessage?: string }> }).messages;
  if (event.type === "agent_end" && Array.isArray(messages)) {
    for (const item of messages) {
      if (item?.stopReason === "error" && typeof item.errorMessage === "string") {
        return item.errorMessage;
      }
    }
  }
  return undefined;
}

export async function loadPiSdk(): Promise<PiSdk> {
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

function mergeToolNames(
  tools: readonly string[],
  customTools: readonly PiCustomTool[],
): string[] {
  const names = [...tools];
  const seen = new Set(names);
  for (const tool of customTools) {
    if (!seen.has(tool.name)) {
      seen.add(tool.name);
      names.push(tool.name);
    }
  }
  return names;
}
