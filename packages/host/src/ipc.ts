import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import type { InboundMessage } from "@useagentsio/interface-sdk";

import { hostError } from "./errors.js";
import type { SubmitResult } from "./host.js";

const HEALTH_TIMEOUT_MS = 1_000;

export interface HostIpcServer {
  readonly socketPath: string;
  readonly port?: number;
  close(): Promise<void>;
}

interface IpcRequest {
  readonly id: string;
  readonly type: string;
  readonly message?: InboundMessage;
}

type IpcResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };

type IpcTarget =
  | { readonly kind: "unix"; readonly path: string }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number };

export function hostSocketPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".vibekit", "runtime", "host.sock");
}

function hostIpcMetaPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".vibekit", "runtime", "host-ipc.json");
}

export async function startHostIpc(options: {
  readonly projectRoot: string;
  readonly submit: (message: InboundMessage) => Promise<SubmitResult>;
  readonly health?: () => Promise<unknown>;
}): Promise<HostIpcServer> {
  const projectRoot = path.resolve(options.projectRoot);
  const socketPath = hostSocketPath(projectRoot);
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });

  const connections = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => {
      connections.delete(socket);
    });
    attachConnection(socket, options);
  });

  if (process.platform === "win32") {
    await listen(server, { host: "127.0.0.1", port: 0 });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw hostError("internal_error", "host_ipc_bind_failed", "Host IPC failed to bind a local port");
    }
    const port = address.port;
    writeIpcMeta(projectRoot, port);
    return createHandle({ server, connections, socketPath, port, projectRoot });
  }

  unlinkIfExists(socketPath);
  try {
    await listen(server, socketPath);
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // best-effort owner-only mode
    }
    return createHandle({ server, connections, socketPath, projectRoot });
  } catch (error) {
    server.close();
    if (!isUnixPathUnusable(error)) {
      throw error;
    }
    const tcpServer = net.createServer((socket) => {
      connections.add(socket);
      socket.on("close", () => {
        connections.delete(socket);
      });
      attachConnection(socket, options);
    });
    await listen(tcpServer, { host: "127.0.0.1", port: 0 });
    const address = tcpServer.address();
    if (address === null || typeof address === "string") {
      tcpServer.close();
      throw hostError("internal_error", "host_ipc_bind_failed", "Host IPC failed to bind a local port");
    }
    writeIpcMeta(projectRoot, address.port);
    return createHandle({
      server: tcpServer,
      connections,
      socketPath,
      port: address.port,
      projectRoot,
    });
  }
}

export async function stopHostIpc(server: HostIpcServer | undefined): Promise<void> {
  if (server === undefined) {
    return;
  }
  await server.close();
}

export async function isHostIpcAvailable(projectRoot: string): Promise<boolean> {
  const target = resolveIpcTarget(projectRoot);
  if (target === undefined) {
    return false;
  }
  try {
    const response = await sendIpcRequest(
      target,
      { id: requestId(), type: "health" },
      { timeoutMs: HEALTH_TIMEOUT_MS },
    );
    return response.ok === true;
  } catch {
    return false;
  }
}

export async function submitViaIpc(
  projectRoot: string,
  message: InboundMessage,
): Promise<SubmitResult> {
  const target = resolveIpcTarget(projectRoot);
  if (target === undefined) {
    throw hostError("unavailable", "host_ipc_unavailable", "No Host IPC endpoint is available");
  }
  const response = await sendIpcRequest(target, {
    id: requestId(),
    type: "submit",
    message,
  });
  if (!response.ok) {
    throw hostError("external_error", "host_ipc_error", response.error);
  }
  return response.result as SubmitResult;
}

function attachConnection(
  socket: net.Socket,
  options: {
    readonly submit: (message: InboundMessage) => Promise<SubmitResult>;
    readonly health?: () => Promise<unknown>;
  },
): void {
  let buffer = "";
  let busy = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    void pump();
  });

  async function pump(): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    try {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          return;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          await handleLine(socket, line, options);
        }
      }
    } finally {
      busy = false;
      if (buffer.includes("\n")) {
        void pump();
      }
    }
  }
}

async function handleLine(
  socket: net.Socket,
  line: string,
  options: {
    readonly submit: (message: InboundMessage) => Promise<SubmitResult>;
    readonly health?: () => Promise<unknown>;
  },
): Promise<void> {
  let request: IpcRequest;
  try {
    request = JSON.parse(line) as IpcRequest;
  } catch {
    writeResponse(socket, { id: "", ok: false, error: "Invalid IPC request" });
    return;
  }
  if (typeof request.id !== "string" || request.id.length === 0) {
    writeResponse(socket, { id: "", ok: false, error: "Invalid IPC request" });
    return;
  }
  try {
    if (request.type === "health") {
      const result =
        options.health !== undefined
          ? await options.health()
          : { pid: process.pid, ready: true };
      writeResponse(socket, { id: request.id, ok: true, result });
      return;
    }
    if (request.type === "submit") {
      if (request.message === undefined || typeof request.message !== "object") {
        writeResponse(socket, { id: request.id, ok: false, error: "Missing message" });
        return;
      }
      const result = await options.submit(request.message);
      writeResponse(socket, { id: request.id, ok: true, result });
      return;
    }
    writeResponse(socket, { id: request.id, ok: false, error: "Unknown IPC request type" });
  } catch (error) {
    writeResponse(socket, {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Host IPC request failed",
    });
  }
}

