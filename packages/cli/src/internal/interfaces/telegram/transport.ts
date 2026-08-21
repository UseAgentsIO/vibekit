export interface TelegramUser {
  readonly id: number;
  readonly is_bot?: boolean;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface TelegramChat {
  readonly id: number;
  readonly type: string;
  readonly title?: string;
}

export interface TelegramMessage {
  readonly message_id: number;
  readonly date?: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly text?: string;
  readonly message_thread_id?: number;
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly from: TelegramUser;
  readonly message?: TelegramMessage;
  readonly data?: string;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: TelegramCallbackQuery;
}

export interface TelegramEventHandlers {
  onUpdate(update: TelegramUpdate): Promise<void>;
}

export interface TelegramTransport {
  start(handlers: TelegramEventHandlers): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: number | string, text: string, extra?: unknown): Promise<void>;
  answerCallbackQuery?(callbackQueryId: string, text?: string): Promise<void>;
}

export interface TelegramTransportOptions {
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly pollTimeoutSec?: number;
}

const API_ORIGIN = "https://api.telegram.org";

export function createDefaultTelegramTransport(options: TelegramTransportOptions): TelegramTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const pollTimeoutSec = options.pollTimeoutSec ?? 25;
  let stopped = true;
  let abort: AbortController | undefined;
  let offset = 0;
  let handlers: TelegramEventHandlers | undefined;
  let loop: Promise<void> = Promise.resolve();

  const transport: TelegramTransport = {
    async start(nextHandlers) {
      if (!stopped) {
        handlers = nextHandlers;
        return;
      }
      if (typeof fetchImpl !== "function") {
        throw new Error("fetch is not available");
      }
      stopped = false;
      handlers = nextHandlers;
      abort = new AbortController();
      try {
        await telegramApi(fetchImpl, options.token, "getMe", {});
        loop = pollLoop();
      } catch (error) {
        stopped = true;
        abort.abort();
        abort = undefined;
        handlers = undefined;
        throw error;
      }
    },
    async stop() {
      stopped = true;
      abort?.abort();
      abort = undefined;
      handlers = undefined;
      await loop.catch(() => undefined);
    },
    async sendMessage(chatId, text, extra) {
      const body = {
        chat_id: chatId,
        text,
        ...(isRecord(extra) ? extra : {}),
      };
      await telegramApi(fetchImpl, options.token, "sendMessage", body);
    },
    async answerCallbackQuery(callbackQueryId, text) {
      await telegramApi(fetchImpl, options.token, "answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        ...(text !== undefined ? { text } : {}),
      });
    },
  };

  async function pollLoop(): Promise<void> {
    while (!stopped) {
      try {
        const updates = await telegramApi(fetchImpl, options.token, "getUpdates", {
          offset,
          timeout: pollTimeoutSec,
          allowed_updates: ["message", "callback_query"],
        }, abort?.signal);
        if (!Array.isArray(updates)) {
          continue;
        }
        for (const item of updates) {
          const update = asUpdate(item);
          if (update === undefined) {
            continue;
          }
          offset = update.update_id + 1;
          if (handlers !== undefined) {
            await handlers.onUpdate(update);
          }
        }
      } catch (error) {
        if (stopped || isAbortError(error)) {
          return;
        }
        await wait(1_000);
      }
    }
  }

  return transport;
}

export function asUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isRecord(value) || typeof value.update_id !== "number") {
    return undefined;
  }
  return value as unknown as TelegramUpdate;
}

async function telegramApi(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(`${API_ORIGIN}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new Error(`Telegram API ${method} returned a non-JSON body`);
  }
  if (!isRecord(data) || data.ok !== true) {
    const description =
      isRecord(data) && typeof data.description === "string" ? data.description : "request_failed";
    throw new Error(`Telegram API ${method} failed: ${description}`);
  }
  return data.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
