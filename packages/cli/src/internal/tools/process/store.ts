import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ProcessStatus = "running" | "exited" | "killed";

export interface ProcessRecord {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  startedAt: string;
  status: ProcessStatus;
  exitCode: number | null;
  signal: string | null;
  logFile: string;
}

export interface ProcessStoreFile {
  readonly version: 1;
  processes: ProcessRecord[];
}

export function runtimeDir(projectRoot: string): string {
  return path.join(projectRoot, ".vibekit", "runtime");
}

export function storePath(projectRoot: string): string {
  return path.join(runtimeDir(projectRoot), "processes.json");
}

export function logPath(projectRoot: string, id: string): string {
  return path.join(runtimeDir(projectRoot), `proc-${id}.log`);
}

export function loadStore(projectRoot: string): ProcessStoreFile {
  const file = storePath(projectRoot);
  if (!fs.existsSync(file)) {
    return { version: 1, processes: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ProcessStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.processes)) {
      return { version: 1, processes: [] };
    }
    return { version: 1, processes: parsed.processes };
  } catch {
    return { version: 1, processes: [] };
  }
}

export function saveStore(projectRoot: string, store: ProcessStoreFile): void {
  const file = storePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temp, file);
}

export function nextProcessId(store: ProcessStoreFile): string {
  return `p${crypto.randomBytes(6).toString("hex")}`;
}

export function findRecord(
  store: ProcessStoreFile,
  idOrPid: { id?: string; pid?: number },
): ProcessRecord | undefined {
  if (idOrPid.id !== undefined) {
    return store.processes.find((row) => row.id === idOrPid.id);
  }
  if (idOrPid.pid !== undefined) {
    return store.processes.find((row) => row.pid === idOrPid.pid);
  }
  return undefined;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLogTail(filePath: string, bytes: number): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const length = Math.min(Math.max(bytes, 0), size);
  const start = size - length;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
