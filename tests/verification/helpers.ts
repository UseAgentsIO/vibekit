import fs from "node:fs";
import path from "node:path";

import {
  createRepositoryState,
  formatRuntimeId,
  type ApprovalDocument,
  type AuthorizationMode,
  type DeliveryMode,
  type ModuleId,
  type ProjectDocument,
  type RepositoryState,
  type ResultDocument,
  type TaskDocument,
} from "@useagentsio/core";

import { approvalDoc, resultDoc, taskDoc, tempProject } from "../state/helpers.js";

export const PASSING_COMMAND = "node -e \"process.exit(0)\"";
export const FAILING_COMMAND = "node -e \"process.exit(1)\"";
export const FIXED_NOW = new Date("2026-01-15T12:20:00.000Z");

export function clock(): Date {
  return FIXED_NOW;
}

export function projectAuth(options?: {
  readonly default?: AuthorizationMode;
  readonly actions?: Readonly<Record<string, AuthorizationMode>>;
  readonly policies?: readonly ModuleId[];
  readonly verifiers?: readonly ModuleId[];
}): Pick<ProjectDocument, "authorization" | "policies" | "verification"> {
  return {
    authorization: {
      default: options?.default ?? "standing",
      actions: options?.actions ?? {},
    },
    policies: options?.policies ?? [],
    verification: {
      default: options?.verifiers ?? [],
    },
  };
}

export function setupScenario(options?: {
  readonly delivery?: DeliveryMode;
  readonly authorization?: AuthorizationMode;
  readonly status?: TaskDocument["status"];
  readonly agentId?: ModuleId;
  readonly revision?: string;
  readonly artifactPath?: string;
}): {
  readonly root: string;
  readonly state: RepositoryState;
  readonly task: TaskDocument;
  readonly result: ResultDocument;
} {
  const root = tempProject();
  const state = createRepositoryState({ projectRoot: root });
  const task = state.tasks.create(
    taskDoc({
      status: options?.status ?? "review",
      delivery: { mode: options?.delivery ?? "proposal" },
      authorization: { state: options?.authorization ?? "standing" },
      assignedAgent: options?.agentId ?? "agent:coder",
    }),
  ).document;
  const result = state.results.create(
    resultDoc({
      agentId: options?.agentId ?? "agent:coder",
      artifacts: [
        {
          path: options?.artifactPath ?? "src/example.ts",
          revision: options?.revision ?? "a1b2c3d4e5f6789012345678901234567890abcd",
        },
      ],
    }),
  ).document;
  return { root, state, task, result };
}

export function approvedFor(
  result: ResultDocument,
  overrides: Partial<ApprovalDocument> = {},
): ApprovalDocument {
  return approvalDoc({
    id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-44665544000b"),
    taskId: result.taskId,
    resultId: result.id,
    action: "result.apply",
    target: result.artifacts[0]?.path ?? result.id,
    scope: { revision: result.artifacts[0]?.revision ?? result.id },
    status: "approved",
    requestedAuthority: "human",
    decidedAt: "2026-01-15T12:18:00.000Z",
    expiresAt: null,
    ...overrides,
  });
}

export function writeFile(root: string, relative: string, contents: string): string {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
  return absolute;
}

export function readFile(root: string, relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

export function exists(root: string, relative: string): boolean {
  return fs.existsSync(path.join(root, relative));
}
