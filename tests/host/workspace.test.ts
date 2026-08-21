import { describe, expect, it } from "vitest";

import { createDefaultProject, type ConversationDocument } from "@useagentsio/core";
import { createInboundTask } from "../../packages/cli/src/internal/host/turn-runner.js";

describe("Host workspace task scope", () => {
  it("gives ordinary turns a broad task scope for the selected workspace", () => {
    const project = createDefaultProject({ slug: "workspace-host", name: "Workspace Host" });
    const task = createInboundTask({
      project,
      conversation: {
        schemaVersion: 1,
        id: "conversation_550e8400-e29b-41d4-a716-446655440000",
        projectId: project.id,
        interfaceBinding: "terminal-main",
        accountId: "local",
        external: { conversationId: "cli" },
        conversationKey: "terminal:local:cli",
        agentBinding: "assistant",
        sessionPath: ".vibekit/runtime/sessions/assistant.jsonl",
        status: "active",
        lastEventId: undefined,
        revision: 1,
        createdAt: "2026-08-21T00:00:00.000Z",
        lastUsedAt: "2026-08-21T00:00:00.000Z",
      } as ConversationDocument,
      message: {
        eventId: "event_550e8400-e29b-41d4-a716-446655440000",
        interfaceBinding: "terminal-main",
        accountId: "local",
        conversationId: "cli",
        conversationKey: "terminal:local:cli",
        sender: { id: "local", trusted: true },
        text: "read the note",
        attachments: [],
        timestamp: "2026-08-21T00:00:00.000Z",
      },
      agentId: "agent:assistant",
      now: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(task.scope).toEqual({ paths: ["**"], resources: ["**"] });
  });
});
