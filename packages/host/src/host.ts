import fs from "node:fs";
import path from "node:path";

import {
  createRepositoryState,
  readProjectDocument,
  type EventDocument,
  type ProjectDocument,
  type RepositoryState,
} from "@useagentsio/core";
import type { CreatePiSession } from "@useagentsio/pi";
import type {
  HostOutput,
  InboundMessage,
  InterfaceHealth,
  InterfaceServices,
  RunningInterface,
} from "@useagentsio/interface-sdk";

import { AttachmentStore } from "./attachment-store.js";
import {
  ConversationManager,
  requireAgentBinding,
} from "./conversation-manager.js";
import {
  ConversationStore,
  conversationsDirectory,
} from "./conversation-store.js";
import { hostError } from "./errors.js";
import type { HostHealth, HostStatusFile } from "./health.js";
import { startInterface, type InterfaceFactoryMap } from "./interface-loader.js";
import { KeyedWorkPool } from "./keyed-work-pool.js";
import { PersistentSessionManager } from "./persistent-session-manager.js";
import { SecretResolver } from "./secret-resolver.js";
import { persistTurnState } from "./state-writer.js";
import { withTimeout } from "./shutdown.js";
import {
  createInboundTask,
  type RunTurn,
  type TurnOutcome,
} from "./turn-runner.js";

const HOST_VERSION = "0.1.0";
const STOP_COMMANDS = new Set(["stop", "cancel", "/stop", "/cancel"]);

export interface HostOptions {
  readonly projectRoot: string;
  readonly project?: ProjectDocument;
  readonly state?: RepositoryState;
  readonly env?: NodeJS.ProcessEnv;
  readonly factories?: InterfaceFactoryMap;
  readonly runTurn?: RunTurn;
  readonly createSession?: CreatePiSession;
  readonly startInterfaces?: boolean;
  readonly now?: () => Date;
}

export interface SubmitResult {
  readonly conversationKey: string;
  readonly text: string;
  readonly cancelled: boolean;
  readonly duplicate: boolean;
  readonly error?: string;
}

type ProjectRuntime = ProjectDocument & {
  readonly defaultAgent?: string;
  readonly host?: {
    readonly retainedConversations: number;
    readonly maxParallelConversations: number;
    readonly sameConversationPolicy: "serialize";
    readonly shutdownGraceMs: number;
  };
  readonly interfaceBindings?: Readonly<
    Record<
      string,
      {
        readonly definition: string;
        readonly enabled: boolean;
        readonly defaultAgent: string;
        readonly config?: string;
      }
    >
  >;
};

export class VibeKitHost {
  readonly projectRoot: string;
  readonly project: ProjectRuntime;
  readonly state: RepositoryState;
  private readonly secrets: SecretResolver;
  private readonly conversations: ConversationManager;
  private readonly store: ConversationStore;
  private readonly pool: KeyedWorkPool;
  private readonly sessions: PersistentSessionManager;
  private readonly attachments: AttachmentStore;
  private readonly factories?: InterfaceFactoryMap;
  private readonly runTurn?: RunTurn;
  private readonly createSession?: CreatePiSession;
  private readonly now: () => Date;
  private readonly seenEvents = new Set<string>();
  private readonly interfaces = new Map<string, RunningInterface>();
  private readonly lockPath: string;
  private readonly statusPath: string;
  private startedAt = "";
  private ready = false;
  private stopping = false;
  private lastFatalError?: string;
  private lockHeld = false;

