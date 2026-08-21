import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { conversationKeyOf, type InboundMessage, type InterfaceServices } from "@useagentsio/interface-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  approvePairing,
  createDefaultTelegramTransport,
  createTelegramInterface,
  issuePairingCode,
  listPairings,
  pairingStorePath,
  revokePairing,
  TelegramInterface,
  type TelegramTransport,
  type TelegramUpdate,
} from "../../packages/cli/src/internal/interfaces/telegram/index.js";

interface ApprovalCall {
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly notes?: string;
}

class FakeTelegramTransport implements TelegramTransport {
  handler?: (update: TelegramUpdate) => Promise<void>;
  readonly sent: Array<{ chatId: number | string; text: string; extra?: unknown }> = [];
  readonly answered: Array<{ id: string; text?: string }> = [];
  started = false;

  async start(handlers: { onUpdate(update: TelegramUpdate): Promise<void> }): Promise<void> {
    this.handler = handlers.onUpdate;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.handler = undefined;
  }

  async sendMessage(chatId: number | string, text: string, extra?: unknown): Promise<void> {
    this.sent.push({ chatId, text, extra });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    this.answered.push({ id: callbackQueryId, text });
  }

  async emit(update: TelegramUpdate): Promise<void> {
    if (this.handler === undefined) {
      throw new Error("transport is not started");
    }
    await this.handler(update);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-telegram-"));
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

async function startTelegram(options: {
  projectRoot: string;
  transport: FakeTelegramTransport;
  allowFrom?: string[];
}): Promise<{
  iface: TelegramInterface;
  submissions: InboundMessage[];
  approvals: ApprovalCall[];
}> {
  const recorded = recordingServices();
  const iface = await createTelegramInterface(
    {
      interfaceBinding: "telegram-main",
      projectRoot: options.projectRoot,
      transport: options.transport,
      allowFrom: options.allowFrom ?? [],
      pairingRequired: true,
    },
    recorded.services,
  );
  expect(iface).toBeInstanceOf(TelegramInterface);
  await iface.start();
  return {
    iface: iface as TelegramInterface,
    submissions: recorded.submissions,
    approvals: recorded.approvals,
  };
}

function textUpdate(
  updateId: number,
  userId: number,
  chatId: number,
  text: string,
  threadId?: number,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_710_000_000,
      from: { id: userId, first_name: "Ada" },
      chat: { id: chatId, type: "private" },
      text,
      ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    },
  };
}

describe("interface:telegram pairing", () => {
  it("does not submit for an unpaired user and issues a pairing code", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, submissions } = await startTelegram({ projectRoot, transport });

    await transport.emit(textUpdate(1, 42, 42, "hello"));

    expect(submissions).toEqual([]);
    const listed = listPairings(projectRoot);
    expect(listed.paired).toEqual([]);
    expect(listed.pending).toHaveLength(1);
    expect(listed.pending[0]?.userId).toBe("42");
    expect(listed.pending[0]?.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(transport.sent[0]?.text).toContain(listed.pending[0]?.code);
    expect(fs.existsSync(pairingStorePath(projectRoot))).toBe(true);
    await iface.stop();
  });

  it("submits after approvePairing", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, submissions } = await startTelegram({ projectRoot, transport });

    await transport.emit(textUpdate(1, 42, 42, "hello"));
    approvePairing(projectRoot, listPairings(projectRoot).pending[0]?.code ?? "");
    await transport.emit(textUpdate(2, 42, 42, "now paired"));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.text).toBe("now paired");
    expect(submissions[0]?.sender).toEqual({
      id: "42",
      displayName: "Ada",
      trusted: true,
    });
    expect(submissions[0]?.conversationKey).toBe(
      conversationKeyOf({
        interfaceBinding: "telegram-main",
        accountId: "telegram",
        conversationId: "42",
      }),
    );
    expect(listPairings(projectRoot).owner).toMatchObject({
      userId: "42",
      displayName: "Ada",
    });
    await iface.stop();
  });

  it("lets allowFrom bypass pairing", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, submissions } = await startTelegram({
      projectRoot,
      transport,
      allowFrom: ["99"],
    });

    await transport.emit(textUpdate(3, 99, 99, "allowlisted"));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.sender.trusted).toBe(true);
    expect(listPairings(projectRoot).pending).toEqual([]);
    await iface.stop();
  });

  it("revokes a paired sender so later messages are blocked", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, submissions } = await startTelegram({ projectRoot, transport });
    await transport.emit(textUpdate(1, 7, 7, "hi"));
    approvePairing(projectRoot, listPairings(projectRoot).pending[0]?.code ?? "");
    expect(revokePairing(projectRoot, "7")).toBe(true);
    await transport.emit(textUpdate(2, 7, 7, "again"));
    expect(submissions).toEqual([]);
    await iface.stop();
  });

  it("hides expired pending codes and refuses to approve them", () => {
    const projectRoot = tempProject();
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const pending = issuePairingCode(projectRoot, "8", "Expired", issuedAt);
    const expiredAt = new Date("2026-01-01T01:00:00.001Z");
    expect(listPairings(projectRoot, expiredAt).pending).toEqual([]);
    expect(() => approvePairing(projectRoot, pending.code, expiredAt)).toThrow(/expired/);
  });
});

