import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { conversationKeyOf, type InboundMessage, type InterfaceServices } from "@useagentsio/interface-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  approvePairing,
  createDefaultSlackTransport,
  createSlackInterface,
  listPairings,
  pairingStorePath,
  parseSlackInbound,
  revokePairing,
  SlackInterface,
  type SlackInbound,
  type SlackTransport,
} from "../../packages/interface-slack/src/index.js";

interface ApprovalCall {
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly notes?: string;
}

class FakeSlackTransport implements SlackTransport {
  handler?: (event: SlackInbound) => Promise<void>;
  readonly posts: unknown[] = [];
  started = false;

  async start(handlers: { onEvent(event: SlackInbound): Promise<void> }): Promise<void> {
    this.handler = handlers.onEvent;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.handler = undefined;
  }

  async postMessage(payload: unknown): Promise<void> {
    this.posts.push(payload);
  }

  async emit(event: SlackInbound): Promise<void> {
    if (this.handler === undefined) {
      throw new Error("transport is not started");
    }
    await this.handler(event);
  }
}

function recordingServices(): {
  services: InterfaceServices;
  submissions: InboundMessage[];
  approvals: ApprovalCall[];
} {
  const submissions: InboundMessage[] = [];
  const approvals: ApprovalCall[] = [];
  return {
    submissions,
    approvals,
    services: {
      submit: async (message) => {
        submissions.push(message);
      },
      cancel: async () => true,
      approve: async (approvalId, decision, notes) => {
        approvals.push({ approvalId, decision, notes });
      },
      resolveSecret: () => {
        throw new Error("secret should not be resolved when transport is injected");
      },
      log: {
        info() {},
        warn() {},
        error() {},
      },
    },
  };
}

const temps: string[] = [];

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-slack-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function startSlack(options: {
  projectRoot: string;
  transport: FakeSlackTransport;
  allowFrom?: string[];
  optionalStart?: boolean;
  services?: InterfaceServices;
}): Promise<{ iface: SlackInterface; services: InterfaceServices; submissions: InboundMessage[]; approvals: ApprovalCall[] }> {
  const recorded = recordingServices();
  const services = options.services ?? recorded.services;
  const iface = await createSlackInterface(
    {
      interfaceBinding: "slack-main",
      projectRoot: options.projectRoot,
      transport: options.transport,
      allowFrom: options.allowFrom ?? [],
      optionalStart: options.optionalStart,
      pairingRequired: true,
    },
    services,
  );
  expect(iface).toBeInstanceOf(SlackInterface);
  await iface.start();
  return {
    iface: iface as SlackInterface,
    services,
    submissions: recorded.submissions,
    approvals: recorded.approvals,
  };
}

const mention: SlackInbound = {
  kind: "app_mention",
  eventId: "Ev001",
  teamId: "T1",
  channel: "C1",
  userId: "U-unpaired",
  userName: "Ada",
  text: "hello",
  ts: "1710000000.000100",
};

