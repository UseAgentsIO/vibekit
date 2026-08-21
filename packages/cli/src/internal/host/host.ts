import fs from "node:fs";
import path from "node:path";

import {
  createRepositoryState,
  decideApproval,
  isRuntimeIdOf,
  inboundIsUntrusted,
  loadInstalledProviders,
  normalizeProjectDocument,
  pairingRequired,
  readInstalledManifest,
  readProjectDocument,
  resolveProjectWorkspace,
  resolveInstalledModule,
  resolveEffectiveAuthority,
  type EventDocument,
  type ProjectDocument,
  type RepositoryState,
  type RuntimeId,
} from "../core/index.js";
import {
  createAgentDelegateTool,
  createGuardedBuiltinTools,
  executeDelegation,
  loadAgentDocument,
  type CreatePiSession,
} from "../pi/index.js";
import type {
  HostOutput,
  InboundMessage,
  InterfaceHealth,
  InterfaceServices,
  RunningInterface,
} from "../interfaces/sdk/index.js";
import { parse as parseYaml } from "yaml";

import { readDeploymentSecrets } from "./secret-resolver.js";
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
import {
  bindOptionalStateAdapter,
  optionalSessionContext,
  type OptionalStateAdapter,
} from "./state-binder.js";
import { bindInstalledTools } from "./tool-binder.js";
import { startHostIpc, stopHostIpc, type HostIpcServer } from "./ipc.js";
import { KeyedWorkPool } from "./keyed-work-pool.js";
import { PersistentSessionManager } from "./persistent-session-manager.js";
import { SecretResolver } from "./secret-resolver.js";
import { persistTurnState } from "./state-writer.js";
import { withTimeout } from "./shutdown.js";
import {
  createInboundTask,
  prepareAgentTurn,
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
  readonly onStop?: () => void;
  readonly requireSecrets?: boolean;
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
  readonly workspaceRoot: string;
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
  private ipc: HostIpcServer | undefined;
  private optionalState?: OptionalStateAdapter;
  private readonly onStop?: () => void;

  private constructor(options: HostOptions, project: ProjectRuntime) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.project = project;
    this.workspaceRoot = resolveProjectWorkspace(this.projectRoot, project.workspace);
    this.state = options.state as RepositoryState;
    this.factories = options.factories;
    this.runTurn = options.runTurn;
    this.createSession = options.createSession;
    this.now = options.now ?? (() => new Date());
    this.onStop = options.onStop;
    this.secrets = new SecretResolver(project.id, {
      ...readDeploymentSecrets(project.id),
      ...options.env,
    });
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
    const project = normalizeProjectDocument(options.project ?? readProjectDocument(projectRoot)) as ProjectRuntime;
    const state =
      options.state ??
      createRepositoryState({
        projectRoot,
        statePath: project.state.path,
      });
    const deploymentSecrets = readDeploymentSecrets(project.id);
    const mergedEnv = {
      ...process.env,
      ...options.env,
      ...deploymentSecrets,
    };
    for (const [name, value] of Object.entries(deploymentSecrets)) {
      if (value) process.env[name] = value;
    }
    const host = new VibeKitHost({ ...options, project, state, env: mergedEnv }, project);
    await host.boot(options.startInterfaces !== false, options.requireSecrets === true);
    return host;
  }

  private async boot(startInterfaces: boolean, requireSecrets: boolean): Promise<void> {
    this.acquireLock();
    try {
      this.startedAt = this.now().toISOString();
      if (requireSecrets) this.assertRequiredSecrets();
      this.state.recoverStale();
      this.optionalState = await bindOptionalStateAdapter(
        this.projectRoot,
        this.project.state.backend,
      );
      if (startInterfaces) await this.startEnabledInterfaces();
      this.ready = true;
      this.ipc = await startHostIpc({
        projectRoot: this.projectRoot,
        submit: (message) => this.submit(message),
        health: () => this.health(),
        shutdown: async () => {
          await this.stop();
          return { ok: true };
        },
      });
      this.writeStatus();
    } catch (error) {
      await this.stopInterfaces().catch(() => undefined);
      await this.optionalState?.close?.();
      this.releaseLock();
      this.state.close();
      throw error;
    }
  }

  private assertRequiredSecrets(): void {
    const missing = new Set<string>();
    for (const record of readInstalledManifest(this.projectRoot).modules) {
      for (const secret of resolveInstalledModule(record).secrets ?? []) {
        if (secret.required === true && !this.secrets.has(secret.name)) missing.add(secret.name);
      }
    }
    if (missing.size > 0) {
      throw hostError("authorization_required", "secret_missing", `Missing required secrets: ${[...missing].join(", ")}`);
    }
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
    await stopHostIpc(this.ipc);
    this.ipc = undefined;
    await this.optionalState?.close?.();
    this.optionalState = undefined;
    this.releaseLock();
    this.state.close();
    if (fs.existsSync(this.statusPath)) {
      fs.rmSync(this.statusPath, { force: true });
    }
    this.onStop?.();
  }

  async submit(message: InboundMessage): Promise<SubmitResult> {
    if (!this.ready) {
      throw hostError("conflict", "host_not_ready", "Host is not accepting messages");
    }
    if (pairingRequired(this.project) && message.sender.trusted !== true) {
      throw hostError(
        "permission_denied",
        "pairing_required",
        "Unknown Interface senders are denied until pairing is approved",
        { sender: message.sender.id, interfaceBinding: message.interfaceBinding },
      );
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

  async approve(
    approvalId: string,
    decision: "approved" | "rejected",
    _notes?: string,
  ): Promise<void> {
    const stored = isRuntimeIdOf("approval", approvalId)
      ? this.state.approvals.tryGet(approvalId as RuntimeId)
      : undefined;
    if (stored === undefined) {
      throw hostError("invalid_input", "approval_not_found", `Approval ${approvalId} was not found`, {
        approvalId,
      });
    }
    decideApproval({
      state: this.state,
      approval: stored.document,
      decision,
      actor: "human",
    });
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
      approve: (approvalId, decision, notes) => this.approve(approvalId, decision, notes),
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

    const agent = loadAgentDocument({
      projectRoot: this.projectRoot,
      project: request.project,
      bindingName: conversation.agentBinding,
    });
    const scheduledRun = request.message.accountId === "schedule";
    const authority = resolveEffectiveAuthority({
      project: request.project,
      agent: agent.document,
      task,
      installedProviders: loadInstalledProviders(this.projectRoot),
      scheduledRun,
    });
    const sessionContext = await optionalSessionContext(this.optionalState, authority.capabilities);
    const prepared = prepareAgentTurn({ ...request, task, sessionContext });
    const approvals = () => this.state.approvals.list().map((r) => r.document);
    const now = () => this.now();
    const installedTools = await bindInstalledTools(this.projectRoot, {
      resolveSecret: (name) => this.secrets.resolve(name),
      grantedCapabilities: authority.capabilities,
      scheduledRun,
      allowedModuleIds: authority.toolModuleIds,
      authority,
      project: request.project,
      task,
      approvals,
      now,
    });
    const customTools = [
      ...createGuardedBuiltinTools({
        cwd: this.workspaceRoot,
        authority,
        project: request.project,
        task,
        approvals,
        now,
      }),
      ...installedTools,
      ...(prepared.tools.includes("agent_delegate")
        ? [createAgentDelegateTool({
            execute: (delegation) => executeDelegation(delegation, {
              projectRoot: this.projectRoot,
              project: request.project,
              parentAgent: agent.document,
              parentBinding: conversation.agentBinding,
              parentTask: task,
              depth: 0,
              ancestorBindings: [],
              state: this.state,
              createSession: this.createSession,
              env: process.env,
              signal: request.signal,
              approvals: approvals(),
            }),
          })]
        : []),
    ];

    if (this.createSession !== undefined) {
      const session = await this.createSession({
        cwd: this.workspaceRoot,
        tools: prepared.tools,
        customTools,
        systemPrompt: prepared.systemPrompt,
        model: prepared.model,
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

    const pi = await import("../pi/index.js");
    if (typeof pi.runConversationTurn !== "function") {
      throw hostError(
        "unavailable",
        "conversation_api_missing",
        "Persistent Pi conversation API is not available",
      );
    }
    const result = await pi.runConversationTurn({
      cwd: this.workspaceRoot,
      sessionPath,
      tools: prepared.tools,
      customTools,
      systemPrompt: prepared.systemPrompt,
      model: prepared.model,
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
      const config = {
        ...loadBindingConfig(this.projectRoot, binding.config),
        projectRoot: this.projectRoot,
        interfaceBinding: name,
        knownInterfaces: Object.keys(bindings),
        pairingRequired: pairingRequired(this.project),
        inboundUntrusted: inboundIsUntrusted(this.project),
      };
      const running = await startInterface(
        binding.definition,
        config,
        this.services(),
        this.factories,
        this.projectRoot,
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
      socketPath: this.ipc?.socketPath,
      ipcPort: this.ipc?.port,
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

export function loadBindingConfig(
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
  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(abs, "utf8"));
  } catch {
    return { path: configPath };
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { ...(parsed as Record<string, unknown>), path: configPath };
  }
  return { path: configPath };
}

function resolvedProjectModel(project: ProjectDocument): {
  provider: string;
  id: string;
  source: "project";
} {
  const model = project.defaults?.model;
  if (model === undefined || model.provider.length === 0 || model.id.length === 0) {
    throw hostError(
      "configuration_invalid",
      "model_unresolved",
      "No model is configured. Run `vibekit model` and pick one from the live list.",
    );
  }
  return { provider: model.provider, id: model.id, source: "project" };
}

function formatRunId(): EventDocument["runId"] & string {
  return `run_${globalThis.crypto.randomUUID()}` as EventDocument["runId"] & string;
}
