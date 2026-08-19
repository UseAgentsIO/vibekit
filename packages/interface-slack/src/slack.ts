import {
  conversationKeyOf,
  type HostOutput,
  type InboundMessage,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

import {
  issuePairingCode,
  isTrustedSender,
} from "./pairing.js";
import {
  createDefaultSlackTransport,
  type SlackInbound,
  type SlackTransport,
} from "./transport.js";

type ApprovalOption = {
  readonly id: string;
  readonly label: string;
};

type Destination = {
  readonly channel: string;
  readonly threadTs?: string;
};

const DEFAULT_BINDING = "slack";

export class SlackInterface implements RunningInterface {
  private started = false;
  private healthState: InterfaceHealth = { ok: false, connected: false, detail: "not started" };
  private readonly interfaceBinding: string;
  private readonly projectRoot: string;
  private readonly allowFrom: readonly string[];
  private readonly optionalStart: boolean;
  private readonly transport?: SlackTransport;
  private readonly startError?: Error;
  private readonly deltas = new Map<string, string>();
  private readonly destinations = new Map<string, Destination>();

  constructor(
    private readonly config: Record<string, unknown>,
    private readonly services: InterfaceServices,
  ) {
    this.interfaceBinding = stringOption(config.interfaceBinding) ?? DEFAULT_BINDING;
    this.projectRoot = stringOption(config.projectRoot) ?? process.cwd();
    this.allowFrom = stringArray(config.allowFrom);
    this.optionalStart = config.optionalStart === true;
    const prepared = prepareTransport(config, services);
    this.transport = prepared.transport;
    this.startError = prepared.error;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.transport === undefined || this.startError !== undefined) {
      const error = this.startError ?? new Error("Slack Interface transport is not configured");
      this.healthState = { ok: false, connected: false, detail: error.message };
      if (this.optionalStart) {
        this.started = true;
        return;
      }
      throw error;
    }
    try {
      await this.transport.start({
        onEvent: async (event) => {
          try {
            await this.handleEvent(event);
          } catch (error) {
            this.services.log.error("slack event failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.healthState = { ok: false, connected: false, detail: failure.message };
      if (this.optionalStart) {
        this.started = true;
        return;
      }
      throw failure;
    }
    this.started = true;
    this.healthState = { ok: true, connected: true, detail: "slack" };
  }

  async stop(): Promise<void> {
    this.started = false;
    this.deltas.clear();
    await this.transport?.stop();
    this.healthState = { ok: false, connected: false, detail: "stopped" };
  }

  async deliver(output: HostOutput): Promise<void> {
    const destination = this.destinationFor(output.conversationKey);
    if (destination === undefined) {
      return;
    }
    try {
      switch (output.type) {
        case "text.delta":
          this.deltas.set(
            output.conversationKey,
            `${this.deltas.get(output.conversationKey) ?? ""}${output.text}`,
          );
          break;
        case "message.completed": {
          const accumulated = this.deltas.get(output.conversationKey) ?? "";
          this.deltas.delete(output.conversationKey);
          const text = output.text.length > 0 ? output.text : accumulated;
          if (text.length > 0) {
            await this.post({
              channel: destination.channel,
              text,
              ...(destination.threadTs !== undefined ? { thread_ts: destination.threadTs } : {}),
            });
          }
          break;
        }
        case "error":
        case "cancelled":
          this.deltas.delete(output.conversationKey);
          await this.post({
            channel: destination.channel,
            text: output.message,
            ...(destination.threadTs !== undefined ? { thread_ts: destination.threadTs } : {}),
          });
          break;
        case "approval.requested":
          await this.post(approvalPayload(destination, output.approvalId, output.question, output.options));
          break;
        case "activity":
          break;
      }
    } catch (error) {
      this.services.log.error("slack deliver failed", {
        type: output.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async health(): Promise<InterfaceHealth> {
    return this.healthState;
  }

  async handleEvent(event: SlackInbound): Promise<void> {
    const conversationKey = conversationKeyOf({
      interfaceBinding: this.interfaceBinding,
      accountId: event.teamId ?? "slack",
      conversationId: event.channel,
      threadId: event.threadTs,
    });
    this.destinations.set(conversationKey, {
      channel: event.channel,
      threadTs: event.threadTs ?? event.ts,
    });
    const trusted = isTrustedSender(this.projectRoot, event.userId, this.allowFrom);
    if (event.kind === "block_actions") {
      if (!trusted) {
        await this.rejectUnpaired(event);
        return;
      }
      const decision = decisionFromAction(event.actionId);
      await this.services.approve(event.actionValue, decision);
      return;
    }
    if (!trusted) {
      await this.rejectUnpaired(event);
      return;
    }
    await this.services.submit(inboundFromEvent(event, this.interfaceBinding, conversationKey, true));
  }

  private async rejectUnpaired(event: SlackInbound): Promise<void> {
    const pending = issuePairingCode(this.projectRoot, event.userId, event.userName);
    await this.post({
      channel: event.channel,
      text: pairingMessage(pending.code),
      ...(event.threadTs !== undefined || event.ts !== undefined
        ? { thread_ts: event.threadTs ?? event.ts }
        : {}),
    });
  }

  private async post(payload: unknown): Promise<void> {
    if (this.transport === undefined) {
      return;
    }
    await this.transport.postMessage(payload);
  }

  private destinationFor(conversationKey: string): Destination | undefined {
    const remembered = this.destinations.get(conversationKey);
    if (remembered !== undefined) {
      return remembered;
    }
    const parsed = parseConversationKey(conversationKey);
    if (parsed === undefined) {
      return undefined;
    }
    return { channel: parsed.conversationId, threadTs: parsed.threadId };
  }
}

export const createSlackInterface: InterfaceFactory["create"] = async (config, services) =>
  new SlackInterface(config, services);

function prepareTransport(
  config: Record<string, unknown>,
  services: InterfaceServices,
): { transport?: SlackTransport; error?: Error } {
  const injected = asTransport(config.transport);
  if (injected !== undefined) {
    return { transport: injected };
  }
  const botToken = resolveOptionalSecret(services, "SLACK_BOT_TOKEN");
  const appToken = resolveOptionalSecret(services, "SLACK_APP_TOKEN");
  const missing: string[] = [];
  if (botToken === undefined) {
    missing.push("SLACK_BOT_TOKEN");
  }
  if (appToken === undefined) {
    missing.push("SLACK_APP_TOKEN");
  }
  if (typeof globalThis.fetch !== "function") {
    missing.push("fetch");
  }
  if (typeof globalThis.WebSocket !== "function") {
    missing.push("WebSocket");
  }
  if (missing.length > 0 || botToken === undefined || appToken === undefined) {
    return { error: new Error(`Slack Interface cannot start (unavailable: ${missing.join(", ")})`) };
  }
  return {
    transport: createDefaultSlackTransport({
      botToken,
      appToken,
    }),
  };
}

function inboundFromEvent(
  event: Extract<SlackInbound, { kind: "message" | "app_mention" }>,
  interfaceBinding: string,
  conversationKey: string,
  trusted: boolean,
): InboundMessage {
  const timestamp = slackTimestamp(event.ts);
  return {
    eventId: event.eventId,
    interfaceBinding,
    accountId: event.teamId ?? "slack",
    conversationId: event.channel,
    ...(event.threadTs !== undefined ? { threadId: event.threadTs } : {}),
    conversationKey,
    sender: {
      id: event.userId,
      ...(event.userName !== undefined ? { displayName: event.userName } : {}),
      trusted,
    },
    text: event.text,
    attachments: [],
    timestamp,
  };
}

function approvalPayload(
  destination: Destination,
  approvalId: string,
  question: string,
  options: readonly ApprovalOption[],
): Record<string, unknown> {
  const approve = options.find((option) => option.id === "approved" || option.id === "approve");
  const reject = options.find((option) => option.id === "rejected" || option.id === "reject");
  return {
    channel: destination.channel,
    text: question,
    ...(destination.threadTs !== undefined ? { thread_ts: destination.threadTs } : {}),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: question },
      },
      {
        type: "actions",
        block_id: `approval:${approvalId}`,
        elements: [
          {
            type: "button",
            action_id: "approve",
            text: { type: "plain_text", text: approve?.label ?? "Approve" },
            value: approvalId,
            style: "primary",
          },
          {
            type: "button",
            action_id: "reject",
            text: { type: "plain_text", text: reject?.label ?? "Reject" },
            value: approvalId,
            style: "danger",
          },
        ],
      },
    ],
  };
}

function decisionFromAction(actionId: string): "approved" | "rejected" {
  const normalized = actionId.toLowerCase();
  if (normalized === "reject" || normalized === "rejected" || normalized === "n" || normalized === "no") {
    return "rejected";
  }
  return "approved";
}

function pairingMessage(code: string): string {
  return [
    "This VibeKit interface is not paired with your Slack user.",
    `Pairing code: ${code}`,
    "Ask an operator to approve this code. It expires in 1 hour.",
  ].join("\n");
}

function resolveOptionalSecret(services: InterfaceServices, name: string): string | undefined {
  try {
    const value = services.resolveSecret(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function asTransport(value: unknown): SlackTransport | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as SlackTransport;
  if (
    typeof candidate.start === "function" &&
    typeof candidate.stop === "function" &&
    typeof candidate.postMessage === "function"
  ) {
    return candidate;
  }
  return undefined;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function slackTimestamp(ts: string | undefined): string {
  if (ts === undefined) {
    return new Date().toISOString();
  }
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) {
    return new Date().toISOString();
  }
  return new Date(seconds * 1000).toISOString();
}

function parseConversationKey(
  conversationKey: string,
): { conversationId: string; threadId?: string } | undefined {
  const parts = conversationKey.split(":");
  if (parts.length < 3) {
    return undefined;
  }
  const conversationId = parts[2];
  const threadId = parts[3];
  if (conversationId === undefined || conversationId.length === 0) {
    return undefined;
  }
  return {
    conversationId,
    ...(threadId !== undefined && threadId.length > 0 ? { threadId } : {}),
  };
}
