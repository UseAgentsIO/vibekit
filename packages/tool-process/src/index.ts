import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveProcessCwd } from "./cwd.js";
import {
  findRecord,
  isPidAlive,
  loadStore,
  logPath,
  nextProcessId,
  readLogTail,
  saveStore,
  type ProcessRecord,
} from "./store.js";

export { resolveProcessCwd } from "./cwd.js";
export { loadStore, storePath } from "./store.js";

export const PROCESS_MANAGE_CAPABILITY = "process.manage";

export interface ToolContext {
  projectRoot: string;
  config?: Record<string, unknown>;
  resolveSecret?: (name: string) => string;
  grantedCapabilities?: readonly string[];
  fetch?: typeof fetch;
}

export interface ExecutableTool {
  name: string;
  description: string;
  parameters: object;
  execute(input: unknown): Promise<unknown>;
}

export interface ToolError {
  readonly error: true;
  readonly code: string;
  readonly message: string;
}

const DEFAULT_LOG_BYTES = 8192;
const STDIO_ENV = ["PATH", "HOME", "USER", "LANG", "TMPDIR", "SHELL", "TZ"] as const;

export function createProcessTool(ctx: ToolContext): ExecutableTool {
  const projectRoot = path.resolve(ctx.projectRoot);
  const allowAbsoluteCwd = ctx.config?.allowAbsoluteCwd === true;
  const children = new Map<string, ChildProcess>();
  return {
    name: "process",
    description:
      "Background process control: start, list, poll, wait, log, kill. Complements tool:execution. Only processes started by this tool can be killed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["start", "list", "poll", "wait", "log", "kill"] },
        command: { type: "string" },
        cwd: { type: "string" },
        id: { type: "string" },
        pid: { type: "integer" },
        timeoutMs: { type: "integer", minimum: 1 },
        bytes: { type: "integer", minimum: 1 },
      },
    },
    async execute(input: unknown): Promise<unknown> {
      const denied = denyIfMissing(ctx.grantedCapabilities, PROCESS_MANAGE_CAPABILITY);
      if (denied) {
        return denied;
      }
      const body = asObject(input);
      const action = asString(body.action);
      if (action === undefined) {
        return fail("invalid_input", "process requires an action");
      }
      try {
        switch (action) {
          case "start":
            return startProcess(body);
          case "list":
            return { processes: refreshAll() };
          case "poll":
            return pollOne(body);
          case "wait":
            return waitOne(body);
          case "log":
            return readLog(body);
          case "kill":
            return killOne(body);
          default:
            return fail("invalid_input", `Unsupported process action ${action}`);
        }
      } catch (error) {
        return fail("external_error", error instanceof Error ? error.message : "Process action failed");
      }
    },
  };

  function startProcess(input: Record<string, unknown>): unknown {
    const command = asString(input.command);
    if (command === undefined) {
      return fail("invalid_input", "start requires command");
    }
    const cwd = resolveProcessCwd(projectRoot, asString(input.cwd), allowAbsoluteCwd);
    if (!cwd.ok) {
      return fail("invalid_input", cwd.message);
    }
    const store = loadStore(projectRoot);
    const id = nextProcessId(store);
    const logFile = logPath(projectRoot, id);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    const [bin, args] = shellCommand(command);
    const child = spawn(bin, args, {
      cwd: cwd.cwd,
      env: filteredEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid === undefined) {
      logStream.end();
      return fail("external_error", "Failed to start process");
    }
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    child.on("close", () => {
      logStream.end();
    });
    const record: ProcessRecord = {
      id,
      pid: child.pid,
      command,
      cwd: cwd.relative,
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      signal: null,
      logFile: path.posix.join(".vibekit", "runtime", `proc-${id}.log`),
    };
    children.set(id, child);
    child.on("exit", (code, signal) => {
      const current = loadStore(projectRoot);
      const existing = findRecord(current, { id });
      if (existing !== undefined) {
        existing.status = signal !== null ? "killed" : "exited";
        existing.exitCode = code;
        existing.signal = signal;
        saveStore(projectRoot, current);
      }
      children.delete(id);
    });
    store.processes.push(record);
    saveStore(projectRoot, store);
    return { ...record };
  }

  function pollOne(input: Record<string, unknown>): unknown {
    const record = locate(input);
    if (record === undefined) {
      return fail("invalid_input", "Unknown process id or pid");
    }
    return refreshRecord(record);
  }

  async function waitOne(input: Record<string, unknown>): Promise<unknown> {
    const record = locate(input);
    if (record === undefined) {
      return fail("invalid_input", "Unknown process id or pid");
    }
    const timeoutMs = asPositiveInt(input.timeoutMs) ?? 30_000;
    const child = children.get(record.id);
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      const finished = await waitForChild(child, timeoutMs);
      if (!finished) {
        return { ...refreshRecord(record), timedOut: true };
      }
      return refreshRecord(record);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = refreshRecord(record);
      if (current.status !== "running") {
        return current;
      }
      await sleep(50);
    }
    return { ...refreshRecord(record), timedOut: true };
  }

  function readLog(input: Record<string, unknown>): unknown {
    const record = locate(input);
    if (record === undefined) {
      return fail("invalid_input", "Unknown process id or pid");
    }
    const bytes = asPositiveInt(input.bytes) ?? DEFAULT_LOG_BYTES;
    const file = logPath(projectRoot, record.id);
    return {
      id: record.id,
      pid: record.pid,
      bytes,
      log: readLogTail(file, bytes),
    };
  }

  function killOne(input: Record<string, unknown>): unknown {
    const record = locate(input);
    if (record === undefined) {
      return fail("permission_denied", "kill is limited to processes started by this tool");
    }
    const child = children.get(record.id);
    if (child !== undefined && child.exitCode === null) {
      child.kill("SIGTERM");
    } else if (isPidAlive(record.pid)) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch (error) {
        return fail("external_error", error instanceof Error ? error.message : "kill failed");
      }
    }
    const updated = loadStore(projectRoot);
    const existing = findRecord(updated, { id: record.id });
    if (existing !== undefined && existing.status === "running" && !isPidAlive(existing.pid)) {
      existing.status = "killed";
      existing.signal = "SIGTERM";
      saveStore(projectRoot, updated);
    }
    return refreshRecord(record);
  }

  function locate(input: Record<string, unknown>): ProcessRecord | undefined {
    const store = loadStore(projectRoot);
    return findRecord(store, {
      id: asString(input.id),
      pid: asPositiveInt(input.pid),
    });
  }

  function refreshAll(): ProcessRecord[] {
    const store = loadStore(projectRoot);
    let dirty = false;
    for (const record of store.processes) {
      dirty = applyLiveStatus(record) || dirty;
    }
    if (dirty) {
      saveStore(projectRoot, store);
    }
    return store.processes;
  }

  function refreshRecord(record: ProcessRecord): ProcessRecord {
    const store = loadStore(projectRoot);
    const existing = findRecord(store, { id: record.id }) ?? record;
    if (applyLiveStatus(existing)) {
      saveStore(projectRoot, store);
    }
    return existing;
  }

  function applyLiveStatus(record: ProcessRecord): boolean {
    if (record.status !== "running") {
      return false;
    }
    const child = children.get(record.id);
    if (child !== undefined) {
      if (child.exitCode !== null || child.signalCode !== null) {
        record.status = child.signalCode !== null ? "killed" : "exited";
        record.exitCode = child.exitCode;
        record.signal = child.signalCode;
        return true;
      }
      return false;
    }
    if (!isPidAlive(record.pid)) {
      record.status = "exited";
      return true;
    }
    return false;
  }
}

function shellCommand(command: string): [string, string[]] {
  if (process.platform === "win32") {
    return ["cmd.exe", ["/d", "/s", "/c", command]];
  }
  return [process.env.SHELL || "/bin/sh", ["-c", command]];
}

function filteredEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of STDIO_ENV) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) {
      env[name] = value;
    }
  }
  return env;
}

function waitForChild(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function denyIfMissing(
  granted: readonly string[] | undefined,
  capability: string,
): ToolError | undefined {
  if (granted === undefined) {
    return undefined;
  }
  if (!granted.includes(capability)) {
    return fail("permission_denied", `Missing capability ${PROCESS_MANAGE_CAPABILITY}`);
  }
  return undefined;
}

function fail(code: string, message: string): ToolError {
  return { error: true, code, message };
}

function asObject(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return undefined;
}
