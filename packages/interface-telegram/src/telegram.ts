import {
  conversationKeyOf,
  type HostOutput,
  type InboundMessage,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

import { issuePairingCode, isTrustedSender } from "./pairing.js";
import {
  createDefaultTelegramTransport,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramTransport,
  type TelegramUpdate,
  type TelegramUser,
} from "./transport.js";

type ApprovalOption = {
  readonly id: string;
  readonly label: string;
};

type Destination = {
  readonly chatId: number | string;
  readonly threadId?: number;
};

const DEFAULT_BINDING = "telegram";
const ACCOUNT_ID = "telegram";

export class TelegramInterface implements RunningInterface {
  private started = false;
  private healthState: InterfaceHealth = { ok: false, connected: false, detail: "not started" };
  private readonly interfaceBinding: string;
  private readonly projectRoot: string;
  private readonly allowFrom: readonly string[];
  private readonly optionalStart: boolean;
  private readonly transport?: TelegramTransport;
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
      const error = this.startError ?? new Error("Telegram Interface transport is not configured");
      this.healthState = { ok: false, connected: false, detail: error.message };
      if (this.optionalStart) {
        this.started = true;
        return;
      }
      throw error;
    }
    try {
      await this.transport.start({
        onUpdate: async (update) => {
          try {
            await this.handleUpdate(update);
          } catch (error) {
            this.services.log.error("telegram update failed", {
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
    this.healthState = { ok: true, connected: true, detail: "telegram" };
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
            await this.send(destination, text);
          }
          break;
        }
        case "error":
        case "cancelled":
          this.deltas.delete(output.conversationKey);
          await this.send(destination, output.message);
          break;
        case "approval.requested":
          await this.send(
            destination,
            output.question,
            approvalKeyboard(output.approvalId, output.options, destination.threadId),
          );
          break;
        case "activity":
          break;
      }
    } catch (error) {
      this.services.log.error("telegram deliver failed", {
        type: output.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async health(): Promise<InterfaceHealth> {
    return this.healthState;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query !== undefined) {
      await this.handleCallback(update);
      return;
    }
    if (update.message !== undefined) {
      await this.handleMessage(update.update_id, update.message);
    }
  }

  private async handleMessage(updateId: number, message: TelegramMessage): Promise<void> {
    const from = message.from;
    const text = message.text?.trim() ?? "";
    if (from === undefined || from.is_bot === true || text.length === 0) {
      return;
    }
    const userId = String(from.id);
    const conversationKey = conversationKeyOf({
      interfaceBinding: this.interfaceBinding,
      accountId: ACCOUNT_ID,
      conversationId: String(message.chat.id),
      threadId: message.message_thread_id !== undefined ? String(message.message_thread_id) : undefined,
    });
    this.remember(conversationKey, message.chat.id, message.message_thread_id);
    const trusted = isTrustedSender(this.projectRoot, userId, this.allowFrom);
    if (!trusted) {
      await this.rejectUnpaired(userId, displayNameOf(from), message.chat.id, message.message_thread_id);
      return;
    }
    await this.services.submit(
      inboundFromMessage(updateId, message, from, this.interfaceBinding, conversationKey, true),
    );
  }

  private async handleCallback(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query;
    if (query === undefined) {
      return;
    }
    const userId = String(query.from.id);
    const message = query.message;
    const chatId = message?.chat.id;
    if (chatId !== undefined) {
      const conversationKey = conversationKeyOf({
        interfaceBinding: this.interfaceBinding,
        accountId: ACCOUNT_ID,
        conversationId: String(chatId),
        threadId: message?.message_thread_id !== undefined ? String(message.message_thread_id) : undefined,
      });
      this.remember(conversationKey, chatId, message?.message_thread_id);
    }
    const trusted = isTrustedSender(this.projectRoot, userId, this.allowFrom);
    if (!trusted) {
      if (chatId !== undefined) {
        await this.rejectUnpaired(userId, displayNameOf(query.from), chatId, message?.message_thread_id);
      }
      await this.answerCallback(query, "Not paired");
      return;
    }
    const parsed = parseCallbackData(query.data);
    if (parsed === undefined) {
      await this.answerCallback(query);
      return;
    }
    await this.services.approve(parsed.approvalId, parsed.decision);
    await this.answerCallback(query, parsed.decision === "approved" ? "Approved" : "Rejected");
  }

  private async rejectUnpaired(
    userId: string,
    displayName: string | undefined,
    chatId: number | string,
    threadId?: number,
  ): Promise<void> {
    const pending = issuePairingCode(this.projectRoot, userId, displayName);
    await this.send(
      { chatId, threadId },
      pairingMessage(pending.code),
    );
  }

  private async send(destination: Destination, text: string, extra?: unknown): Promise<void> {
    if (this.transport === undefined) {
      return;
    }
    const threadExtra =
      destination.threadId !== undefined ? { message_thread_id: destination.threadId } : undefined;
    const merged =
      extra !== undefined || threadExtra !== undefined
        ? { ...threadExtra, ...(isRecord(extra) ? extra : {}) }
        : undefined;
    await this.transport.sendMessage(destination.chatId, text, merged);
  }

  private async answerCallback(query: TelegramCallbackQuery, text?: string): Promise<void> {
    const answer = this.transport?.answerCallbackQuery;
    if (answer === undefined) {
      return;
    }
    await answer.call(this.transport, query.id, text);
  }

  private remember(conversationKey: string, chatId: number | string, threadId?: number): void {
    this.destinations.set(conversationKey, {
      chatId,
      ...(threadId !== undefined ? { threadId } : {}),
    });
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
    return {
      chatId: parsed.conversationId,
      ...(parsed.threadId !== undefined ? { threadId: Number(parsed.threadId) } : {}),
    };
  }
}

export const createTelegramInterface: InterfaceFactory["create"] = async (config, services) =>
  new TelegramInterface(config, services);

function prepareTransport(
  config: Record<string, unknown>,
  services: InterfaceServices,
): { transport?: TelegramTransport; error?: Error } {
  const injected = asTransport(config.transport);
  if (injected !== undefined) {
    return { transport: injected };
  }
  const token = resolveOptionalSecret(services, "TELEGRAM_BOT_TOKEN");
  const missing: string[] = [];
  if (token === undefined) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }
  if (typeof globalThis.fetch !== "function") {
    missing.push("fetch");
  }
  if (missing.length > 0 || token === undefined) {
    return { error: new Error(`Telegram Interface cannot start (unavailable: ${missing.join(", ")})`) };
  }
  return { transport: createDefaultTelegramTransport({ token }) };
}

function inboundFromMessage(
  updateId: number,
  message: TelegramMessage,
  from: TelegramUser,
  interfaceBinding: string,
  conversationKey: string,
  trusted: boolean,
): InboundMessage {
  const timestamp =
    typeof message.date === "number"
      ? new Date(message.date * 1000).toISOString()
      : new Date().toISOString();
  return {
    eventId: `telegram-${updateId}`,
    interfaceBinding,
    accountId: ACCOUNT_ID,
    conversationId: String(message.chat.id),
    ...(message.message_thread_id !== undefined ? { threadId: String(message.message_thread_id) } : {}),
    conversationKey,
    sender: {
      id: String(from.id),
      ...(displayNameOf(from) !== undefined ? { displayName: displayNameOf(from) } : {}),
      trusted,
    },
    text: message.text ?? "",
    attachments: [],
    timestamp,
  };
}

function approvalKeyboard(
  approvalId: string,
  options: readonly ApprovalOption[],
  threadId?: number,
): Record<string, unknown> {
  const approve = options.find((option) => option.id === "approved" || option.id === "approve");
  const reject = options.find((option) => option.id === "rejected" || option.id === "reject");
  return {
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    reply_markup: {
      inline_keyboard: [
        [
          { text: approve?.label ?? "Approve", callback_data: `approve:${approvalId}` },
          { text: reject?.label ?? "Reject", callback_data: `reject:${approvalId}` },
        ],
      ],
    },
  };
}

function parseCallbackData(
  data: string | undefined,
): { decision: "approved" | "rejected"; approvalId: string } | undefined {
  if (data === undefined || data.length === 0) {
    return undefined;
  }
  const separator = data.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const action = data.slice(0, separator).toLowerCase();
  const approvalId = data.slice(separator + 1);
  if (approvalId.length === 0) {
    return undefined;
  }
  if (action === "reject" || action === "rejected") {
    return { decision: "rejected", approvalId };
  }
  if (action === "approve" || action === "approved") {
    return { decision: "approved", approvalId };
  }
  return undefined;
}

function pairingMessage(code: string): string {
  return [
    "This VibeKit interface is not paired with your Telegram user.",
    `Pairing code: ${code}`,
    "Ask an operator to approve this code. It expires in 1 hour.",
  ].join("\n");
}

function displayNameOf(user: TelegramUser): string | undefined {
  const parts = [user.first_name, user.last_name].filter((part): part is string => typeof part === "string");
  if (parts.length > 0) {
    return parts.join(" ");
  }
  return user.username;
}

function resolveOptionalSecret(services: InterfaceServices, name: string): string | undefined {
  try {
    const value = services.resolveSecret(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function asTransport(value: unknown): TelegramTransport | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as TelegramTransport;
  if (
    typeof candidate.start === "function" &&
    typeof candidate.stop === "function" &&
    typeof candidate.sendMessage === "function"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
