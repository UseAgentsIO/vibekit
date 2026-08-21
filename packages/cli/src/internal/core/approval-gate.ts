import { randomUUID } from "node:crypto";

import { CURRENT_SCHEMA_VERSION } from "./schema-version.js";
import { formatRuntimeId, type RuntimeId } from "./ids.js";
import type { RepositoryState } from "./state/repository.js";
import type {
  ApprovalDocument,
  AuthorizationMode,
  ProjectDocument,
  ResultDocument,
  TaskDocument,
} from "./types.js";
import { appendGovernanceEvent, governanceError } from "./verify.js";

export const DEFAULT_APPLY_ACTION = "result.apply" as const;
export const SELF_MODIFY_ACTION = "self-modify.apply" as const;

export type AuthorizationDecision =
  | {
      readonly status: "authorized";
      readonly mode: AuthorizationMode;
      readonly approval?: ApprovalDocument;
      readonly reason: string;
    }
  | {
      readonly status: "denied";
      readonly mode: AuthorizationMode;
      readonly reason: string;
    }
  | {
      readonly status: "approval_required";
      readonly mode: "explicit";
      readonly reason: string;
    };

export interface ApprovalMatchInput {
  readonly approval: ApprovalDocument;
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly taskId?: RuntimeId;
  readonly resultId?: RuntimeId;
  readonly now?: Date;
}

export interface EvaluateApprovalGateInput {
  readonly task: TaskDocument;
  readonly result?: ResultDocument;
  readonly project?: Pick<ProjectDocument, "authorization">;
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly approvals: readonly ApprovalDocument[];
  readonly now?: Date;
  readonly proposerId?: string;
  readonly approverId?: string;
}

export interface RequestApprovalInput {
  readonly state: RepositoryState;
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly requestedAuthority: string;
  readonly expiresAt?: string | null;
  readonly now?: () => Date;
}

export interface DecideApprovalInput {
  readonly state: RepositoryState;
  readonly approval: ApprovalDocument;
  readonly decision: "approved" | "rejected";
  readonly now?: () => Date;
  readonly actor?: string;
}

export function resolveAuthorizationMode(input: {
  readonly task: TaskDocument;
  readonly project?: Pick<ProjectDocument, "authorization">;
  readonly action: string;
}): AuthorizationMode {
  const projectAction = input.project?.authorization.actions[input.action];
  const modes: AuthorizationMode[] = [input.task.authorization.state];
  if (projectAction !== undefined) {
    modes.push(projectAction);
  } else if (input.project !== undefined) {
    modes.push(input.project.authorization.default);
  }
  if (modes.includes("deny")) {
    return "deny";
  }
  if (modes.includes("explicit")) {
    return "explicit";
  }
  return "standing";
}

export function scopesMatch(
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
): boolean {
  return stableSerialize(expected) === stableSerialize(actual);
}

export function approvalMatches(input: ApprovalMatchInput): boolean {
  if (input.approval.status !== "approved") {
    return false;
  }
  if (input.approval.action !== input.action || input.approval.target !== input.target) {
    return false;
  }
  if (!scopesMatch(input.approval.scope, input.scope)) {
    return false;
  }
  if (input.taskId !== undefined && input.approval.taskId !== input.taskId) {
    return false;
  }
  if (input.resultId !== undefined && input.approval.resultId !== input.resultId) {
    return false;
  }
  if (isApprovalExpired(input.approval, input.now ?? new Date())) {
    return false;
  }
  return true;
}

export function findMatchingApproval(input: {
  readonly approvals: readonly ApprovalDocument[];
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly taskId?: RuntimeId;
  readonly resultId?: RuntimeId;
  readonly now?: Date;
}): ApprovalDocument | undefined {
  return input.approvals.find((approval) =>
    approvalMatches({
      approval,
      action: input.action,
      target: input.target,
      scope: input.scope,
      taskId: input.taskId,
      resultId: input.resultId,
      now: input.now,
    }),
  );
}

export function evaluateApprovalGate(input: EvaluateApprovalGateInput): AuthorizationDecision {
  if (input.proposerId !== undefined && input.approverId !== undefined) {
    assertNotSelfApproval(input.proposerId, input.approverId);
  }
  const mode = resolveAuthorizationMode({
    task: input.task,
    project: input.project,
    action: input.action,
  });
  if (mode === "deny") {
    return {
      status: "denied",
      mode,
      reason:
        `Authorization denies ${displayAction(input.action)} on ${input.target}. ` +
        `Set Project authorization for this action to explicit or standing only when you intend to allow it.`,
    };
  }
  if (mode === "standing") {
    return {
      status: "authorized",
      mode,
      reason: "Standing authorization already covers this bounded action",
    };
  }
  const match = findMatchingApproval({
    approvals: input.approvals,
    action: input.action,
    target: input.target,
    scope: input.scope,
    taskId: input.task.id,
    resultId: input.result?.id,
    now: input.now,
  });
  if (match === undefined) {
    return {
      status: "approval_required",
      mode: "explicit",
      reason:
        `Explicit Approval is required for ${displayAction(input.action)} on ${input.target}. ` +
        `Consequence: ${approvalConsequence(input.action)}. Approve this exact action in the pending Approval request.`,
    };
  }
  return {
    status: "authorized",
    mode,
    approval: match,
    reason: "Durable Approval covers the exact action, target, and scope",
  };
}

