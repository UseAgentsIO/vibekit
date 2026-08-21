export interface InboundAttachment {
  readonly id: string;
  readonly name: string;
  readonly mediaType?: string;
  readonly bytes: number;
  readonly localPath: string;
}

export interface InboundSender {
  readonly id: string;
  readonly displayName?: string;
  readonly trusted: boolean;
}

export interface InboundMessage {
  readonly eventId: string;
  readonly interfaceBinding: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly conversationKey: string;
  readonly sender: InboundSender;
  readonly text: string;
  readonly attachments: readonly InboundAttachment[];
  readonly timestamp: string;
}

export type HostOutput =
  | { readonly type: "text.delta"; readonly conversationKey: string; readonly text: string }
  | { readonly type: "message.completed"; readonly conversationKey: string; readonly text: string }
  | { readonly type: "activity"; readonly conversationKey: string; readonly activity: string }
  | {
      readonly type: "approval.requested";
      readonly conversationKey: string;
      readonly approvalId: string;
      readonly question: string;
      readonly options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
    }
  | { readonly type: "error"; readonly conversationKey: string; readonly message: string; readonly code?: string }
  | { readonly type: "cancelled"; readonly conversationKey: string; readonly message: string };

export interface InterfaceLogger {
  info(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}

export interface InterfaceHealth {
  readonly ok: boolean;
  readonly connected: boolean;
  readonly detail?: string;
}

export interface InterfaceServices {
  submit(message: InboundMessage): Promise<void>;
  cancel(conversationKey: string): Promise<boolean>;
  approve(approvalId: string, decision: "approved" | "rejected", notes?: string): Promise<void>;
  resolveSecret(name: string): string;
  log: InterfaceLogger;
}

export interface RunningInterface {
  start(): Promise<void>;
  stop(): Promise<void>;
  deliver(output: HostOutput): Promise<void>;
  health(): Promise<InterfaceHealth>;
}

export interface InterfaceFactory {
  create(
    config: Record<string, unknown>,
    services: InterfaceServices,
  ): Promise<RunningInterface>;
}

export function conversationKeyOf(input: {
  interfaceBinding: string;
  accountId: string;
  conversationId: string;
  threadId?: string;
}): string {
  return [input.interfaceBinding, input.accountId, input.conversationId, input.threadId ?? ""]
    .join(":");
}

const SECRET_KEY = /key|token|secret|password|authorization/i;

function redactLogData(
  data?: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (data === undefined) {
    return undefined;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    redacted[key] = SECRET_KEY.test(key) ? "[redacted]" : value;
  }
  return redacted;
}

export const consoleInterfaceLogger: InterfaceLogger = {
  info(message, data) {
    const redacted = redactLogData(data);
    if (redacted === undefined) {
      console.info(message);
      return;
    }
    console.info(message, redacted);
  },
  warn(message, data) {
    const redacted = redactLogData(data);
    if (redacted === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, redacted);
  },
  error(message, data) {
    const redacted = redactLogData(data);
    if (redacted === undefined) {
      console.error(message);
      return;
    }
    console.error(message, redacted);
  },
};
