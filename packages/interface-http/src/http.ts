import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIP } from "node:net";

import {
  conversationKeyOf,
  type HostOutput,
  type InboundMessage,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_BINDING = "http-main";
const DEFAULT_ACCOUNT = "local";
const DEFAULT_TOKEN_SECRET = "VIBEKIT_HTTP_TOKEN";
const DEFAULT_CONVERSATION = "http";
const MAX_BODY_BYTES = 1_048_576;
const MAX_STORED_OUTPUTS = 100;

export interface HttpInterfaceConfig {
  readonly host?: string;
  readonly port?: number;
  readonly interfaceBinding?: string;
  readonly accountId?: string;
  readonly tokenSecretName?: string;
  readonly conversationId?: string;
  readonly allowNonLoopback?: boolean;
}

type ResolvedHttpConfig = {
  readonly host: string;
  readonly port: number;
  readonly interfaceBinding: string;
  readonly accountId: string;
  readonly tokenSecretName: string;
  readonly conversationId: string;
  readonly allowNonLoopback: boolean;
};

export class HttpInterface implements RunningInterface {
  private started = false;
  private server?: Server;
  private readonly resolved: ResolvedHttpConfig;
  private readonly pairingRequired: boolean;
  private readonly outputs = new Map<string, HostOutput[]>();

  constructor(
    config: Record<string, unknown>,
    private readonly services: InterfaceServices,
  ) {
    this.resolved = resolveHttpConfig(config);
    this.pairingRequired = config.pairingRequired === true;
  }

  get port(): number {
    const address = this.server?.address();
    if (typeof address === "object" && address !== null) {
      return address.port;
    }
    return this.resolved.port;
  }

  get host(): string {
    return this.resolved.host;
  }

  outputsFor(conversationKey: string): readonly HostOutput[] {
    return this.outputs.get(conversationKey) ?? [];
  }

  async start(): Promise<void> {
    if (this.started && this.server !== undefined) {
      return;
    }
    assertLoopbackBind(this.resolved.host, this.resolved.allowNonLoopback);
    assertValidPort(this.resolved.port);

    const server = createServer((req, res) => {
      void this.dispatch(req, res);
    });
    this.server = server;
    try {
      await listen(server, this.resolved.port, this.resolved.host);
      this.started = true;
    } catch (error) {
      this.started = false;
      this.server = undefined;
      server.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.started = false;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    });
  }

  async deliver(output: HostOutput): Promise<void> {
    const list = this.outputs.get(output.conversationKey) ?? [];
    list.push(output);
    if (list.length > MAX_STORED_OUTPUTS) {
      list.splice(0, list.length - MAX_STORED_OUTPUTS);
    }
    this.outputs.set(output.conversationKey, list);
  }

  async health(): Promise<InterfaceHealth> {
    const listening = this.started && this.server?.listening === true;
    return {
      ok: listening,
      connected: listening,
      detail: "http",
    };
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = normalizePath(url.pathname);
      const method = (req.method ?? "GET").toUpperCase();

      if (path === "/health") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        const health = await this.health();
        sendJson(res, 200, { ok: health.ok, connected: health.connected });
        return;
      }

      if (!this.authorize(req, res)) {
        return;
      }

      if (path === "/message") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        await this.handleMessage(req, res);
        return;
      }

      if (path === "/cancel") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        await this.handleCancel(req, res);
        return;
      }

      if (path === "/approve") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        await this.handleApprove(req, res);
        return;
      }

      const outputsMatch = /^\/conversations\/(.+)\/outputs$/.exec(path);
      if (outputsMatch !== null) {
        if (method !== "GET") {
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        const key = decodeURIComponent(outputsMatch[1] ?? "");
        sendJson(res, 200, { outputs: this.outputs.get(key) ?? [] });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "PAYLOAD_TOO_LARGE") {
        sendJson(res, 413, { error: "payload too large" });
        return;
      }
      this.services.log.error("http request failed");
      sendJson(res, 500, { error: "internal error" });
    }
  }

  private authorize(req: IncomingMessage, res: ServerResponse): boolean {
    const token = resolveOptionalSecret(this.services, this.resolved.tokenSecretName);
    const presented = bearerToken(headerValue(req.headers.authorization));
    if (token === undefined || presented === undefined || !timingSafeEqualString(presented, token)) {
      sendJson(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
      return false;
    }
    return true;
  }

  private async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (body === undefined) {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const text = typeof body.text === "string" ? body.text : undefined;
    if (text === undefined || text.trim().length === 0) {
      sendJson(res, 400, { error: "text is required" });
      return;
    }

    const conversationId =
      optionalString(body.conversationId) ??
      headerValue(req.headers["x-conversation-id"]) ??
      this.resolved.conversationId;
    const threadId =
      optionalString(body.threadId) ?? headerValue(req.headers["x-thread-id"]);
    const eventId =
      optionalString(body.eventId) ??
      headerValue(req.headers["x-event-id"]) ??
      `http-${randomUUID()}`;
    const senderId = optionalString(body.senderId) ?? this.resolved.accountId;
    const conversationKey = conversationKeyOf({
      interfaceBinding: this.resolved.interfaceBinding,
      accountId: this.resolved.accountId,
      conversationId,
      threadId,
    });
    const message: InboundMessage = {
      eventId,
      interfaceBinding: this.resolved.interfaceBinding,
      accountId: this.resolved.accountId,
      conversationId,
      ...(threadId !== undefined ? { threadId } : {}),
      conversationKey,
      sender: { id: senderId, displayName: senderId, trusted: !this.pairingRequired },
      text,
      attachments: [],
      timestamp: new Date().toISOString(),
    };
    await this.services.submit(message);
    sendJson(res, 202, { conversationKey, eventId });
  }

  private async handleCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (body === undefined) {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const conversationKey = optionalString(body.conversationKey);
    if (conversationKey === undefined) {
      sendJson(res, 400, { error: "conversationKey is required" });
      return;
    }
    const cancelled = await this.services.cancel(conversationKey);
    sendJson(res, 200, { conversationKey, cancelled });
  }

  private async handleApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (body === undefined) {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const approvalId = optionalString(body.approvalId);
    const decision = body.decision;
    if (approvalId === undefined) {
      sendJson(res, 400, { error: "approvalId is required" });
      return;
    }
    if (decision !== "approved" && decision !== "rejected") {
      sendJson(res, 400, { error: "decision must be approved or rejected" });
      return;
    }
    const notes = optionalString(body.notes);
    await this.services.approve(approvalId, decision, notes);
    sendJson(res, 200, { approvalId, decision });
  }
}

