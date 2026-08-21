import { createHmac } from "node:crypto";
import http from "node:http";

import { type InboundMessage, type InterfaceServices } from "@useagentsio/interface-sdk";

import { createWebhookInterface, WebhookInterface } from "../../packages/cli/src/internal/interfaces/webhook/index.js";
import { afterEach, describe, expect, it } from "vitest";

function recordingServices(secrets: Record<string, string> = {}): {
  services: InterfaceServices;
  submissions: InboundMessage[];
} {
  const submissions: InboundMessage[] = [];
  return {
    submissions,
    services: {
      submit: async (message) => {
        submissions.push(message);
      },
      cancel: async () => true,
      approve: async () => undefined,
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

const webhookSecret = "webhook-test-secret";

let running: WebhookInterface | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function startWebhook(
  services: InterfaceServices,
  config: Record<string, unknown> = {},
): Promise<WebhookInterface> {
  const iface = await createWebhookInterface({ port: 0, host: "127.0.0.1", ...config }, services);
  expect(iface).toBeInstanceOf(WebhookInterface);
  await iface.start();
  running = iface as WebhookInterface;
  return running;
}

describe("WebhookInterface", () => {
  it("rejects an invalid HMAC and does not submit", async () => {
    const { services, submissions } = recordingServices({
      VIBEKIT_WEBHOOK_SECRET: webhookSecret,
    });
    const iface = await startWebhook(services);
    const body = { text: "hello", eventId: "evt-bad" };
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/webhook",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body,
    });

    expect(response.status).toBe(401);
    expect(submissions).toEqual([]);
  });

  it("accepts a valid GitHub HMAC and marks the sender untrusted", async () => {
    const { services, submissions } = recordingServices({
      VIBEKIT_WEBHOOK_SECRET: webhookSecret,
    });
    const iface = await startWebhook(services);
    const body = {
      action: "created",
      comment: { body: "please review" },
      repository: { full_name: "acme/app" },
      sender: { login: "octocat", trusted: true },
      issue: { number: 12, title: "Bug", body: "broken" },
    };
    const raw = JSON.stringify(body);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/webhook",
      headers: {
        "x-hub-signature-256": sign(webhookSecret, raw),
        "x-github-delivery": "delivery-1",
      },
      raw,
    });

    expect(response.status).toBe(202);
    expect(response.json).toEqual({
      conversationKey: "webhook-main:webhook:acme/app:12",
      eventId: "delivery-1",
    });
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      eventId: "delivery-1",
      interfaceBinding: "webhook-main",
      accountId: "webhook",
      conversationId: "acme/app",
      threadId: "12",
      conversationKey: "webhook-main:webhook:acme/app:12",
      sender: { id: "octocat", trusted: false },
      text: "please review",
      attachments: [],
    });
  });

  it("accepts x-vibekit-token as an alternative to HMAC", async () => {
    const { services, submissions } = recordingServices({
      VIBEKIT_WEBHOOK_SECRET: webhookSecret,
    });
    const iface = await startWebhook(services);
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/webhook",
      headers: { "x-vibekit-token": webhookSecret },
      body: { text: "via token", eventId: "evt-token" },
    });

    expect(response.status).toBe(202);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.sender.trusted).toBe(false);
    expect(submissions[0]?.text).toBe("via token");
  });

  it("returns 401 when the webhook secret is missing and does not submit", async () => {
    const { services, submissions } = recordingServices();
    const iface = await startWebhook(services);
    const raw = JSON.stringify({ text: "hello" });
    const response = await jsonRequest({
      port: iface.port,
      method: "POST",
      path: "/webhook",
      headers: { "x-hub-signature-256": sign(webhookSecret, raw) },
      raw,
    });

    expect(response.status).toBe(401);
    expect(submissions).toEqual([]);
  });

  it("refuses to bind a non-loopback address", async () => {
    const { services } = recordingServices({ VIBEKIT_WEBHOOK_SECRET: webhookSecret });
    const iface = await createWebhookInterface({ host: "0.0.0.0", port: 0 }, services);
    await expect(iface.start()).rejects.toThrow(/non-loopback/);
  });
});

function sign(secret: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

async function jsonRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  raw?: string;
}): Promise<{ status: number; json: unknown; raw: string }> {
  const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
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
