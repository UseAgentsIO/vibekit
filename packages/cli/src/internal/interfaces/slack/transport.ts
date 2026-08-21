export interface SlackMessageInbound {
  readonly kind: "message" | "app_mention";
  readonly eventId: string;
  readonly teamId?: string;
  readonly channel: string;
  readonly userId: string;
  readonly userName?: string;
  readonly text: string;
  readonly ts?: string;
  readonly threadTs?: string;
  readonly channelType?: string;
}

export interface SlackActionInbound {
  readonly kind: "block_actions";
  readonly eventId: string;
  readonly teamId?: string;
  readonly channel: string;
  readonly userId: string;
  readonly userName?: string;
  readonly ts?: string;
  readonly threadTs?: string;
  readonly actionId: string;
  readonly actionValue: string;
}

export type SlackInbound = SlackMessageInbound | SlackActionInbound;

export interface SlackEventHandlers {
  onEvent(event: SlackInbound): Promise<void>;
}

export interface SlackTransport {
  start(handlers: SlackEventHandlers): Promise<void>;
  stop(): Promise<void>;
  postMessage(payload: unknown): Promise<void>;
  updateMessage?(payload: unknown): Promise<void>;
}

export interface SlackSocketLike {
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export type SlackWebSocketCtor = new (url: string) => SlackSocketLike;

export interface SlackTransportOptions {
  readonly botToken: string;
  readonly appToken: string;
  readonly fetch?: typeof fetch;
  readonly webSocket?: SlackWebSocketCtor;
}

const IGNORED_SUBTYPES = new Set([
  "bot_message",
  "message_changed",
  "message_deleted",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
]);

export function parseSlackInbound(envelope: unknown): SlackInbound | undefined {
  if (!isRecord(envelope)) {
    return undefined;
  }
  if (isNormalizedInbound(envelope)) {
    return envelope;
  }
  const type = typeof envelope.type === "string" ? envelope.type : undefined;
  const payload = isRecord(envelope.payload) ? envelope.payload : envelope;
  if (type === "events_api" || isRecord(payload.event)) {
    return parseEventApi(payload);
  }
  if (type === "interactive" || payload.type === "block_actions") {
    return parseBlockActions(payload);
  }
  return undefined;
}

export function createDefaultSlackTransport(options: SlackTransportOptions): SlackTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const WebSocketImpl = options.webSocket ?? globalThis.WebSocket;
  let stopped = true;
  let socket: SlackSocketLike | undefined;
  let handlers: SlackEventHandlers | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = 1_000;
  let loop: Promise<void> = Promise.resolve();

  const transport: SlackTransport = {
    async start(nextHandlers) {
      if (!stopped) {
        handlers = nextHandlers;
        return;
      }
      if (typeof fetchImpl !== "function") {
        throw new Error("fetch is not available");
      }
      if (typeof WebSocketImpl !== "function") {
        throw new Error("WebSocket is not available");
      }
      stopped = false;
      handlers = nextHandlers;
      try {
        const url = await openConnection(fetchImpl, options.appToken);
        loop = runSocketLoop(url);
      } catch (error) {
        stopped = true;
        handlers = undefined;
        throw error;
      }
    },
    async stop() {
      stopped = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      socket?.close();
      socket = undefined;
      handlers = undefined;
      await loop.catch(() => undefined);
    },
    async postMessage(payload) {
      await slackApi(fetchImpl, options.botToken, "chat.postMessage", payload);
    },
    async updateMessage(payload) {
      await slackApi(fetchImpl, options.botToken, "chat.update", payload);
    },
  };

