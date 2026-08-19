import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface McpTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface SpawnLike {
  (
    command: string,
    args: readonly string[],
    options: { env?: Record<string, string>; stdio: ["pipe", "pipe", "pipe"] },
  ): ChildProcess;
}

export function createStdioTransport(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
  spawnImpl: SpawnLike = spawn as SpawnLike,
): McpTransport {
  const child = spawnImpl(command, [...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  return new StdioJsonRpc(child);
}

class StdioJsonRpc implements McpTransport {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly events = new EventEmitter();

  constructor(private readonly child: ChildProcess) {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.on("error", (error) => {
      this.failAll(error instanceof Error ? error : new Error("MCP stdio failed"));
    });
    child.on("exit", (code, signal) => {
      this.failAll(new Error(`MCP server exited (${code ?? signal ?? "unknown"})`));
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method };
    if (params !== undefined) {
      payload.params = params;
    }
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.write(payload);
    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      payload.params = params;
    }
    await this.write(payload);
  }

  async close(): Promise<void> {
    this.failAll(new Error("MCP transport closed"));
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
    }
  }

  private async write(message: unknown): Promise<void> {
    const json = JSON.stringify(message);
    const frame = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
    const stdin = this.child.stdin;
    if (stdin === null) {
      throw new Error("MCP stdin is not available");
    }
    await new Promise<void>((resolve, reject) => {
      stdin.write(frame, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const framed = this.takeFramed();
      if (framed === "need-more") {
        return;
      }
      if (framed !== undefined) {
        this.handle(framed);
        continue;
      }
      const lined = this.takeLine();
      if (lined === "need-more") {
        return;
      }
      if (lined !== undefined) {
        this.handle(lined);
        continue;
      }
      return;
    }
  }

  private takeFramed(): unknown | "need-more" | undefined {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return undefined;
    }
    const header = this.buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null || match[1] === undefined) {
      return undefined;
    }
    const length = Number.parseInt(match[1], 10);
    const start = headerEnd + 4;
    if (this.buffer.length < start + length) {
      return "need-more";
    }
    const body = this.buffer.subarray(start, start + length).toString("utf8");
    this.buffer = this.buffer.subarray(start + length);
    return JSON.parse(body) as unknown;
  }

  private takeLine(): unknown | "need-more" | undefined {
    const text = this.buffer.toString("utf8");
    if (text.startsWith("Content-Length:")) {
      return this.buffer.includes("\r\n\r\n") ? "need-more" : undefined;
    }
    const newline = text.indexOf("\n");
    if (newline === -1) {
      return undefined;
    }
    const line = text.slice(0, newline).trim();
    this.buffer = this.buffer.subarray(newline + 1);
    if (line.length === 0) {
      return undefined;
    }
    return JSON.parse(line) as unknown;
  }

  private handle(message: unknown): void {
    if (message === null || typeof message !== "object") {
      return;
    }
    const row = message as Record<string, unknown>;
    if (typeof row.id === "number") {
      const pending = this.pending.get(row.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(row.id);
      if (row.error !== undefined) {
        pending.reject(new Error(rpcError(row.error)));
        return;
      }
      pending.resolve(row.result);
      return;
    }
    this.events.emit("notification", row);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function rpcError(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "MCP request failed";
}