export const createHttpInterface: InterfaceFactory["create"] = async (config, services) =>
  new HttpInterface(config, services);

function resolveHttpConfig(config: Record<string, unknown>): ResolvedHttpConfig {
  return {
    host: stringOption(config.host, DEFAULT_HOST),
    port: numberOption(config.port, DEFAULT_PORT),
    interfaceBinding: stringOption(config.interfaceBinding, DEFAULT_BINDING),
    accountId: stringOption(config.accountId, DEFAULT_ACCOUNT),
    tokenSecretName: stringOption(config.tokenSecretName, DEFAULT_TOKEN_SECRET),
    conversationId: stringOption(config.conversationId, DEFAULT_CONVERSATION),
    allowNonLoopback: config.allowNonLoopback === true,
  };
}

function stringOption(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function numberOption(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function assertLoopbackBind(host: string, allowNonLoopback: boolean): void {
  if (allowNonLoopback || isLoopbackHost(host)) {
    return;
  }
  throw new Error(
    `Refusing to bind non-loopback address ${host}. Set allowNonLoopback to true to override.`,
  );
}

function isLoopbackHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (bare === "localhost" || bare === "::1" || bare === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (bare.startsWith("::ffff:")) {
    return isLoopbackHost(bare.slice("::ffff:".length));
  }
  if (isIP(bare) === 4) {
    return bare.startsWith("127.");
  }
  return false;
}

function assertValidPort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port ${port}`);
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function resolveOptionalSecret(services: InterfaceServices, name: string): string | undefined {
  try {
    const value = services.resolveSecret(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    if (leftBuf.length > 0) {
      timingSafeEqual(leftBuf, Buffer.alloc(leftBuf.length));
    }
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname.length === 0 ? "/" : pathname;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  if (res.writableEnded) {
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    ...extraHeaders,
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const raw = await readRequestBody(req, MAX_BODY_BYTES);
  if (raw.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > maxBytes) {
        fail(Object.assign(new Error("payload too large"), { code: "PAYLOAD_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
