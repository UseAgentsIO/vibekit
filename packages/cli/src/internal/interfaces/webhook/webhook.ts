import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
} from "../sdk/index.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const DEFAULT_PATH = "/webhook";
const DEFAULT_BINDING = "webhook-main";
const DEFAULT_ACCOUNT = "webhook";
const DEFAULT_SECRET_NAME = "VIBEKIT_WEBHOOK_SECRET";
const DEFAULT_SIGNATURE_HEADER = "x-hub-signature-256";
const DEFAULT_TOKEN_HEADER = "x-vibekit-token";
const DEFAULT_EVENT_ID_HEADER = "x-github-delivery";
const DEFAULT_CONVERSATION = "webhook";
const MAX_BODY_BYTES = 1_048_576;
const MAX_TEXT_CHARS = 8_000;
const MAX_STORED_OUTPUTS = 100;

export interface WebhookInterfaceConfig {
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
  readonly interfaceBinding?: string;
  readonly accountId?: string;
  readonly secretName?: string;
  readonly signatureHeader?: string;
  readonly eventIdHeader?: string;
  readonly conversationId?: string;
  readonly allowNonLoopback?: boolean;
}

type ResolvedWebhookConfig = {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly interfaceBinding: string;
  readonly accountId: string;
  readonly secretName: string;
  readonly signatureHeader: string;
  readonly eventIdHeader: string;
  readonly conversationId: string;
  readonly allowNonLoopback: boolean;
};

export class WebhookInterface implements RunningInterface {
  private started = false;
  private server?: Server;
  private readonly resolved: ResolvedWebhookConfig;
  private readonly outputs = new Map<string, HostOutput[]>();

  constructor(
    config: Record<string, unknown>,
    private readonly services: InterfaceServices,
  ) {
    this.resolved = resolveWebhookConfig(config);
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

  get path(): string {
    return this.resolved.path;
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
      detail: "webhook",
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

      if (path !== this.resolved.path) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      if (method !== "POST") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }

      const raw = await readRequestBody(req, MAX_BODY_BYTES);
      const secret = resolveOptionalSecret(this.services, this.resolved.secretName);
      if (secret === undefined) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      if (!this.verified(req, raw, secret)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      let parsed: unknown;
      try {
        parsed = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }
      const body = isRecord(parsed) ? parsed : {};
      const message = this.toInboundMessage(req, body);
      await this.services.submit(message);
      sendJson(res, 202, { conversationKey: message.conversationKey, eventId: message.eventId });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "PAYLOAD_TOO_LARGE") {
        sendJson(res, 413, { error: "payload too large" });
        return;
      }
      this.services.log.error("webhook request failed");
      sendJson(res, 500, { error: "internal error" });
    }
  }

  private verified(req: IncomingMessage, raw: Buffer, secret: string): boolean {
    const signature = headerValue(req.headers[this.resolved.signatureHeader]);
    if (signature !== undefined && verifyGitHubSignature(raw, secret, signature)) {
      return true;
    }
    const token = headerValue(req.headers[DEFAULT_TOKEN_HEADER]);
    return token !== undefined && timingSafeEqualString(token, secret);
  }

  private toInboundMessage(req: IncomingMessage, body: Record<string, unknown>): InboundMessage {
    const senderRecord = isRecord(body.sender) ? body.sender : undefined;
    const repository = isRecord(body.repository) ? body.repository : undefined;
    const issue = isRecord(body.issue) ? body.issue : undefined;
    const pullRequest = isRecord(body.pull_request) ? body.pull_request : undefined;

    const senderLogin = optionalString(senderRecord?.login);
    const senderId = senderLogin ?? optionalString(senderRecord?.id) ?? "webhook";
    const conversationId =
      optionalString(body.conversationId) ??
      optionalString(repository?.full_name) ??
      this.resolved.conversationId;
    const threadId =
      optionalString(body.threadId) ??
      optionalString(issue?.number) ??
      optionalString(pullRequest?.number);
    const eventId =
      headerValue(req.headers[this.resolved.eventIdHeader]) ??
      optionalString(body.eventId) ??
      `webhook-${randomUUID()}`;
    const conversationKey = conversationKeyOf({
      interfaceBinding: this.resolved.interfaceBinding,
      accountId: this.resolved.accountId,
      conversationId,
      threadId,
    });

    return {
      eventId,
      interfaceBinding: this.resolved.interfaceBinding,
      accountId: this.resolved.accountId,
      conversationId,
      ...(threadId !== undefined ? { threadId } : {}),
      conversationKey,
      sender: {
        id: senderId,
        ...(senderLogin !== undefined ? { displayName: senderLogin } : {}),
        trusted: false,
      },
      text: extractWebhookText(body),
      attachments: [],
      timestamp: new Date().toISOString(),
    };
  }
}

export const createWebhookInterface: InterfaceFactory["create"] = async (config, services) =>
  new WebhookInterface(config, services);

function extractWebhookText(body: Record<string, unknown>): string {
  if (typeof body.text === "string" && body.text.trim().length > 0) {
    return boundText(body.text);
  }
  const comment = isRecord(body.comment) ? body.comment : undefined;
  if (typeof comment?.body === "string" && comment.body.trim().length > 0) {
    return boundText(comment.body);
  }
  const issue = isRecord(body.issue) ? body.issue : undefined;
  if (issue !== undefined) {
    const title = typeof issue.title === "string" ? issue.title : "";
    const issueBody = typeof issue.body === "string" ? issue.body : "";
    const combined = [title, issueBody].filter((part) => part.length > 0).join("\n\n");
    if (combined.length > 0) {
      return boundText(combined);
    }
  }
  const repository = isRecord(body.repository) ? body.repository : undefined;
  const sender = isRecord(body.sender) ? body.sender : undefined;
  return boundText(
    JSON.stringify({
      action: typeof body.action === "string" ? body.action : "",
      repository: typeof repository?.full_name === "string" ? repository.full_name : "",
      sender: typeof sender?.login === "string" ? sender.login : "",
    }),
  );
}

function boundText(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : text.slice(0, MAX_TEXT_CHARS);
}

function resolveWebhookConfig(config: Record<string, unknown>): ResolvedWebhookConfig {
  return {
    host: stringOption(config.host, DEFAULT_HOST),
    port: numberOption(config.port, DEFAULT_PORT),
    path: normalizeRoutePath(stringOption(config.path, DEFAULT_PATH)),
    interfaceBinding: stringOption(config.interfaceBinding, DEFAULT_BINDING),
    accountId: stringOption(config.accountId, DEFAULT_ACCOUNT),
    secretName: stringOption(config.secretName, DEFAULT_SECRET_NAME),
    signatureHeader: stringOption(config.signatureHeader, DEFAULT_SIGNATURE_HEADER).toLowerCase(),
    eventIdHeader: stringOption(config.eventIdHeader, DEFAULT_EVENT_ID_HEADER).toLowerCase(),
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

function verifyGitHubSignature(rawBody: Buffer, secret: string, signature: string): boolean {
  // HMAC the raw request bytes, not a re-serialized JSON object.
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = `sha256=${digest}`;
  return timingSafeEqualString(signature.trim(), expected);
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

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname.length === 0 ? "/" : pathname;
}

function normalizeRoutePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return normalizePath(withSlash);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) {
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
  });
  res.end(payload);
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
