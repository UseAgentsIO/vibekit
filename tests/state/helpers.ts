import fs from "node:fs";

import { formatRuntimeId } from "@useagentsio/core";
import type {
  ApprovalDocument,
  DecisionDocument,
  EventDocument,
  ResultDocument,
  TaskDocument,
  VerificationDocument,
} from "@useagentsio/core";
import { afterEach } from "vitest";

import { makeTempDir } from "../helpers.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

export function tempProject(): string {
  const dir = makeTempDir("vibekit-state-");
  temps.push(dir);
  return dir;
}

const UUIDS = [
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
  "550e8400-e29b-41d4-a716-446655440003",
  "550e8400-e29b-41d4-a716-446655440004",
  "550e8400-e29b-41d4-a716-446655440005",
  "550e8400-e29b-41d4-a716-446655440006",
  "550e8400-e29b-41d4-a716-446655440007",
  "550e8400-e29b-41d4-a716-446655440008",
  "550e8400-e29b-41d4-a716-446655440009",
  "550e8400-e29b-41d4-a716-44665544000a",
] as const;

export function taskDoc(overrides: Partial<TaskDocument> = {}): TaskDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("task", UUIDS[0]),
    projectId: "project:example-app",
    objective: "Bounded required outcome",
    context: { references: [] },
    constraints: [],
    acceptanceCriteria: [],
    requiredCapabilities: [],
    assignedAgent: null,
    claimedBy: null,
    scope: { paths: [], resources: [] },
    dependencies: [],
    priority: "normal",
    delivery: { mode: "proposal" },
    authorization: { state: "standing" },
    status: "open",
    revision: 1,
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
  };
}

export function resultDoc(overrides: Partial<ResultDocument> = {}): ResultDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("result", UUIDS[2]),
    taskId: formatRuntimeId("task", UUIDS[0]),
    runId: formatRuntimeId("run", UUIDS[1]),
    agentId: "agent:coder",
    status: "completed",
    summary: "Description of the produced outcome",
    artifacts: [
      {
        path: "src/example.ts",
        revision: "a1b2c3d4e5f6789012345678901234567890abcd",
      },
    ],
    evidence: [],
    verificationIds: [],
    unresolvedIssues: [],
    discoveredConstraints: [],
    recommendedNextActions: [],
    createdAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
  };
}

export function decisionDoc(overrides: Partial<DecisionDocument> = {}): DecisionDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("decision", UUIDS[3]),
    projectId: "project:example-app",
    question: "Should the public API use REST or GraphQL?",
    decision: "Use REST for the public API.",
    status: "proposed",
    reason: "Existing clients already speak REST and the surface area is small.",
    evidence: [
      {
        state: "accepted",
        source: "research-notes",
        summary: "Researcher compared payload size and client churn.",
      },
    ],
    authority: "project-owner",
    producedBy: "agent:researcher",
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:05:00.000Z",
    supersedes: null,
    ...overrides,
  };
}

export function approvalDoc(overrides: Partial<ApprovalDocument> = {}): ApprovalDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("approval", UUIDS[4]),
    projectId: "project:example-app",
    action: "deploy.apply",
    target: "production",
    scope: {
      revision: "a1b2c3d4e5f6789012345678901234567890abcd",
      environment: "production",
    },
    taskId: formatRuntimeId("task", UUIDS[0]),
    resultId: formatRuntimeId("result", UUIDS[2]),
    status: "pending",
    requestedAuthority: "human",
    requestedAt: "2026-01-15T12:10:00.000Z",
    decidedAt: null,
    expiresAt: "2026-01-16T12:10:00.000Z",
    ...overrides,
  };
}

export function verificationDoc(
  overrides: Partial<VerificationDocument> = {},
): VerificationDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("verification", UUIDS[5]),
    taskId: formatRuntimeId("task", UUIDS[0]),
    resultId: formatRuntimeId("result", UUIDS[2]),
    verifierId: "verifier:command",
    candidateRevision: "a1b2c3d4e5f6789012345678901234567890abcd",
    contract: { type: "command", command: "pnpm test" },
    startedAt: "2026-01-15T12:12:00.000Z",
    finishedAt: null,
    status: "pending",
    evidence: [],
    exitCode: null,
    observedFailures: [],
    ...overrides,
  };
}

export function eventDoc(overrides: Partial<EventDocument> = {}): EventDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("event", UUIDS[7]),
    type: "run.started",
    projectId: "project:example-app",
    taskId: formatRuntimeId("task", UUIDS[0]),
    runId: formatRuntimeId("run", UUIDS[1]),
    actor: "agent:coder",
    timestamp: "2026-01-15T12:00:00.000Z",
    data: {},
    ...overrides,
  };
}

export { UUIDS };
