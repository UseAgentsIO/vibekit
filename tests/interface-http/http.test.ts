import http from "node:http";

import { conversationKeyOf, type InboundMessage, type InterfaceServices } from "@useagentsio/interface-sdk";

import { createHttpInterface, HttpInterface } from "../../packages/cli/src/internal/interfaces/http/index.js";
import { afterEach, describe, expect, it } from "vitest";

interface ApprovalCall {
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly notes?: string;
}

function recordingServices(secrets: Record<string, string> = {}): {
  services: InterfaceServices;
  submissions: InboundMessage[];
  cancels: string[];
  approvals: ApprovalCall[];
} {
  const submissions: InboundMessage[] = [];
  const cancels: string[] = [];
  const approvals: ApprovalCall[] = [];
  return {
    submissions,
    cancels,
    approvals,
    services: {
      submit: async (message) => {
        submissions.push(message);
      },
      cancel: async (conversationKey) => {
        cancels.push(conversationKey);
        return true;
      },
      approve: async (approvalId, decision, notes) => {
        approvals.push({ approvalId, decision, notes });
      },
      resolveSecret: (name) => {
        const value = secrets[name];
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
        throw new Error(`Missing secret ${name}`);
      },
      log: {
        info() {},
        warn() {},
        error() {},
      },
    },
  };
}

const token = "http-test-token";
const conversationKey = conversationKeyOf({
  interfaceBinding: "http-main",
  accountId: "local",
  conversationId: "http",
});

let running: HttpInterface | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function startHttp(
  services: InterfaceServices,
  config: Record<string, unknown> = {},
): Promise<HttpInterface> {
  const iface = await createHttpInterface({ port: 0, host: "127.0.0.1", ...config }, services);
  expect(iface).toBeInstanceOf(HttpInterface);
  await iface.start();
  running = iface as HttpInterface;
  return running;
}

describe("HttpInterface", () => {
  it("serves unauthenticated health without leaking secrets", async () => {
    const { services } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const response = await jsonRequest({ port: iface.port, method: "GET", path: "/health" });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true, connected: true });
    expect(response.raw.includes(token)).toBe(false);
    expect(response.raw.toLowerCase().includes("vibekit_http_token")).toBe(false);
  });

  it("returns 401 without a bearer token and does not submit", async () => {
    const { services, submissions } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/message",
      body: { text: "hello" },
    });

    expect(response.status).toBe(401);
    expect(submissions).toEqual([]);
  });

  it("returns 401 when the token secret is missing", async () => {
    const { services, submissions } = recordingServices();
    const iface = await startHttp(services);
    const health = await jsonRequest({ port: iface.port, method: "GET", path: "/health" });
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/message",
      headers: { authorization: `Bearer ${token}` },
      body: { text: "hello" },
    });

    expect(health.status).toBe(200);
    expect(response.status).toBe(401);
    expect(submissions).toEqual([]);
  });

  it("returns 202 with a token and submits the expected InboundMessage", async () => {
    const { services, submissions } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/message",
      headers: { authorization: `Bearer ${token}` },
      body: {
        text: "hello",
        eventId: "evt-1",
        senderId: "operator",
      },
    });

    expect(response.status).toBe(202);
    expect(response.json).toEqual({ conversationKey, eventId: "evt-1" });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      eventId: "evt-1",
      interfaceBinding: "http-main",
      accountId: "local",
      conversationId: "http",
      conversationKey,
      sender: { id: "operator", trusted: true },
      text: "hello",
      attachments: [],
    });
    expect(submissions[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns 202 again for a duplicate eventId", async () => {
    const { services, submissions } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const body = { text: "hello", eventId: "evt-dup" };
    const first = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/message",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    const second = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/message",
      headers: { authorization: `Bearer ${token}` },
      body,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(submissions).toHaveLength(2);
    expect(submissions.map((item) => item.eventId)).toEqual(["evt-dup", "evt-dup"]);
  });

  it("cancels by conversationKey", async () => {
    const { services, cancels } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/cancel",
      headers: { authorization: `Bearer ${token}` },
      body: { conversationKey },
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ conversationKey, cancelled: true });
    expect(cancels).toEqual([conversationKey]);
  });

  it("forwards approval decisions", async () => {
    const { services, approvals } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/approve",
      headers: { authorization: `Bearer ${token}` },
      body: { approvalId: "approval-1", decision: "approved", notes: "ok" },
    });

    expect(response.status).toBe(200);
    expect(approvals).toEqual([{ approvalId: "approval-1", decision: "approved", notes: "ok" }]);
  });

  it("stores delivered outputs in memory for programmatic clients", async () => {
    const { services } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await startHttp(services);
    await iface.deliver({
      type: "message.completed",
      conversationKey,
      text: "done",
    });
    const response = await jsonRequest({
      port: iface.port,
      method: "GET",
      path: `/conversations/${encodeURIComponent(conversationKey)}/outputs`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      outputs: [{ type: "message.completed", conversationKey, text: "done" }],
    });
  });

  it("refuses to bind a non-loopback address", async () => {
    const { services } = recordingServices({ VIBEKIT_HTTP_TOKEN: token });
    const iface = await createHttpInterface({ host: "0.0.0.0", port: 0 }, services);
    await expect(iface.start()).rejects.toThrow(/non-loopback/);
  });
});

async function jsonRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; json: unknown; raw: string }> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        headers: {
          ...(payload !== undefined
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: unknown;
          try {
            json = raw.length > 0 ? JSON.parse(raw) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json, raw });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}
