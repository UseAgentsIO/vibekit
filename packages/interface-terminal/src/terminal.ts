import readline from "node:readline";

import {
  conversationKeyOf,
  type HostOutput,
  type InterfaceFactory,
  type InterfaceHealth,
  type InterfaceServices,
  type RunningInterface,
} from "@useagentsio/interface-sdk";

class TerminalInterface implements RunningInterface {
  private started = false;
  private reader?: readline.Interface;
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
      void this.onLine(line);
    });
    this.reader.on("close", () => {
      this.started = false;
    });
    process.stdout.write("VibeKit terminal. Type a message, or exit.\n> ");
  }

  async stop(): Promise<void> {
    this.started = false;
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
        process.stdout.write(`${output.question}\n`);
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

  private async onLine(line: string): Promise<void> {
    const text = line.trim();
    if (text.length === 0) {
      process.stdout.write("> ");
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
}

export const createTerminalInterface: InterfaceFactory["create"] = async (
  config,
  services,
) => new TerminalInterface(config, services);
