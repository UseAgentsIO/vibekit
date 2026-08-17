import { validateDocument } from "@vibekit/core";
import { createRunEvent, mapPiSessionEvent, redactEventData } from "@vibekit/pi";
import { describe, expect, it } from "vitest";

describe("Run Events", () => {
  it("constructs a valid run.started Event", () => {
    const event = createRunEvent({
      type: "run.started",
      projectId: "project:example-app",
      taskId: "task_550e8400-e29b-41d4-a716-446655440001",
      runId: "run_550e8400-e29b-41d4-a716-446655440002",
      actor: "agent:coder",
      data: { tools: ["read"] },
    });
    const validated = validateDocument("event", event);
    expect(validated.errors, JSON.stringify(validated.errors)).toEqual([]);
    expect(validated.valid).toBe(true);
    expect(event.type).toBe("run.started");
    expect(event.id.startsWith("event_")).toBe(true);
  });

  it("maps Pi tool events to run.progress", () => {
    const mapped = mapPiSessionEvent(
      { type: "tool_execution_start", toolName: "read" },
      {
        projectId: "project:example-app",
        taskId: "task_550e8400-e29b-41d4-a716-446655440001",
        runId: "run_550e8400-e29b-41d4-a716-446655440002",
        actor: "agent:coder",
      },
    );
    expect(mapped?.type).toBe("run.progress");
    expect(mapped?.data.toolName).toBe("read");
    expect(mapped?.data.piType).toBe("tool_execution_start");
  });

  it("redacts secret-like values in Event data", () => {
    const data = redactEventData({
      note: "token=sk-abcdefghijklmnopqrstuvwxyz",
      nested: { authorization: "Bearer abc.def" },
    });
    expect(String(data.note)).toContain("[redacted]");
    expect(String((data.nested as { authorization: string }).authorization)).toContain(
      "[redacted]",
    );
  });
});