  async function runSocketLoop(firstUrl: string): Promise<void> {
    let nextUrl: string | undefined = firstUrl;
    while (!stopped) {
      try {
        const url = nextUrl ?? (await openConnection(fetchImpl, options.appToken));
        nextUrl = undefined;
        backoffMs = 1_000;
        await listen(url);
      } catch {
        nextUrl = undefined;
        if (stopped) {
          return;
        }
        await wait(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  function listen(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new (WebSocketImpl as SlackWebSocketCtor)(url);
      socket = ws;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (socket === ws) {
          socket = undefined;
        }
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      };
      ws.addEventListener("open", () => undefined);
      ws.addEventListener("error", () => {
        finish(new Error("Slack Socket Mode connection failed"));
      });
      ws.addEventListener("close", () => {
        finish();
      });
      ws.addEventListener("message", (event) => {
        void handleSocketData(ws, event.data).catch(() => undefined);
      });
    });
  }

  async function handleSocketData(ws: SlackSocketLike, data: unknown): Promise<void> {
    const text = socketDataToString(data);
    if (text === undefined) {
      return;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (isRecord(envelope) && typeof envelope.envelope_id === "string") {
      ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }
    if (isRecord(envelope) && envelope.type === "disconnect") {
      ws.close();
      return;
    }
    const inbound = parseSlackInbound(envelope);
    if (inbound !== undefined && handlers !== undefined) {
      await handlers.onEvent(inbound);
    }
  }

  return transport;
}

async function openConnection(fetchImpl: typeof fetch, appToken: string): Promise<string> {
  const data = (await slackApi(fetchImpl, appToken, "apps.connections.open", {})) as {
    url?: string;
  };
  if (typeof data.url !== "string" || data.url.length === 0) {
    throw new Error("Slack Socket Mode did not return a websocket URL");
  }
  return data.url;
}

async function slackApi(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetchImpl(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new Error(`Slack API ${method} returned a non-JSON body`);
  }
  if (!isRecord(data) || data.ok !== true) {
    const error = isRecord(data) && typeof data.error === "string" ? data.error : "request_failed";
    throw new Error(`Slack API ${method} failed: ${error}`);
  }
  return data;
}

function parseEventApi(payload: Record<string, unknown>): SlackInbound | undefined {
  const event = isRecord(payload.event) ? payload.event : undefined;
  if (event === undefined) {
    return undefined;
  }
  const eventType = event.type === "app_mention" ? "app_mention" : event.type === "message" ? "message" : undefined;
  if (eventType === undefined) {
    return undefined;
  }
  if (typeof event.bot_id === "string" && event.bot_id.length > 0) {
    return undefined;
  }
  if (typeof event.subtype === "string" && IGNORED_SUBTYPES.has(event.subtype)) {
    return undefined;
  }
  const channel = asString(event.channel);
  const userId = asString(event.user);
  const text = typeof event.text === "string" ? event.text : "";
  if (channel === undefined || userId === undefined || text.trim().length === 0) {
    return undefined;
  }
  const teamId = asString(payload.team_id) ?? asString(event.team);
  const ts = asString(event.ts);
  const threadTs = asString(event.thread_ts);
  const eventId =
    asString(payload.event_id) ??
    [channel, ts, userId].filter((part) => part !== undefined).join("-");
  return {
    kind: eventType,
    eventId,
    ...(teamId !== undefined ? { teamId } : {}),
    channel,
    userId,
    ...(asString(event.username) !== undefined ? { userName: asString(event.username) } : {}),
    text,
    ...(ts !== undefined ? { ts } : {}),
    ...(threadTs !== undefined ? { threadTs } : {}),
    ...(asString(event.channel_type) !== undefined ? { channelType: asString(event.channel_type) } : {}),
  };
}

function parseBlockActions(payload: Record<string, unknown>): SlackInbound | undefined {
  if (payload.type !== "block_actions") {
    return undefined;
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = actions.find((item) => isRecord(item)) as Record<string, unknown> | undefined;
  if (action === undefined) {
    return undefined;
  }
  const actionId = asString(action.action_id);
  const actionValue = asString(action.value);
  if (actionId === undefined || actionValue === undefined) {
    return undefined;
  }
  const user = isRecord(payload.user) ? payload.user : undefined;
  const channelValue = payload.channel;
  const channel = typeof channelValue === "string" ? channelValue : isRecord(channelValue) ? asString(channelValue.id) : undefined;
  const userId = user !== undefined ? asString(user.id) : undefined;
  if (channel === undefined || userId === undefined) {
    return undefined;
  }
  const message = isRecord(payload.message) ? payload.message : undefined;
  const team = isRecord(payload.team) ? payload.team : undefined;
  const ts = message !== undefined ? asString(message.ts) : undefined;
  const threadTs = message !== undefined ? asString(message.thread_ts) : undefined;
  const teamId = team !== undefined ? asString(team.id) : asString(payload.team_id);
  const userName = user !== undefined ? asString(user.name) ?? asString(user.username) : undefined;
  const eventId = asString(payload.trigger_id) ?? `${channel}-${actionId}-${actionValue}`;
  return {
    kind: "block_actions",
    eventId,
    ...(teamId !== undefined ? { teamId } : {}),
    channel,
    userId,
    ...(userName !== undefined ? { userName } : {}),
    ...(ts !== undefined ? { ts } : {}),
    ...(threadTs !== undefined ? { threadTs } : {}),
    actionId,
    actionValue,
  };
}

function isNormalizedInbound(value: Record<string, unknown>): value is SlackInbound & Record<string, unknown> {
  return (
    (value.kind === "message" || value.kind === "app_mention" || value.kind === "block_actions") &&
    typeof value.eventId === "string" &&
    typeof value.channel === "string" &&
    typeof value.userId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function socketDataToString(data: unknown): string | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
