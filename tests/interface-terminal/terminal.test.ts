import { conversationKeyOf, type InterfaceServices } from "@useagentsio/interface-sdk";
import { createTerminalInterface, TerminalInterface } from "@useagentsio/interface-terminal";
import { describe, expect, it } from "vitest";

interface ApprovalCall {
  readonly approvalId: string;
  readonly decision: "approved" | "rejected";
  readonly notes?: string;
}

function recordingServices(): {
  services: InterfaceServices;
  approvals: ApprovalCall[];
  submissions: string[];
} {
  const approvals: ApprovalCall[] = [];
  const submissions: string[] = [];
  return {
    approvals,
    submissions,
    services: {
      submit: async (message) => {
        submissions.push(message.text);
      },
      cancel: async () => true,
      approve: async (approvalId, decision, notes) => {
        approvals.push({ approvalId, decision, notes });
      },
      resolveSecret: (name) => name,
      log: {
        info() {},
        warn() {},
        error() {},
      },
    },
  };
}

const conversationKey = conversationKeyOf({
  interfaceBinding: "terminal-main",
  accountId: "local",
  conversationId: "terminal",
});

async function createTerminal(services: InterfaceServices): Promise<TerminalInterface> {
  const terminal = await createTerminalInterface(
    { interactive: false, interfaceBinding: "terminal-main" },
    services,
  );
  expect(terminal).toBeInstanceOf(TerminalInterface);
  await terminal.start();
  return terminal as TerminalInterface;
}

describe("TerminalInterface approvals", () => {
  it("forwards y as approved and does not submit the line", async () => {
    const { services, approvals, submissions } = recordingServices();
    const terminal = await createTerminal(services);

    await terminal.deliver({
      type: "approval.requested",
      conversationKey,
      approvalId: "approval_550e8400-e29b-41d4-a716-446655440001",
      question: "Apply this change?",
      options: [
        { id: "approved", label: "Yes" },
        { id: "rejected", label: "No" },
      ],
    });
    await terminal.handleLine("y");

    expect(approvals).toEqual([
      { approvalId: "approval_550e8400-e29b-41d4-a716-446655440001", decision: "approved" },
    ]);
    expect(submissions).toEqual([]);
    await terminal.stop();
  });

  it("forwards n as rejected", async () => {
    const { services, approvals, submissions } = recordingServices();
    const terminal = await createTerminal(services);

    await terminal.deliver({
      type: "approval.requested",
      conversationKey,
      approvalId: "approval_550e8400-e29b-41d4-a716-446655440002",
      question: "Delete the file?",
      options: [],
    });
    await terminal.handleLine("n");

    expect(approvals).toEqual([
      { approvalId: "approval_550e8400-e29b-41d4-a716-446655440002", decision: "rejected" },
    ]);
    expect(submissions).toEqual([]);
    await terminal.stop();
  });

  it("submits a normal line when no approval is pending", async () => {
    const { services, approvals, submissions } = recordingServices();
    const terminal = await createTerminal(services);

    await terminal.handleLine("hello");

    expect(submissions).toEqual(["hello"]);
    expect(approvals).toEqual([]);
    await terminal.stop();
  });
});