  private constructor(options: HostOptions, project: ProjectRuntime) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.project = project;
    this.state = options.state as RepositoryState;
    this.factories = options.factories;
    this.runTurn = options.runTurn;
    this.createSession = options.createSession;
    this.now = options.now ?? (() => new Date());
    this.secrets = new SecretResolver(project.id, options.env);
    this.store = new ConversationStore(
      conversationsDirectory(this.projectRoot, project.state.path),
    );
    this.conversations = new ConversationManager(this.store, project.id, this.projectRoot);
    const hostConfig = project.host ?? {
      retainedConversations: 20,
      maxParallelConversations: project.execution.maxParallelRuns,
      sameConversationPolicy: "serialize" as const,
      shutdownGraceMs: 30_000,
    };
    this.pool = new KeyedWorkPool(hostConfig.maxParallelConversations);
    this.sessions = new PersistentSessionManager(
      path.join(this.projectRoot, ".vibekit", "runtime", "sessions"),
      hostConfig.retainedConversations,
    );
    this.attachments = new AttachmentStore(
      path.join(this.projectRoot, ".vibekit", "runtime", "uploads"),
    );
    this.lockPath = path.join(this.projectRoot, ".vibekit", "runtime", "host.lock");
    this.statusPath = path.join(this.projectRoot, ".vibekit", "runtime", "host-status.json");
  }

  static async start(options: HostOptions): Promise<VibeKitHost> {
    const projectRoot = path.resolve(options.projectRoot);
    const project = (options.project ?? readProjectDocument(projectRoot)) as ProjectRuntime;
    const state =
      options.state ??
      createRepositoryState({
        projectRoot,
        statePath: project.state.path,
      });
    const host = new VibeKitHost({ ...options, project, state }, project);
    await host.boot(options.startInterfaces !== false);
    return host;
  }

  private async boot(startInterfaces: boolean): Promise<void> {
    this.acquireLock();
    this.startedAt = this.now().toISOString();
    this.state.recoverStale();
    if (startInterfaces) {
      await this.startEnabledInterfaces();
    }
    this.ready = true;
    this.writeStatus();
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    this.ready = false;
    this.writeStatus();
    const grace = this.project.host?.shutdownGraceMs ?? 30_000;
    await withTimeout(
      this.stopInterfaces(),
      grace,
      () => undefined,
    );
    this.releaseLock();
    this.state.close();
    if (fs.existsSync(this.statusPath)) {
      fs.rmSync(this.statusPath, { force: true });
    }
  }

  async submit(message: InboundMessage): Promise<SubmitResult> {
    if (!this.ready) {
      throw hostError("conflict", "host_not_ready", "Host is not accepting messages");
    }
    if (this.seenEvents.has(message.eventId)) {
      return {
        conversationKey: message.conversationKey,
        text: "",
        cancelled: false,
        duplicate: true,
      };
    }
    this.seenEvents.add(message.eventId);

    if (isStopCommand(message.text)) {
      const cancelled = await this.cancel(message.conversationKey);
      const output: HostOutput = {
        type: "cancelled",
        conversationKey: message.conversationKey,
        message: cancelled ? "Cancelled." : "Nothing to cancel.",
      };
      await this.deliver(output);
      return {
        conversationKey: message.conversationKey,
        text: output.message,
        cancelled: true,
        duplicate: false,
      };
    }

    const agentBinding = requireAgentBinding(this.project, message.interfaceBinding);
    const conversation = this.conversations.loadOrCreate({ message, agentBinding });
    const outcome = await this.pool.run(message.conversationKey, async (signal) =>
      this.runOneTurn(message, conversation.agentBinding, signal),
    );
    this.conversations.touch(conversation, this.now().toISOString(), message.eventId);
    this.sessions.remember(conversation.id, outcome.sessionPath);
    this.writeStatus();
    return {
      conversationKey: message.conversationKey,
      text: outcome.text,
      cancelled: outcome.cancelled,
      duplicate: false,
      error: outcome.error,
    };
  }

  async cancel(conversationKey: string): Promise<boolean> {
    return this.pool.cancel(conversationKey);
  }

  async health(): Promise<HostHealth> {
    const interfaces: Record<string, InterfaceHealth> = {};
    for (const [name, running] of this.interfaces) {
      interfaces[name] = await running.health();
    }
    return {
      ok: this.ready && this.lastFatalError === undefined,
      ready: this.ready,
      pid: process.pid,
      projectId: this.project.id,
      startedAt: this.startedAt,
      version: HOST_VERSION,
      activeConversations: this.store.list().filter((item) => item.status === "active").length,
      queuedTurns: this.pool.queued,
      retainedSessions: this.sessions.size,
      interfaces,
      lastFatalError: this.lastFatalError,
    };
  }

  services(): InterfaceServices {
    return {
      submit: (message) => this.submit(message).then(() => undefined),
      cancel: (conversationKey) => this.cancel(conversationKey),
      resolveSecret: (name) => this.secrets.resolve(name),
      log: {
        info: (message) => process.stderr.write(`${message}\n`),
        warn: (message) => process.stderr.write(`${message}\n`),
        error: (message) => process.stderr.write(`${message}\n`),
      },
    };
  }

  private async runOneTurn(
    message: InboundMessage,
    agentBinding: string,
    signal: AbortSignal,
  ): Promise<TurnOutcome> {
    const definition = this.project.agentBindings[agentBinding]?.definition ?? null;
    const task = createInboundTask({
      project: this.project,
      conversation: this.conversations.loadOrCreate({ message, agentBinding }),
      message,
      agentId: definition,
      now: this.now(),
    });
    await this.deliver({
      type: "activity",
      conversationKey: message.conversationKey,
      activity: "thinking",
    });

    const runner = this.runTurn ?? this.defaultRunTurn.bind(this);
    let outcome: TurnOutcome;
    try {
      outcome = await runner({
        projectRoot: this.projectRoot,
        project: this.project,
        conversation: this.conversations.loadOrCreate({ message, agentBinding }),
        message,
        signal,
      });
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.lastFatalError = failure;
      await this.deliver({
        type: "error",
        conversationKey: message.conversationKey,
        message: failure,
        code: "turn_failed",
      });
      throw error;
    }

    persistTurnState({
      state: this.state,
      task: outcome.task ?? task,
      events: outcome.events,
      result: outcome.result,
    });

    if (outcome.cancelled) {
      await this.deliver({
        type: "cancelled",
        conversationKey: message.conversationKey,
        message: "Cancelled.",
      });
      return outcome;
    }

    if (outcome.error !== undefined && outcome.text.length === 0) {
      await this.deliver({
        type: "error",
        conversationKey: message.conversationKey,
        message: outcome.error,
        code: "provider_error",
      });
      return outcome;
    }

    if (outcome.text.length > 0) {
      await this.deliver({
        type: "text.delta",
        conversationKey: message.conversationKey,
        text: outcome.text,
      });
    }
    await this.deliver({
      type: "message.completed",
      conversationKey: message.conversationKey,
      text: outcome.text,
    });
    return outcome;
  }

  private async defaultRunTurn(request: Parameters<RunTurn>[0]): Promise<TurnOutcome> {
    const conversation = request.conversation;
    const sessionPath = this.sessions.resolvePath(conversation.sessionPath, this.projectRoot);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    const task = createInboundTask({
      project: request.project,
      conversation,
      message: request.message,
      agentId: request.project.agentBindings[conversation.agentBinding]?.definition ?? null,
      now: this.now(),
    });

    if (this.createSession !== undefined) {
      const session = await this.createSession({
        cwd: this.projectRoot,
        tools: [],
        systemPrompt: "You are a VibeKit Agent. Answer the user.",
        model: {
          provider: request.project.defaults?.model?.provider ?? "openai",
          id: request.project.defaults?.model?.id ?? "gpt-4.1",
          source: "project",
        },
      });
      let text = "";
      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta" &&
          typeof event.assistantMessageEvent.delta === "string"
        ) {
          text += event.assistantMessageEvent.delta;
        }
      });
      try {
        if (request.signal.aborted) {
          return { task, runId: formatRunId(), text: "", cancelled: true, events: [], sessionPath };
        }
        await session.prompt(request.message.text);
      } finally {
        unsubscribe();
        session.dispose();
      }
      return {
        task,
        runId: formatRunId(),
        text,
        cancelled: request.signal.aborted,
        events: [],
        sessionPath,
      };
    }

    const pi = await import("@useagentsio/pi");
    if (typeof pi.runConversationTurn !== "function") {
      throw hostError(
        "unavailable",
        "conversation_api_missing",
        "Persistent Pi conversation API is not available",
      );
    }
    const result = await pi.runConversationTurn({
      cwd: this.projectRoot,
      sessionPath,
      tools: [],
      systemPrompt: "You are a VibeKit Agent. Answer the user.",
      model: {
        provider: request.project.defaults?.model?.provider ?? "openai",
        id: request.project.defaults?.model?.id ?? "gpt-4.1",
        source: "project",
      },
      text: request.message.text,
      signal: request.signal,
      allowNetwork: true,
      onTextDelta: async (delta: string) => {
        await this.deliver({
          type: "text.delta",
          conversationKey: request.message.conversationKey,
          text: delta,
        });
      },
    });
    return {
      task,
      runId: formatRunId(),
      text: result.text,
      cancelled: result.cancelled,
      error: result.error,
      events: [],
      sessionPath: result.sessionPath,
    };
  }

  private async deliver(output: HostOutput): Promise<void> {
    for (const running of this.interfaces.values()) {
      await running.deliver(output);
    }
  }

  private async startEnabledInterfaces(): Promise<void> {
    const bindings = this.project.interfaceBindings ?? {};
    for (const [name, binding] of Object.entries(bindings)) {
      if (!binding.enabled) {
        continue;
      }
      const config = loadBindingConfig(this.projectRoot, binding.config);
      const running = await startInterface(
        binding.definition,
        config,
        this.services(),
        this.factories,
      );
      await running.start();
      this.interfaces.set(name, running);
    }
  }

  private async stopInterfaces(): Promise<void> {
    for (const running of this.interfaces.values()) {
      await running.stop();
    }
    this.interfaces.clear();
  }

  private acquireLock(): void {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    if (fs.existsSync(this.lockPath)) {
      const raw = fs.readFileSync(this.lockPath, "utf8").trim();
      const pid = Number(raw);
      if (Number.isInteger(pid) && pidAlive(pid)) {
        throw hostError(
          "conflict",
          "host_already_running",
          `Another Host process is already running (pid ${pid})`,
          { pid },
        );
      }
    }
    fs.writeFileSync(this.lockPath, `${process.pid}\n`, "utf8");
    this.lockHeld = true;
  }

  private releaseLock(): void {
    if (!this.lockHeld) {
      return;
    }
    fs.rmSync(this.lockPath, { force: true });
    this.lockHeld = false;
  }

  private writeStatus(): void {
    const status: HostStatusFile = {
      schemaVersion: 1,
      ok: this.ready && this.lastFatalError === undefined,
      ready: this.ready,
      pid: process.pid,
      projectId: this.project.id,
      startedAt: this.startedAt,
      version: HOST_VERSION,
      activeConversations: this.store.list().filter((item) => item.status === "active").length,
      queuedTurns: this.pool.queued,
      retainedSessions: this.sessions.size,
      interfaces: {},
      lastFatalError: this.lastFatalError,
    };
    fs.mkdirSync(path.dirname(this.statusPath), { recursive: true });
    fs.writeFileSync(this.statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  }
}

function isStopCommand(text: string): boolean {
  return STOP_COMMANDS.has(text.trim().toLowerCase());
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadBindingConfig(
  projectRoot: string,
  configPath: string | undefined,
): Record<string, unknown> {
  if (configPath === undefined) {
    return {};
  }
  const abs = path.join(projectRoot, configPath);
  if (!fs.existsSync(abs)) {
    return {};
  }
  return { path: configPath };
}

function formatRunId(): EventDocument["runId"] & string {
  return `run_${globalThis.crypto.randomUUID()}` as EventDocument["runId"] & string;
}