export function assertApprovalAuthorized(decision: AuthorizationDecision): void {
  if (decision.status === "authorized") {
    return;
  }
  if (decision.status === "denied") {
    governanceError("authorization_required", "authorization_denied", decision.reason, {
      mode: decision.mode,
    });
  }
  governanceError("authorization_required", "approval_required", decision.reason, {
    mode: decision.mode,
  });
}

export function assertNotSelfApproval(proposerId: string, approverId: string): void {
  if (proposerId === approverId) {
    governanceError(
      "policy_blocked",
      "approval_self",
      "The proposing Agent cannot approve its own consequential change",
      { proposerId, approverId },
    );
  }
}

export function requestApproval(input: RequestApprovalInput): ApprovalDocument {
  const now = input.now ?? (() => new Date());
  const requestedAt = now().toISOString();
  const document: ApprovalDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: formatRuntimeId("approval", randomUUID()),
    projectId: input.task.projectId,
    action: input.action,
    target: input.target,
    scope: input.scope,
    taskId: input.task.id,
    resultId: input.result.id,
    status: "pending",
    requestedAuthority: input.requestedAuthority,
    requestedAt,
    decidedAt: null,
    expiresAt: input.expiresAt ?? null,
  };
  const stored = input.state.approvals.create(document);
  appendGovernanceEvent(input.state, {
    type: "approval.requested",
    projectId: input.task.projectId,
    taskId: input.task.id,
    runId: input.result.runId,
    actor: input.requestedAuthority,
    now: now(),
    data: {
      approvalId: stored.document.id,
      action: input.action,
      target: input.target,
      scope: input.scope,
    },
  });
  return stored.document;
}

export function decideApproval(input: DecideApprovalInput): ApprovalDocument {
  const stored = input.state.approvals.get(input.approval.id);
  const now = input.now ?? (() => new Date());
  const decided: ApprovalDocument = {
    ...stored.document,
    status: input.decision,
    decidedAt: now().toISOString(),
  };
  const updated = input.state.approvals.update(decided, { expectedHash: stored.hash });
  appendGovernanceEvent(input.state, {
    type: input.decision === "approved" ? "approval.approved" : "approval.rejected",
    projectId: stored.document.projectId ?? "project:unknown",
    taskId: stored.document.taskId,
    actor: input.actor ?? stored.document.requestedAuthority,
    now: now(),
    data: {
      approvalId: updated.document.id,
      action: updated.document.action,
      target: updated.document.target,
    },
  });
  return updated.document;
}

export function isApprovalExpired(approval: ApprovalDocument, now: Date): boolean {
  if (approval.status === "expired") {
    return true;
  }
  if (approval.expiresAt === undefined || approval.expiresAt === null) {
    return false;
  }
  return now.toISOString() >= approval.expiresAt;
}

function displayAction(action: string): string {
  const capability = action.split(" / ").at(-1) ?? action;
  const labels: Readonly<Record<string, string>> = {
    "source.read": "read files",
    "source.write": "change files",
    "command.execute": "run an approved command",
    "web.fetch": "fetch a web page",
    "web.search": "search the web",
    "memory.read": "read saved memory",
    "memory.write": "save memory",
    "deploy.apply": "apply a deployment",
    "destructive.delete": "permanently delete data",
    "project.configure": "change Project configuration",
    "repository.write": "change repository content",
    "repository.issue.write": "send a repository issue",
    "schedule.write": "change a scheduled task",
    "outbound.send": "send an outbound message",
    "purchase.execute": "make a purchase",
  };
  return labels[capability] ?? capability;
}

function approvalConsequence(action: string): string {
  const capability = action.split(" / ").at(-1) ?? action;
  if (capability === "source.write") return "files in the requested scope will be changed";
  if (capability === "command.execute") return "the requested command will run";
  if (capability === "deploy.apply") return "the selected deployment target will change";
  if (capability === "destructive.delete") return "the selected data may be permanently removed";
  if (capability === "project.configure") return "future Project behavior may change";
  if (capability === "repository.issue.write") return "the repository issue will be sent to the selected project";
  if (capability === "schedule.write") return "the scheduled task will be changed";
  if (capability === "outbound.send") return "an external recipient will receive the message";
  if (capability === "purchase.execute") return "a purchase may be placed with the selected account";
  return `the requested ${displayAction(action)} action will run`;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}
