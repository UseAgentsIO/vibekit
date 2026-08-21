import fs from "node:fs";
import path from "node:path";

import { sha256Hex } from "./checksum.js";
import { assertFileTarget } from "./file-targets.js";
import type { EvidenceItem, EventDocument, ResultDocument, TaskDocument } from "./types.js";
import { safeResolve, toPosixPath } from "./paths.js";
import { atomicWriteFile } from "./state/atomic.js";
import type { RepositoryState } from "./state/repository.js";
import {
  DEFAULT_APPLY_ACTION,
  SELF_MODIFY_ACTION,
  assertNotSelfApproval,
} from "./approval-gate.js";
import { evaluateReadiness, type GovernanceInput } from "./proposal.js";
import { appendGovernanceEvent, computeCandidateRevision, governanceError } from "./verify.js";

export interface SelfModificationProposal {
  readonly producedBy: string;
  readonly baseHash: string;
  readonly payloadHash: string;
  readonly affectedFiles: readonly string[];
  readonly proposedContent: Readonly<Record<string, string>>;
  readonly source?: string;
  readonly evidence?: readonly EvidenceItem[];
}

export interface ApplyInput extends GovernanceInput {
  readonly state: RepositoryState;
  readonly projectRoot: string;
  readonly writes?: Readonly<Record<string, string>>;
  readonly selfModification?: SelfModificationProposal;
  readonly clock?: () => Date;
}

export interface ApplyOutcome {
  readonly applied: boolean;
  readonly accepted: boolean;
  readonly written: readonly string[];
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly events: readonly EventDocument[];
  readonly candidateRevision: string;
}

export function hashSelfModificationBase(
  projectRoot: string,
  files: readonly string[],
): string {
  const parts: string[] = [];
  for (const relative of [...files].sort((left, right) => left.localeCompare(right))) {
    assertFileTarget(relative);
    const absolute = safeResolve(projectRoot, relative);
    const contents = fs.existsSync(absolute) ? fs.readFileSync(absolute) : Buffer.alloc(0);
    parts.push(`${toPosixPath(relative)}\0${contents.toString("utf8")}`);
  }
  return `sha256:${sha256Hex(`${parts.join("\n")}${parts.length > 0 ? "\n" : ""}`)}`;
}

export function hashSelfModificationPayload(
  proposedContent: Readonly<Record<string, string>>,
): string {
  const keys = Object.keys(proposedContent).sort((left, right) => left.localeCompare(right));
  const parts = keys.map((relative) => {
    assertFileTarget(relative);
    return `${toPosixPath(relative)}\0${proposedContent[relative] ?? ""}`;
  });
  return `sha256:${sha256Hex(`${parts.join("\n")}${parts.length > 0 ? "\n" : ""}`)}`;
}

export function assertSelfModificationUnchanged(
  projectRoot: string,
  proposal: SelfModificationProposal,
): void {
  const currentBase = hashSelfModificationBase(projectRoot, proposal.affectedFiles);
  if (currentBase !== proposal.baseHash) {
    governanceError(
      "conflict",
      "self_modification_base_mismatch",
      "The target has changed since the self-modification proposal was created",
      { expected: proposal.baseHash, actual: currentBase },
    );
  }
  const currentPayload = hashSelfModificationPayload(proposal.proposedContent);
  if (currentPayload !== proposal.payloadHash) {
    governanceError(
      "conflict",
      "self_modification_payload_mismatch",
      "The approved self-modification proposal has changed",
      { expected: proposal.payloadHash, actual: currentPayload },
    );
  }
  const proposedFiles = Object.keys(proposal.proposedContent).sort((left, right) =>
    left.localeCompare(right),
  );
  const affected = [...proposal.affectedFiles].sort((left, right) => left.localeCompare(right));
  if (proposedFiles.length !== affected.length || proposedFiles.some((file, index) => file !== affected[index])) {
    governanceError(
      "invalid_input",
      "self_modification_files_mismatch",
      "Self-modification affected files must match proposed content paths",
      { affected: proposal.affectedFiles, proposed: proposedFiles },
    );
  }
}

