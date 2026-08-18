import fs from "node:fs";
import path from "node:path";

import type { EventDocument } from "@useagentsio/core";

import { createRunEvent, mapPiSessionEvent, type PiSessionEvent } from "./events.js";
import { fail } from "./fail.js";
import { newRuntimeId } from "./ids.js";
import type { ResolvedModel } from "./model.js";
import {
  assistantTextDelta,
  assistantTurnError,
  createPiAgentSession,
  loadPiSdk,
  type CreatePiSession,
  type PiCustomTool,
  type PiSession,
} from "./session.js";

export type { PiCustomTool };

export interface PersistentSession {
  readonly sessionPath: string;
  readonly streaming: boolean;
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PiSessionEvent) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

export interface CreatePersistentSessionManagerInput {
  readonly cwd: string;
  readonly sessionPath: string;
  readonly exists: boolean;
}

export type CreatePersistentSessionManager = (
  input: CreatePersistentSessionManagerInput,
) => Promise<unknown> | unknown;

export interface PersistentConversationSessionOptions {
  readonly cwd: string;
  readonly sessionPath: string;
  readonly tools: readonly string[];
  readonly customTools?: readonly PiCustomTool[];
  readonly systemPrompt: string;
  readonly model: ResolvedModel;
  readonly allowNetwork?: boolean;
  readonly onTextDelta?: (text: string) => void | Promise<void>;
  readonly createSession?: CreatePiSession;
  readonly createSessionManager?: CreatePersistentSessionManager;
}

export interface ConversationTurnInput extends PersistentConversationSessionOptions {
  readonly text: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: EventDocument) => void | Promise<void>;
}

export interface ConversationTurnResult {
  readonly sessionPath: string;
  readonly text: string;
  readonly cancelled: boolean;
  readonly error?: string;
}

export async function createPersistentConversationSession(
  options: PersistentConversationSessionOptions,
): Promise<PersistentSession> {
  const exists = fs.existsSync(options.sessionPath);
  const manager = options.createSessionManager
    ? await options.createSessionManager({
        cwd: options.cwd,
        sessionPath: options.sessionPath,
        exists,
      })
    : await createPiFileSessionManager(options.cwd, options.sessionPath, exists);

  const createSession = options.createSession ?? createPiAgentSession;
  const session = await createSession({
    cwd: options.cwd,
    tools: options.tools,
    customTools: options.customTools,
    systemPrompt: options.systemPrompt,
    model: options.model,
    sessionManager: manager,
    allowNetwork: options.allowNetwork ?? true,
  });

  const sessionPath =
    recordedSessionPath(session) ??
    recordedSessionPath(manager) ??
    options.sessionPath;
  return wrapPersistentSession(session, sessionPath);
}

export async function openPersistentConversationSession(
  sessionPath: string,
  options: Omit<PersistentConversationSessionOptions, "sessionPath">,
): Promise<PersistentSession> {
  if (!fs.existsSync(sessionPath)) {
    throw fail("invalid_input", "session_not_found", "Persistent session file was not found", {
      sessionPath,
    });
  }
  return createPersistentConversationSession({ ...options, sessionPath });
}

export async function runConversationTurn(
  input: ConversationTurnInput,
): Promise<ConversationTurnResult> {
  const session = await createPersistentConversationSession(input);
  let text = "";
  let error: string | undefined;
  let cancelled = input.signal?.aborted === true;
  const runId = newRuntimeId("run");
  const taskId = newRuntimeId("task");

  const unsubscribe = session.subscribe((event: PiSessionEvent) => {
    const delta = assistantTextDelta(event);
    if (delta.length > 0) {
      text += delta;
      void input.onTextDelta?.(delta);
    }
    error = assistantTurnError(event) ?? error;
    if (input.onEvent === undefined) {
      return;
    }
    const mapped = mapPiSessionEvent(event, {
      projectId: "project:conversation",
      taskId,
      runId,
      actor: "agent:conversation",
    });
    if (mapped !== undefined) {
      void input.onEvent(mapped);
    }
  });

  const onAbort = (): void => {
    cancelled = true;
    void session.abort();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (cancelled) {
      emitTurnEvent(input, "run.cancelled", runId, taskId, { reason: "aborted-before-start" });
      return { sessionPath: session.sessionPath, text, cancelled: true, error };
    }

    emitTurnEvent(input, "run.started", runId, taskId, { cwd: input.cwd });
    try {
      await session.prompt(input.text);
    } catch (caught) {
      if (cancelled || input.signal?.aborted) {
        emitTurnEvent(input, "run.cancelled", runId, taskId, { reason: "signal" });
        return { sessionPath: session.sessionPath, text, cancelled: true, error };
      }
      throw caught;
    }

    cancelled = cancelled || input.signal?.aborted === true;
    if (cancelled) {
      emitTurnEvent(input, "run.cancelled", runId, taskId, { reason: "signal" });
    } else {
      emitTurnEvent(input, "run.completed", runId, taskId);
    }
    return { sessionPath: session.sessionPath, text, cancelled, error };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    session.dispose();
  }
}

export async function closeConversationSession(session: PersistentSession): Promise<void> {
  try {
    await session.abort();
  } finally {
    session.dispose();
  }
}

async function createPiFileSessionManager(
  cwd: string,
  sessionPath: string,
  exists: boolean,
): Promise<unknown> {
  const sdk = await loadPiSdk();
  if (exists) {
    return sdk.SessionManager.open(sessionPath);
  }
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  return sdk.SessionManager.create(cwd, path.dirname(sessionPath));
}

function wrapPersistentSession(session: PiSession, sessionPath: string): PersistentSession {
  let streaming = false;
  return {
    get sessionPath() {
      return recordedSessionPath(session) ?? sessionPath;
    },
    get streaming() {
      return streaming || isStreaming(session);
    },
    prompt(text) {
      return session.prompt(text);
    },
    subscribe(listener) {
      return session.subscribe((event) => {
        if (event.type === "agent_start" || event.type === "turn_start") {
          streaming = true;
        } else if (event.type === "agent_end" || event.type === "turn_end") {
          streaming = false;
        }
        listener(event);
      });
    },
    abort() {
      return session.abort();
    },
    dispose() {
      session.dispose();
    },
  };
}

function recordedSessionPath(source: unknown): string | undefined {
  if (source === null || source === undefined || typeof source !== "object") {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  for (const key of ["sessionFile", "filePath", "path"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  const getter = record.getSessionFile;
  if (typeof getter === "function") {
    const value = getter.call(source);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function isStreaming(session: PiSession): boolean {
  const value = (session as PiSession & { isStreaming?: boolean }).isStreaming;
  return value === true;
}

function emitTurnEvent(
  input: ConversationTurnInput,
  type: "run.started" | "run.completed" | "run.cancelled",
  runId: ReturnType<typeof newRuntimeId>,
  taskId: ReturnType<typeof newRuntimeId>,
  data?: Readonly<Record<string, unknown>>,
): void {
  if (input.onEvent === undefined) {
    return;
  }
  void input.onEvent(
    createRunEvent({
      type,
      projectId: "project:conversation",
      taskId,
      runId,
      actor: "agent:conversation",
      data,
    }),
  );
}