describe("interface:slack pairing", () => {
  it("does not submit for an unpaired user and issues a pairing code", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, submissions } = await startSlack({ projectRoot, transport });

    await transport.emit(mention);

    expect(submissions).toEqual([]);
    const listed = listPairings(projectRoot);
    expect(listed.paired).toEqual([]);
    expect(listed.pending).toHaveLength(1);
    expect(listed.pending[0]?.userId).toBe("U-unpaired");
    expect(listed.pending[0]?.code).toMatch(/^[A-Z2-9]{8}$/);
    const posted = transport.posts[0] as { text?: string };
    expect(posted.text).toContain(listed.pending[0]?.code);
    expect(fs.existsSync(pairingStorePath(projectRoot))).toBe(true);
    await iface.stop();
  });

  it("submits after approvePairing", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, submissions } = await startSlack({ projectRoot, transport });

    await transport.emit(mention);
    expect(submissions).toEqual([]);
    const code = listPairings(projectRoot).pending[0]?.code;
    expect(code).toBeDefined();
    approvePairing(projectRoot, code ?? "");

    await transport.emit({ ...mention, eventId: "Ev002", text: "now paired" });

    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.text).toBe("now paired");
    expect(submissions[0]?.sender).toEqual({
      id: "U-unpaired",
      displayName: "Ada",
      trusted: true,
    });
    expect(submissions[0]?.conversationKey).toBe(
      conversationKeyOf({
        interfaceBinding: "slack-main",
        accountId: "T1",
        conversationId: "C1",
        threadId: undefined,
      }),
    );
    await iface.stop();
  });

  it("lets allowFrom bypass pairing", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, submissions } = await startSlack({
      projectRoot,
      transport,
      allowFrom: ["U-allow"],
    });

    await transport.emit({
      kind: "message",
      eventId: "Ev-allow",
      teamId: "T9",
      channel: "D1",
      userId: "U-allow",
      text: "from allowlist",
      channelType: "im",
    });

    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.text).toBe("from allowlist");
    expect(submissions[0]?.sender.trusted).toBe(true);
    expect(listPairings(projectRoot).pending).toEqual([]);
    await iface.stop();
  });

  it("rejects an expired pairing code", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface } = await startSlack({ projectRoot, transport });
    await transport.emit(mention);
    const pending = listPairings(projectRoot).pending[0];
    expect(pending).toBeDefined();
    const storePath = pairingStorePath(projectRoot);
    const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
      pending: Record<string, { expiresAt: string }>;
    };
    store.pending[pending!.code] = {
      ...store.pending[pending!.code],
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
    expect(() => approvePairing(projectRoot, pending!.code)).toThrow(/expired/i);
    await iface.stop();
  });

  it("revokes a paired sender so later messages are blocked", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, submissions } = await startSlack({ projectRoot, transport });
    await transport.emit(mention);
    approvePairing(projectRoot, listPairings(projectRoot).pending[0]?.code ?? "");
    expect(revokePairing(projectRoot, "U-unpaired")).toBe(true);
    await transport.emit({ ...mention, eventId: "Ev-after-revoke", text: "again" });
    expect(submissions).toEqual([]);
    expect(listPairings(projectRoot).pending).toHaveLength(1);
    await iface.stop();
  });
});

describe("interface:slack approvals", () => {
  it("posts approval buttons and forwards block_actions to services.approve", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, approvals, submissions } = await startSlack({
      projectRoot,
      transport,
      allowFrom: ["U-op"],
    });
    const conversationKey = conversationKeyOf({
      interfaceBinding: "slack-main",
      accountId: "T1",
      conversationId: "C1",
      threadId: "1710000000.000001",
    });

    await transport.emit({
      kind: "message",
      eventId: "seed",
      teamId: "T1",
      channel: "C1",
      userId: "U-op",
      text: "please apply",
      threadTs: "1710000000.000001",
    });
    expect(submissions).toHaveLength(1);

    await iface.deliver({
      type: "approval.requested",
      conversationKey,
      approvalId: "approval_550e8400-e29b-41d4-a716-446655440010",
      question: "Apply this change?",
      options: [
        { id: "approved", label: "Yes" },
        { id: "rejected", label: "No" },
      ],
    });

    const card = transport.posts.at(-1) as {
      blocks?: Array<{ elements?: Array<{ action_id?: string; value?: string }> }>;
    };
    const buttons = card.blocks?.[1]?.elements ?? [];
    expect(buttons.map((button) => button.action_id)).toEqual(["approve", "reject"]);
    expect(buttons[0]?.value).toBe("approval_550e8400-e29b-41d4-a716-446655440010");

    await transport.emit({
      kind: "block_actions",
      eventId: "act-1",
      teamId: "T1",
      channel: "C1",
      userId: "U-op",
      threadTs: "1710000000.000001",
      actionId: "approve",
      actionValue: "approval_550e8400-e29b-41d4-a716-446655440010",
    });

    expect(approvals).toEqual([
      { approvalId: "approval_550e8400-e29b-41d4-a716-446655440010", decision: "approved" },
    ]);
    expect(submissions).toHaveLength(1);
    await iface.stop();
  });

  it("does not approve when the acting user is unpaired", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, approvals } = await startSlack({ projectRoot, transport });
    await transport.emit({
      kind: "block_actions",
      eventId: "act-unpaired",
      channel: "C1",
      userId: "U-stranger",
      actionId: "approve",
      actionValue: "approval_550e8400-e29b-41d4-a716-446655440011",
    });
    expect(approvals).toEqual([]);
    expect(listPairings(projectRoot).pending[0]?.userId).toBe("U-stranger");
    await iface.stop();
  });
});

