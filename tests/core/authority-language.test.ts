import { describe, expect, it } from "vitest";

import {
  createDefaultProject,
  evaluateApprovalGate,
  type TaskDocument,
} from "@useagentsio/core";

const task: TaskDocument = {
  schemaVersion: 1,
  id: "task_550e8400-e29b-41d4-a716-446655440000",
  projectId: "project:language",
  objective: "change a file",
  context: { references: [] },
  constraints: [],
  acceptanceCriteria: [],
  requiredCapabilities: [],
  assignedAgent: "agent:assistant",
  claimedBy: null,
  scope: { paths: ["workspace/**"], resources: [] },
  dependencies: [],
  priority: "normal",
  delivery: { mode: "apply" },
  authorization: { state: "explicit" },
  status: "open",
  revision: 1,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

describe("authority user language", () => {
  it("explains the exact target, consequence, and approval needed", () => {
    const project = createDefaultProject({ slug: "language", name: "Language" });
    const decision = evaluateApprovalGate({
      task,
      project: { authorization: { default: "standing", actions: { "source.write": "explicit" } } },
      action: "tool:filesystem / source.write",
      target: "workspace/notes.txt",
      scope: { path: "workspace/notes.txt", capability: "source.write" },
      approvals: [],
    });
    expect(decision.status).toBe("approval_required");
    expect(decision.reason).toContain("workspace/notes.txt");
    expect(decision.reason).toContain("files in the requested scope will be changed");
    expect(decision.reason).toContain("pending Approval request");
    expect(project.authorization.default).toBe("deny");
  });
});
