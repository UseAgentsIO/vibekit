import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readProjectDocument, redactSecrets } from "./internal/core/index.js";
import { healthViaIpc, isHostIpcAvailable, shutdownViaIpc, type HostHealth } from "./internal/host/index.js";
import { listPairings } from "./internal/interfaces/telegram/index.js";

import type { ProjectDashboardProject, ProjectLifecycleResult, ProjectPairings } from "./contracts.js";

export { isHostIpcAvailable } from "./internal/host/index.js";

const RUNTIME_FILES = ["host-status.json", "host.lock", "host.sock", "host-ipc.json"];

export function resolveHostBinary(): { command: string; args: string[] } {
  if (process.env.VIBEKIT_HOST_BIN) return { command: process.env.VIBEKIT_HOST_BIN, args: [] };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const compiled = path.join(here, "internal", "host", "main.js");
  if (fs.existsSync(compiled)) return { command: process.execPath, args: [compiled] };

  // Source execution remains useful from the repository. Use the repository's
  // existing tsx tool rather than adding a second runtime package boundary.
  const source = path.join(here, "internal", "host", "main.ts");
  if (fs.existsSync(source)) {
    const workspaceRoot = path.resolve(here, "../../..");
    return { command: "pnpm", args: ["--dir", workspaceRoot, "exec", "tsx", source] };
  }
  return { command: "vibekit-host", args: [] };
}

export async function inspectProject(projectId: string, projectRoot: string, registeredAt: string): Promise<ProjectDashboardProject> {
  const base = { projectId, path: projectRoot, registeredAt, agentBindings: [], interfaces: {}, pairings: emptyPairings(), activeConversations: 0, queuedTurns: 0 };
  if (!fs.existsSync(projectRoot)) return { ...base, state: "missing" };
  let project;
  try {
    project = readProjectDocument(projectRoot);
    if (project.id !== projectId) return { ...base, state: "invalid", error: `Path contains ${project.id}` };
  } catch (error) {
    return { ...base, state: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
  const bindings = Object.entries(project.interfaceBindings ?? {});
  const live = await healthViaIpc(projectRoot);
  const status = live ?? readHostStatus(projectRoot);
  const healthy = live !== undefined;
  const alive = status?.pid !== undefined && pidAlive(status.pid);
  const state = healthy ? (status?.ok === false ? "unhealthy" : "running") : alive ? "unhealthy" : "stopped";
  const interfaces = Object.fromEntries(bindings.filter(([, binding]) => binding.enabled).map(([name, binding]) => [
    name,
    { ok: status?.interfaces?.[name]?.ok ?? false, connected: status?.interfaces?.[name]?.connected ?? false, detail: status?.interfaces?.[name]?.detail, definition: binding.definition },
  ]));
  const pairings = readProjectPairings(projectRoot);
  return {
    ...base,
    name: project.name,
    state,
    pid: alive || healthy ? status?.pid : undefined,
    startedAt: status?.startedAt,
    defaultAgent: project.defaultAgent,
    agentBindings: Object.keys(project.agentBindings),
    provider: project.defaults?.model?.provider,
    model: project.defaults?.model?.id,
    interfaces,
    pairings,
    activeConversations: status?.activeConversations ?? 0,
    queuedTurns: status?.queuedTurns ?? 0,
    lastFatalError: status?.lastFatalError,
  };
}

function readProjectPairings(projectRoot: string): ProjectPairings {
  try {
    const pairings = listPairings(projectRoot);
    return {
      ...(pairings.owner !== undefined ? { owner: pairings.owner } : {}),
      paired: pairings.paired,
      pending: pairings.pending,
    };
  } catch {
    return emptyPairings();
  }
}

function emptyPairings(): ProjectPairings {
  return { paired: [], pending: [] };
}

export async function startProjectHost(projectId: string, projectRoot: string, options?: { readonly env?: NodeJS.ProcessEnv; readonly requireSecrets?: boolean }): Promise<ProjectLifecycleResult> {
  if (await isHostIpcAvailable(projectRoot)) {
    const status = readHostStatus(projectRoot);
    return { projectId, action: "start", ok: true, state: "running", pid: status?.pid };
  }
  const runtime = path.join(projectRoot, ".vibekit", "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const logPath = path.join(runtime, "host.log");
  const logFd = fs.openSync(logPath, "a", 0o600);
  const binary = resolveHostBinary();
  const child = spawn(binary.command, [...binary.args, projectRoot, ...(options?.requireSecrets === true ? ["--require-secrets"] : [])], {
    detached: true, stdio: ["ignore", logFd, logFd], cwd: projectRoot, env: options?.env ?? process.env,
  });
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isHostIpcAvailable(projectRoot)) {
      const status = readHostStatus(projectRoot);
      return { projectId, action: "start", ok: true, state: "running", pid: status?.pid ?? child.pid };
    }
    if (child.exitCode !== null) break;
    await delay(50);
  }
  return { projectId, action: "start", ok: false, state: "stopped", error: `Host failed to start. ${readProjectLog(projectRoot, 40)}`.trim() };
}

/**
 * Keep a Project process available for an enabled long-lived connection.
 * Callers decide whether the user approved login persistence; this seam only
 * starts the selected Project and never installs an operating-system service.
 */
export interface PersistentAvailabilityOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly requireSecrets?: boolean;
  /** Start the loopback dashboard before the Project when a remote connection needs it. */
  readonly ensureGateway?: boolean;
  /** Install the login service only after the caller has obtained explicit approval. */
  readonly installGateway?: boolean;
  readonly gatewayPort?: number;
}