export function applyAcceptedResult(input: ApplyInput): ApplyOutcome {
  const clock = input.clock ?? (input.now !== undefined ? () => input.now as Date : () => new Date());
  const storedTask = input.state.tasks.get(input.task.id);
  const storedResult = input.state.results.get(input.result.id);
  if (storedTask.document.delivery.mode !== "apply") {
    governanceError(
      "policy_blocked",
      "delivery_proposal_blocks_apply",
      "Proposal delivery produces a verified candidate and MUST NOT apply the mutation",
      { mode: storedTask.document.delivery.mode },
    );
  }

  const action = input.action ?? (input.selfModification !== undefined ? SELF_MODIFY_ACTION : DEFAULT_APPLY_ACTION);
  const readiness = evaluateReadiness({
    ...input,
    task: storedTask.document,
    result: storedResult.document,
    action,
    now: clock(),
  });
  if (!readiness.verificationPassed) {
    governanceError(
      "verification_failed",
      "apply_verification_incomplete",
      readiness.reasons[0] ?? "Verification has not passed for this Result",
      { reasons: readiness.reasons, currentRevision: readiness.candidateRevision },
    );
  }
  if (!readiness.authorized) {
    governanceError(
      "authorization_required",
      readiness.authorization.status === "denied" ? "authorization_denied" : "approval_required",
      readiness.authorization.reason,
      { mode: readiness.authorization.mode },
    );
  }
  if (storedTask.document.status !== "accepted") {
    governanceError(
      "policy_blocked",
      "apply_not_accepted",
      "Apply mode applies only an accepted and authorized result",
      { status: storedTask.document.status },
    );
  }

  if (input.selfModification !== undefined) {
    if (input.approverId !== undefined) {
      assertNotSelfApproval(input.selfModification.producedBy, input.approverId);
    }
    assertSelfModificationUnchanged(input.projectRoot, input.selfModification);
  }

  const writes = collectWrites(input);
  const written = applyWrites(input.projectRoot, writes);
  const events: EventDocument[] = [];
  const eventType = written.length > 0 ? "artifact.changed" : "artifact.created";
  events.push(
    appendGovernanceEvent(input.state, {
      type: eventType,
      projectId: storedTask.document.projectId,
      taskId: storedTask.document.id,
      runId: storedResult.document.runId,
      actor: storedResult.document.agentId,
      now: clock(),
      data: {
        resultId: storedResult.document.id,
        candidateRevision: computeCandidateRevision(storedResult.document),
        applied: true,
        written,
      },
    }),
  );
  return {
    applied: true,
    accepted: true,
    written,
    task: storedTask.document,
    result: storedResult.document,
    events,
    candidateRevision: computeCandidateRevision(storedResult.document),
  };
}

export function applySelfModification(input: ApplyInput & { readonly selfModification: SelfModificationProposal }): ApplyOutcome {
  return applyAcceptedResult({
    ...input,
    action: input.action ?? SELF_MODIFY_ACTION,
    writes: input.selfModification.proposedContent,
  });
}

function collectWrites(input: ApplyInput): Readonly<Record<string, string>> {
  if (input.selfModification !== undefined) {
    return input.selfModification.proposedContent;
  }
  return input.writes ?? {};
}

function applyWrites(projectRoot: string, writes: Readonly<Record<string, string>>): string[] {
  const written: string[] = [];
  for (const relative of Object.keys(writes).sort((left, right) => left.localeCompare(right))) {
    assertFileTarget(relative);
    const absolute = safeResolve(projectRoot, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    atomicWriteFile(absolute, writes[relative] ?? "");
    written.push(toPosixPath(relative));
  }
  return written;
}