describe("interface:telegram approvals", () => {
  it("posts inline keyboard and forwards callback_query to services.approve", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, approvals, submissions } = await startTelegram({
      projectRoot,
      transport,
      allowFrom: ["42"],
    });
    await transport.emit(textUpdate(10, 42, 99, "apply this", 8));
    const conversationKey = submissions[0]?.conversationKey;
    expect(conversationKey).toBe(
      conversationKeyOf({
        interfaceBinding: "telegram-main",
        accountId: "telegram",
        conversationId: "99",
        threadId: "8",
      }),
    );

    await iface.deliver({
      type: "approval.requested",
      conversationKey: conversationKey ?? "",
      approvalId: "approval_550e8400-e29b-41d4-a716-446655440020",
      question: "Ship it?",
      options: [
        { id: "approved", label: "Yes" },
        { id: "rejected", label: "No" },
      ],
    });

    const extra = transport.sent.at(-1)?.extra as {
      reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string; text?: string }>> };
    };
    expect(extra.reply_markup?.inline_keyboard?.[0]?.map((button) => button.callback_data)).toEqual([
      "approve:approval_550e8400-e29b-41d4-a716-446655440020",
      "reject:approval_550e8400-e29b-41d4-a716-446655440020",
    ]);

    await transport.emit({
      update_id: 11,
      callback_query: {
        id: "cb-1",
        from: { id: 42, first_name: "Ada" },
        message: {
          message_id: 10,
          chat: { id: 99, type: "supergroup" },
          message_thread_id: 8,
        },
        data: "approve:approval_550e8400-e29b-41d4-a716-446655440020",
      },
    });

    expect(approvals).toEqual([
      { approvalId: "approval_550e8400-e29b-41d4-a716-446655440020", decision: "approved" },
    ]);
    expect(transport.answered).toEqual([{ id: "cb-1", text: "Approved" }]);
    expect(submissions).toHaveLength(1);
    await iface.stop();
  });

  it("does not approve callback_query from an unpaired user", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, approvals } = await startTelegram({ projectRoot, transport });
    await transport.emit({
      update_id: 20,
      callback_query: {
        id: "cb-unpaired",
        from: { id: 5, first_name: "Eve" },
        message: { message_id: 1, chat: { id: 5, type: "private" } },
        data: "approve:approval_550e8400-e29b-41d4-a716-446655440021",
      },
    });
    expect(approvals).toEqual([]);
    expect(listPairings(projectRoot).pending[0]?.userId).toBe("5");
    await iface.stop();
  });
});

describe("interface:telegram start and delivery", () => {
  it("fails closed without a token unless optionalStart is set", async () => {
    const services: InterfaceServices = {
      submit: async () => undefined,
      cancel: async () => true,
      approve: async () => undefined,
      resolveSecret: () => {
        throw new Error("missing");
      },
      log: { info() {}, warn() {}, error() {} },
    };
    const required = await createTelegramInterface({ projectRoot: tempProject() }, services);
    await expect(required.start()).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
    const optional = await createTelegramInterface(
      { projectRoot: tempProject(), optionalStart: true },
      services,
    );
    await optional.start();
    const health = await optional.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/TELEGRAM_BOT_TOKEN/);
    await optional.stop();
  });

  it("accumulates deltas and posts the completed message", async () => {
    const projectRoot = tempProject();
    const transport = new FakeTelegramTransport();
    const { iface, submissions } = await startTelegram({
      projectRoot,
      transport,
      allowFrom: ["1"],
    });
    await transport.emit(textUpdate(1, 1, 1, "hi"));
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
    expect(transport.sent.at(-1)?.text).toBe("Hello");
    await iface.stop();
  });

  it("calls Telegram HTTP APIs through injected fetch without leaking the token", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const transport = createDefaultTelegramTransport({
      token: "telegram-secret-value",
      fetch: fetchImpl,
    });
    await expect(transport.sendMessage(1, "hi")).rejects.toThrow(/chat not found/);
    await expect(transport.sendMessage(1, "hi")).rejects.not.toThrow(/telegram-secret-value/);
    expect(seen[0]).toContain("/sendMessage");
  });
});

describe("interface:telegram registry", () => {
  it("ships a valid component module", () => {
    const moduleDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../registry/components/interface/telegram/1.0.0",
    );
    const validated = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    expect(validated.data).toMatchObject({
      id: "interface:telegram",
      runtime: {
        kind: "interface",
        package: "@useagentsio/interface-telegram",
        export: "createTelegramInterface",
      },
    });
  });
});

describe("interface:telegram independence", () => {
  it("does not import the slack package", () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../packages/cli/src/internal/interfaces/telegram",
    );
    for (const file of listTs(root)) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toMatch(/interface-slack|@useagentsio\/interface-slack/);
    }
    expect(fs.existsSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../packages/interface-telegram/package.json",
    ))).toBe(false);
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