export async function ensurePersistentAvailability(
  projectRoot: string,
  options?: PersistentAvailabilityOptions,
): Promise<ProjectLifecycleResult> {
  const project = readProjectDocument(projectRoot);
  if (options?.ensureGateway === true) {
    const gateway = await import("./gateway/service.js");
    const port = options.gatewayPort ?? gateway.readGatewayPort();
    if (options.installGateway === true) {
      const entry = process.env.VIBEKIT_CLI_ENTRY ?? process.argv[1] ?? "vibekit";
      gateway.installGatewayService(gateway.gatewayServiceDefinition({
        cliEntry: path.resolve(entry),
        port,
      }));
    } else {
      await gateway.ensureGatewayRunning(port);
    }
  }
  return startProjectHost(project.id, projectRoot, {
    env: options?.env,
    requireSecrets: options?.requireSecrets ?? true,
  });
}

export function projectRequiresPersistentAvailability(project: {
  readonly interfaceBindings?: Readonly<Record<string, { readonly enabled?: boolean; readonly definition?: string }>>;
}): boolean {
  return Object.values(project.interfaceBindings ?? {}).some((binding) => binding.enabled === true && binding.definition !== "interface:terminal");
}

export async function stopProjectHost(projectId: string, projectRoot: string): Promise<ProjectLifecycleResult> {
  const status = readHostStatus(projectRoot);
  const pid = status?.pid ?? readLockPid(projectRoot);
  const healthy = await isHostIpcAvailable(projectRoot);
  if (!healthy && (pid === undefined || !pidAlive(pid))) {
    cleanStaleRuntimeFiles(projectRoot);
    return { projectId, action: "stop", ok: true, state: "stopped" };
  }
  if (healthy) await shutdownViaIpc(projectRoot, { timeoutMs: 3_000 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await isHostIpcAvailable(projectRoot) || (pid !== undefined && pidAlive(pid)))) await delay(50);
  if (pid !== undefined && pidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      const termDeadline = Date.now() + 2_000;
      while (Date.now() < termDeadline && pidAlive(pid)) await delay(50);
      if (pidAlive(pid)) process.kill(pid, "SIGKILL");
    } catch { /* process already exited */ }
  }
  cleanStaleRuntimeFiles(projectRoot);
  return { projectId, action: "stop", ok: pid === undefined || !pidAlive(pid), state: pid !== undefined && pidAlive(pid) ? "unhealthy" : "stopped" };
}

export async function restartProjectHost(projectId: string, projectRoot: string): Promise<ProjectLifecycleResult> {
  const stopped = await stopProjectHost(projectId, projectRoot);
  if (!stopped.ok) return { ...stopped, action: "restart" };
  const started = await startProjectHost(projectId, projectRoot);
  return { ...started, action: "restart" };
}

export function gatewayHostEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR", "APPDATA", "LOCALAPPDATA", "NODE_PATH"];
  return Object.fromEntries(names.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]]));
}

export function readProjectLog(projectRoot: string, maxLines = 200): string {
  const file = path.join(projectRoot, ".vibekit", "runtime", "host.log");
  if (!fs.existsSync(file)) return "";
  const size = fs.statSync(file).size;
  const bytes = Math.min(size, 256 * 1024);
  const buffer = Buffer.alloc(bytes);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buffer, 0, bytes, size - bytes); } finally { fs.closeSync(fd); }
  return redactSecrets(buffer.toString("utf8")).split(/\r?\n/).slice(-maxLines).join("\n");
}

function readHostStatus(projectRoot: string): HostHealth | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, ".vibekit", "runtime", "host-status.json"), "utf8")) as HostHealth;
  } catch { return undefined; }
}

function readLockPid(projectRoot: string): number | undefined {
  try {
    const pid = Number(fs.readFileSync(path.join(projectRoot, ".vibekit", "runtime", "host.lock"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cleanStaleRuntimeFiles(projectRoot: string): void {
  const runtime = path.join(projectRoot, ".vibekit", "runtime");
  for (const name of RUNTIME_FILES) fs.rmSync(path.join(runtime, name), { force: true });
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