function writeResponse(socket: net.Socket, response: IpcResponse): void {
  if (socket.destroyed || socket.writableEnded) {
    return;
  }
  socket.write(`${JSON.stringify(response)}\n`);
}

function createHandle(input: {
  readonly server: net.Server;
  readonly connections: Set<net.Socket>;
  readonly socketPath: string;
  readonly port?: number;
  readonly projectRoot: string;
}): HostIpcServer {
  let closed = false;
  return {
    socketPath: input.socketPath,
    port: input.port,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const socket of input.connections) {
        socket.destroy();
      }
      input.connections.clear();
      await new Promise<void>((resolve, reject) => {
        input.server.close((error) => {
          if (error !== undefined && !isNotRunning(error)) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      unlinkIfExists(input.socketPath);
      unlinkIfExists(hostIpcMetaPath(input.projectRoot));
    },
  };
}

function listen(server: net.Server, options: net.ListenOptions | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    if (typeof options === "string") {
      server.listen(options, onListening);
      return;
    }
    server.listen(options, onListening);
  });
}

function resolveIpcTarget(projectRoot: string): IpcTarget | undefined {
  if (process.platform !== "win32") {
    const socketPath = hostSocketPath(projectRoot);
    if (fs.existsSync(socketPath)) {
      return { kind: "unix", path: socketPath };
    }
  }
  const fromMeta = readTcpTarget(hostIpcMetaPath(projectRoot));
  if (fromMeta !== undefined) {
    return fromMeta;
  }
  return readTcpTargetFromStatus(projectRoot);
}

function readTcpTarget(metaPath: string): IpcTarget | undefined {
  if (!fs.existsSync(metaPath)) {
    return undefined;
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      host?: unknown;
      port?: unknown;
    };
    if (typeof meta.port !== "number" || !Number.isInteger(meta.port) || meta.port <= 0) {
      return undefined;
    }
    const host = typeof meta.host === "string" && meta.host.length > 0 ? meta.host : "127.0.0.1";
    return { kind: "tcp", host, port: meta.port };
  } catch {
    return undefined;
  }
}

function readTcpTargetFromStatus(projectRoot: string): IpcTarget | undefined {
  const statusPath = path.join(path.resolve(projectRoot), ".vibekit", "runtime", "host-status.json");
  if (!fs.existsSync(statusPath)) {
    return undefined;
  }
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8")) as { ipcPort?: unknown };
    if (typeof status.ipcPort !== "number" || !Number.isInteger(status.ipcPort) || status.ipcPort <= 0) {
      return undefined;
    }
    return { kind: "tcp", host: "127.0.0.1", port: status.ipcPort };
  } catch {
    return undefined;
  }
}

function writeIpcMeta(projectRoot: string, port: number): void {
  const metaPath = hostIpcMetaPath(projectRoot);
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({ host: "127.0.0.1", port, pid: process.pid })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    fs.chmodSync(metaPath, 0o600);
  } catch {
    // best-effort owner-only mode
  }
}

function sendIpcRequest(
  target: IpcTarget,
  request: IpcRequest,
  options?: { readonly timeoutMs?: number },
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(target);
    let buffer = "";
    let settled = false;
    const timer =
      options?.timeoutMs !== undefined
        ? setTimeout(() => {
            fail(hostError("timed_out", "host_ipc_timeout", "Host IPC timed out"));
          }, options.timeoutMs)
        : undefined;

    const succeed = (value: IpcResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket.destroy();
      resolve(value);
    };
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      socket.destroy();
      reject(error);
    };

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = buffer.slice(0, newline).trim();
      try {
        succeed(JSON.parse(line) as IpcResponse);
      } catch {
        fail(hostError("external_error", "host_ipc_error", "Invalid IPC response"));
      }
    });
    socket.once("error", (error) => {
      fail(error);
    });
    socket.once("end", () => {
      fail(hostError("unavailable", "host_ipc_closed", "Host IPC connection closed"));
    });
  });
}

function connect(target: IpcTarget): net.Socket {
  if (target.kind === "unix") {
    return net.connect({ path: target.path });
  }
  return net.connect({ host: target.host, port: target.port });
}

function unlinkIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

function isNotRunning(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING";
}

function isUnixPathUnusable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EINVAL" || code === "ENAMETOOLONG";
}

function requestId(): string {
  return globalThis.crypto.randomUUID();
}
