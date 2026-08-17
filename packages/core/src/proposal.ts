import type { ModuleId } from "./ids.js";
import type { RepositoryState } from "./state/repository.js";
import type {
  ApprovalDocument,
  ProjectDocument,
  ResultDocument,
  TaskDocument,
  VerificationDocument,
} from "./types.js";
import {
  DEFAULT_APPLY_ACTION,
  assertApprovalAuthorized,
  evaluateApprovalGate,
  type AuthorizationDecision,
} from "./approval-gate.js";
import {
  computeCandidateRevision,
  evaluateVerification,
  governanceError,
  appendGovernanceEvent,
  type VerificationEvaluation,
} from "./verify.js";

export interface GovernanceInput {
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly verifications?: readonly VerificationDocument[];
  readonly required?: readonly ModuleId[];
  readonly independentReview?: boolean;
  readonly project?: Pick<ProjectDocument, "authorization" | "policies" | "verification">;
  readonly action?: string;
  readonly target?: string;
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly approvals?: readonly ApprovalDocument[];
  readonly now?: Date;
  readonly proposerId?: string;
  readonly approverId?: string;
}

export interface GovernanceDecision {
  readonly completed: boolean;
  readonly verificationPassed: boolean;
  readonly authorized: boolean;
  readonly canAccept: boolean;
  readonly canApply: boolean;
  readonly candidateRevision: string;
  readonly action: string;
  readonly target: string;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly reasons: readonly string[];
  readonly verification: VerificationEvaluation;
  readonly authorization: AuthorizationDecision;
}

export interface CandidateProposal {
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly candidateRevision: string;
  readonly delivery: "proposal";
  readonly applied: false;
  readonly accepted: boolean;
  readonly verificationPassed: boolean;
  readonly authorized: boolean;
  readonly decision: GovernanceDecision;
}

export interface AcceptCandidateInput extends GovernanceInput {
  readonly state: RepositoryState;
  readonly now?: Date;
  readonly clock?: () => Date;
}

export interface AcceptCandidateResult {
  readonly task: TaskDocument;
  readonly proposal: CandidateProposal;
}

export function defaultApplyScope(result: ResultDocument): Readonly<Record<string, unknown>> {
  return { revision: computeCandidateRevision(result) };
}

export function defaultApplyTarget(result: ResultDocument): string {
  return result.artifacts[0]?.path ?? result.id;
}

export function evaluateReadiness(input: GovernanceInput): GovernanceDecision {
  const action = input.action ?? DEFAULT_APPLY_ACTION;
  const target = input.target ?? defaultApplyTarget(input.result);
  const scope = input.scope ?? defaultApplyScope(input.result);
  const verifications = input.verifications ?? [];
  const verification = evaluateVerification({
    result: input.result,
    verifications,
    required: input.required,
    independentReview: input.independentReview,
    project: input.project,
  });
  const authorization = evaluateApprovalGate({
    task: input.task,
    result: input.result,
    project: input.project,
    action,
    target,
    scope,
    approvals: input.approvals ?? [],
    now: input.now,
    proposerId: input.proposerId,
    approverId: input.approverId,
  });
  const reasons = [...verification.reasons];
  if (authorization.status !== "authorized") {
    reasons.push(authorization.reason);
  }
  if (input.task.delivery.mode !== "apply") {
    reasons.push("Proposal delivery does not apply the mutation");
  }
  const authorized = authorization.status === "authorized";
  const canAccept = verification.verificationPassed && authorized;
  const canApply =
    canAccept && input.task.status === "accepted" && input.task.delivery.mode === "apply";
  return {
    completed: verification.completed,
    verificationPassed: verification.verificationPassed,
    authorized,
    canAccept,
    canApply,
    candidateRevision: verification.currentRevision,
    action,
    target,
    scope,
    reasons,
    verification,
    authorization,
  };
}

export function createProposal(input: GovernanceInput): CandidateProposal {
  const decision = evaluateReadiness(input);
  return {
    task: input.task,
    result: input.result,
    candidateRevision: decision.candidateRevision,
    delivery: "proposal",
    applied: false,
    accepted: input.task.status === "accepted",
    verificationPassed: decision.verificationPassed,
    authorized: decision.authorized,
    decision,
  };
}

export function acceptCandidate(input: AcceptCandidateInput): AcceptCandidateResult {
  const clock = input.clock ?? (input.now !== undefined ? () => input.now as Date : () => new Date());
  const storedTask = input.state.tasks.get(input.task.id);
  const storedResult = input.state.results.get(input.result.id);
  const decision = evaluateReadiness({
    ...input,
    task: storedTask.document,
    result: storedResult.document,
    now: clock(),
  });
  if (!decision.verificationPassed) {
    governanceError(
      "verification_failed",
      "acceptance_verification_incomplete",
      decision.reasons[0] ?? "Verification has not passed for this Result",
      {
        reasons: decision.reasons,
        missing: decision.verification.missing,
        currentRevision: decision.candidateRevision,
      },
    );
  }
  assertApprovalAuthorized(decision.authorization);

  if (storedTask.document.status === "accepted") {
    return {
      task: storedTask.document,
      proposal: createProposal({
        ...input,
        task: storedTask.document,
        result: storedResult.document,
      }),
    };
  }

  const accepted = input.state.tasks.update(
    {
      ...storedTask.document,
      status: "accepted",
      updatedAt: clock().toISOString(),
    },
    { expectedRevision: storedTask.revision },
  );
  appendGovernanceEvent(input.state, {
    type: "task.completed",
    projectId: accepted.document.projectId,
    taskId: accepted.document.id,
    runId: storedResult.document.runId,
    actor: storedResult.document.agentId,
    now: clock(),
    data: {
      resultId: storedResult.document.id,
      candidateRevision: decision.candidateRevision,
      accepted: true,
      applied: false,
    },
  });
  return {
    task: accepted.document,
    proposal: createProposal({
      ...input,
      task: accepted.document,
      result: storedResult.document,
    }),
  };
}