describe("interface:slack start and mapping", () => {
  it("fails closed without tokens unless optionalStart is set", async () => {
    const services: InterfaceServices = {
      submit: async () => undefined,
      cancel: async () => true,
      approve: async () => undefined,
      resolveSecret: () => {
        throw new Error("missing");
      },
      log: { info() {}, warn() {}, error() {} },
    };
    const required = await createSlackInterface({ projectRoot: tempProject() }, services);
    await expect(required.start()).rejects.toThrow(/SLACK_BOT_TOKEN|SLACK_APP_TOKEN|WebSocket/);
    const optional = await createSlackInterface(
      { projectRoot: tempProject(), optionalStart: true },
      services,
    );
    await optional.start();
    const health = await optional.health();
    expect(health.ok).toBe(false);
    expect(health.connected).toBe(false);
    expect(health.detail).toMatch(/unavailable/);
    await optional.stop();
  });

  it("posts completed text and maps thread conversation keys", async () => {
    const projectRoot = tempProject();
    const transport = new FakeSlackTransport();
    const { iface, submissions } = await startSlack({
      projectRoot,
      transport,
      allowFrom: ["U1"],
    });
    await transport.emit({
      kind: "message",
      eventId: "thread-1",
      teamId: "T1",
      channel: "C9",
      userId: "U1",
      text: "in thread",
      ts: "10.2",
      threadTs: "10.1",
    });
    expect(submissions[0]?.conversationKey).toBe(
      conversationKeyOf({
        interfaceBinding: "slack-main",
        accountId: "T1",
        conversationId: "C9",
        threadId: "10.1",
      }),
    );
    await iface.deliver({
      type: "text.delta",
      conversationKey: submissions[0]!.conversationKey,
      text: "Hel",
    });
    await iface.deliver({
      type: "message.completed",
      conversationKey: submissions[0]!.conversationKey,
      text: "Hello",
    });
    const posted = transport.posts.at(-1) as { text?: string; thread_ts?: string; channel?: string };
    expect(posted.text).toBe("Hello");
    expect(posted.channel).toBe("C9");
    expect(posted.thread_ts).toBe("10.1");
    await iface.stop();
  });

  it("parses Socket Mode envelopes without a network", () => {
    const message = parseSlackInbound({
      envelope_id: "env-1",
      type: "events_api",
      payload: {
        team_id: "T1",
        event_id: "Ev-msg",
        event: {
          type: "message",
          user: "U2",
          text: "hi",
          channel: "C2",
          ts: "1.2",
          thread_ts: "1.1",
        },
      },
    });
    expect(message).toMatchObject({
      kind: "message",
      eventId: "Ev-msg",
      teamId: "T1",
      channel: "C2",
      userId: "U2",
      threadTs: "1.1",
    });
    const action = parseSlackInbound({
      type: "interactive",
      payload: {
        type: "block_actions",
        trigger_id: "trig",
        team: { id: "T1" },
        user: { id: "U2", name: "ada" },
        channel: { id: "C2" },
        message: { ts: "1.2", thread_ts: "1.1" },
        actions: [{ action_id: "reject", value: "approval_1" }],
      },
    });
    expect(action).toMatchObject({
      kind: "block_actions",
      actionId: "reject",
      actionValue: "approval_1",
      userId: "U2",
    });
    expect(parseSlackInbound({
      type: "events_api",
      payload: { event: { type: "message", subtype: "bot_message", channel: "C", user: "B", text: "x" } },
    })).toBeUndefined();
  });

  it("posts through injected fetch and never puts the token in thrown errors", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer bot-secret-value");
      return new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const transport = createDefaultSlackTransport({
      botToken: "bot-secret-value",
      appToken: "app-secret-value",
      fetch: fetchImpl,
    });
    await expect(transport.postMessage({ channel: "C1", text: "hi" })).rejects.toThrow(
      /channel_not_found/,
    );
    await expect(transport.postMessage({ channel: "C1", text: "hi" })).rejects.not.toThrow(
      /bot-secret-value|app-secret-value/,
    );
  });
});

describe("interface:slack registry", () => {
  it("ships a valid component module", () => {
    const moduleDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../registry/components/interface/slack/1.0.0",
    );
    const validated = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    expect(validated.data).toMatchObject({
      id: "interface:slack",
      runtime: {
        kind: "interface",
        package: "@useagentsio/interface-slack",
        export: "createSlackInterface",
      },
    });
  });
});

describe("interface:slack independence", () => {
  it("does not import the telegram package", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/interface-slack/src");
    for (const file of listTs(root)) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toMatch(/interface-telegram|@useagentsio\/interface-telegram/);
    }
    const pkg = JSON.parse(
      fs.readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/interface-slack/package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@useagentsio/interface-telegram"]).toBeUndefined();
  });
});

function listTs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listTs(full));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}
