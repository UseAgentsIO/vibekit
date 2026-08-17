import { validateDocument } from "@vibekit/core";
import { collectResult, extractResultPayload } from "@vibekit/pi";
import { describe, expect, it } from "vitest";

describe("Result collection", () => {
  it("extracts a fenced JSON Result payload", () => {
    const extracted = extractResultPayload(`
Here is the outcome.
\`\`\`json
{
  "summary": "Added helper",
  "artifacts": [{ "path": "src/helper.ts", "revision": "abc1234" }],
  "unresolvedIssues": []
}
\`\`\`
`);
    expect(extracted.summary).toBe("Added helper");
    expect(extracted.artifacts?.[0]?.path).toBe("src/helper.ts");
  });

  it("returns a document matching the Result contract", () => {
    const result = collectResult({
      taskId: "task_550e8400-e29b-41d4-a716-446655440001",
      runId: "run_550e8400-e29b-41d4-a716-446655440002",
      agentId: "agent:coder",
      assistantText: '{"summary":"Done","artifacts":[],"evidence":[]}',
      status: "completed",
      fallbackSummary: "fallback",
    });
    const validated = validateDocument("result", result);
    expect(validated.errors, JSON.stringify(validated.errors)).toEqual([]);
    expect(validated.valid).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Done");
    expect(result.verificationIds).toEqual([]);
    expect(result.id.startsWith("result_")).toBe(true);
  });

  it("does not persist and still produces required fields on fallback", () => {
    const result = collectResult({
      taskId: "task_550e8400-e29b-41d4-a716-446655440001",
      runId: "run_550e8400-e29b-41d4-a716-446655440002",
      agentId: "agent:coder",
      assistantText: "no structured payload",
      status: "failed",
      fallbackSummary: "Run failed",
      unresolvedIssues: ["run-failed"],
    });
    expect(result.status).toBe("failed");
    expect(result.summary).toBe("Run failed");
    expect(result.unresolvedIssues).toContain("run-failed");
    expect(result.artifacts).toEqual([]);
  });
});
