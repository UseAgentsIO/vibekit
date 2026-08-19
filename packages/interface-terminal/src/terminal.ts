import readline from "node:readline";

import {
  conversationKeyOf,
  type HostOutput,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

type ApprovalOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

type PendingApproval = {
  readonly approvalId: string;
  readonly question: string;
  readonly options: readonly ApprovalOption[];
};

export class TerminalInterface implements RunningInterface {
  private started = false;
  private reader?: readline.Interface;
  private pendingApproval?: PendingApproval;
  private readonly conversationKey: string;

  constructor(
    private readonly config: Record<string, unknown>,
    private readonly services: InterfaceServices,
  ) {
    this.conversationKey = conversationKeyOf({
      interfaceBinding: String(config.interfaceBinding ?? "terminal-main"),
      accountId: "local",
      conversationId: "terminal",
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    if (this.config.interactive === false) {
      return;
    }
    this.reader = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    this.reader.on("line", (line) => {
      void this.handleLine(line);
    });
    this.reader.on("close", () => {
      this.started = false;
    });
    process.stdout.write("VibeKit terminal. Type a message, or exit.\n> ");
  }

  async stop(): Promise<void> {
    this.started = false;
    this.pendingApproval = undefined;
    this.reader?.close();
    this.reader = undefined;
  }

  async deliver(output: HostOutput): Promise<void> {
    if (output.conversationKey !== this.conversationKey && this.config.strictKey === true) {
      return;
    }
    switch (output.type) {
      case "text.delta":
        process.stdout.write(output.text);
        break;
      case "message.completed":
        process.stdout.write(output.text.endsWith("\n") ? "" : "\n");
        if (this.started && this.reader !== undefined) {
          process.stdout.write("> ");
        }
        break;
      case "activity":
        process.stderr.write(`[${output.activity}]\n`);
        break;
      case "error":
        process.stderr.write(`${output.message}\n`);
        break;
      case "cancelled":
        process.stdout.write(`${output.message}\n`);
        break;
      case "approval.requested":
        this.pendingApproval = {
          approvalId: output.approvalId,
          question: output.question,
          options: output.options,
        };
        process.stdout.write(formatApprovalPrompt(output.question, output.options));
        if (this.started) {
          process.stdout.write("> ");
        }
        break;
    }
  }

  async health(): Promise<InterfaceHealth> {
    return {
      ok: this.started,
      connected: this.started,
      detail: "terminal",
    };
  }

  async handleLine(line: string): Promise<void> {
    const text = line.trim();
    if (text.length === 0) {
      process.stdout.write("> ");
      return;
    }
    if (this.pendingApproval !== undefined) {
      await this.respondToApproval(text);
      return;
    }
    if (text === "exit" || text === "/exit") {
      await this.services.cancel(this.conversationKey);
      await this.stop();
      return;
    }
    const now = new Date().toISOString();
    await this.services.submit({
      eventId: `terminal-${now}-${text.slice(0, 24)}`,
      interfaceBinding: String(this.config.interfaceBinding ?? "terminal-main"),
      accountId: "local",
      conversationId: "terminal",
      conversationKey: this.conversationKey,
      sender: { id: "local", displayName: "operator", trusted: true },
      text,
      attachments: [],
      timestamp: now,
    });
  }

  private async respondToApproval(text: string): Promise<void> {
    const pending = this.pendingApproval;
    if (pending === undefined) {
      return;
    }
    const { decision, notes } = interpretApprovalLine(text, pending.options);
    await this.services.approve(pending.approvalId, decision, notes);
    this.pendingApproval = undefined;
    if (this.started) {
      process.stdout.write("> ");
    }
  }
}

function formatApprovalPrompt(question: string, options: readonly ApprovalOption[]): string {
  const lines = [`${question}`, "y / n"];
  for (const option of options) {
    lines.push(`  ${option.id}: ${option.label}`);
  }
  return `${lines.join("\n")}\n`;
}

function interpretApprovalLine(
  text: string,
  options: readonly ApprovalOption[],
): { decision: "approved" | "rejected"; notes?: string } {
  const lower = text.toLowerCase();
  if (lower === "y" || lower === "yes" || lower === "approve") {
    return { decision: "approved" };
  }
  if (lower === "n" || lower === "no" || lower === "reject") {
    return { decision: "rejected" };
  }
  const option = options.find(
    (item) => item.id.toLowerCase() === lower || item.label.toLowerCase() === lower,
  );
  if (option !== undefined) {
    const id = option.id.toLowerCase();
    if (id === "approved" || id === "rejected") {
      return { decision: id };
    }
    const label = option.label.toLowerCase();
    if (label === "approved" || label === "rejected") {
      return { decision: label };
    }
  }
  return { decision: "rejected", notes: text };
}

export const createTerminalInterface: InterfaceFactory["create"] = async (
  config,
  services,
) => new TerminalInterface(config, services);
