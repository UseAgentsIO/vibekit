import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { sha256Hex } from "./checksum.js";
import { VibeKitError, redactSecrets, type FailureCategory } from "./errors.js";
import { formatRuntimeId, type ModuleId, type ProjectId, type RuntimeId } from "./ids.js";
import { CURRENT_SCHEMA_VERSION } from "./schema-version.js";
import type { RepositoryState } from "./state/repository.js";
import type {
  EventDocument,
  ProjectDocument,
  ResultDocument,
  TaskDocument,
  VerificationDocument,
} from "./types.js";

export const COMMAND_VERIFIER_ID = "verifier:command" as const;
export const REQUIRE_VERIFICATION_POLICY = "policy:require-verification" as const;
export const COMMAND_VERIFIER_CONFIG_RELATIVE_PATH =
  ".vibekit/config/verifiers/command.yaml" as const;

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const OUTPUT_EVIDENCE_LIMIT = 500;

export interface CommandVerifierRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CommandVerifierResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandVerifierConfig {
  readonly command?: string;
}

export interface VerificationEvaluation {
  readonly completed: boolean;
  readonly verificationPassed: boolean;
  readonly independentReviewPassed: boolean;
  readonly currentRevision: string;
  readonly passed: readonly VerificationDocument[];
  readonly failed: readonly VerificationDocument[];
  readonly stale: readonly VerificationDocument[];
  readonly missing: readonly ModuleId[];
  readonly reasons: readonly string[];
}

export interface EvaluateVerificationInput {
  readonly result: ResultDocument;
  readonly verifications: readonly VerificationDocument[];
  readonly required?: readonly ModuleId[];
  readonly independentReview?: boolean;
  readonly project?: Pick<ProjectDocument, "policies" | "verification">;
}

export interface RunCommandVerificationInput {
  readonly state: RepositoryState;
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly command?: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly verifierId?: ModuleId;
  readonly now?: () => Date;
  readonly actor?: string;
}

export interface RunCommandVerificationResult {
  readonly verification: VerificationDocument;
  readonly result: ResultDocument;
}

export interface IndependentReviewInput {
  readonly state: RepositoryState;
  readonly task: TaskDocument;
  readonly result: ResultDocument;
  readonly reviewerId: ModuleId;
  readonly verdict: "passed" | "failed";
  readonly summary?: string;
  readonly now?: () => Date;
}

export function computeCandidateRevision(result: ResultDocument): string {
  if (result.artifacts.length === 1) {
    const artifact = result.artifacts[0];
    if (artifact !== undefined) {
      return artifact.revision;
    }
  }
  const parts = [...result.artifacts]
    .map((artifact) => `${artifact.path}\0${artifact.revision}`)
    .sort((left, right) => left.localeCompare(right));
  return `sha256:${sha256Hex(`${parts.join("\n")}${parts.length > 0 ? "\n" : ""}`)}`;
}

export function verificationCoversRevision(
  verification: VerificationDocument,
  result: ResultDocument,
): boolean {
  return verification.candidateRevision === computeCandidateRevision(result);
}

export function isVerificationCurrent(
  verification: VerificationDocument,
  result: ResultDocument,
): boolean {
  return (
    verification.resultId === result.id &&
    verification.taskId === result.taskId &&
    verificationCoversRevision(verification, result)
  );
}

export function resolveRequiredVerifiers(input: {
  readonly required?: readonly ModuleId[];
  readonly project?: Pick<ProjectDocument, "policies" | "verification">;
}): readonly ModuleId[] {
  const required = uniqueModuleIds([
    ...(input.required ?? []),
    ...(input.project?.verification.default ?? []),
  ]);
  if (
    input.project?.policies.includes(REQUIRE_VERIFICATION_POLICY) &&
    required.length === 0
  ) {
    throw new VibeKitError({
      category: "configuration_invalid",
      code: "verification_required",
      message: "Policy require-verification is active but no Verifiers are configured",
      details: { policies: input.project.policies },
    });
  }
  return required;
}

export function loadCommandVerifierConfig(projectRoot: string): CommandVerifierConfig {
  const configPath = path.join(projectRoot, COMMAND_VERIFIER_CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed: unknown = parse(raw);
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VibeKitError({
      category: "configuration_invalid",
      code: "verifier_command_config_invalid",
      message: "Command verifier configuration must be a mapping",
      details: { path: COMMAND_VERIFIER_CONFIG_RELATIVE_PATH },
    });
  }
  const command = (parsed as { command?: unknown }).command;
  if (command === undefined) {
    return {};
  }
  if (typeof command !== "string" || command.trim() === "") {
    throw new VibeKitError({
      category: "configuration_invalid",
      code: "verifier_command_config_invalid",
      message: "Command verifier configuration command must be a non-empty string",
      details: { path: COMMAND_VERIFIER_CONFIG_RELATIVE_PATH },
    });
  }
  return { command };
}

export function executeCommandVerifier(input: CommandVerifierRequest): CommandVerifierResponse {
  const command = input.command.trim();
  if (command === "") {
    throw new VibeKitError({
      category: "invalid_input",
      code: "verifier_command_missing",
      message: "Command verifier requires a non-empty command",
    });
  }
  if (input.cwd.trim() === "") {
    throw new VibeKitError({
      category: "invalid_input",
      code: "verifier_command_cwd_missing",
      message: "Command verifier requires a working directory",
    });
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const spawned = spawnSync(command, {
    cwd: input.cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    env: input.env ?? process.env,
    maxBuffer: 1024 * 1024,
  });
  const timedOut = spawned.error?.message.includes("ETIMEDOUT") === true || spawned.signal === "SIGTERM";
  const stdout = redactSecrets(spawned.stdout ?? "");
  const stderr = redactSecrets(spawned.stderr ?? spawned.error?.message ?? "");
  return {
    exitCode: spawned.status ?? 1,
    stdout,
    stderr,
    timedOut,
  };
}

export function evaluateVerification(input: EvaluateVerificationInput): VerificationEvaluation {
  const required = resolveRequiredVerifiers(input);
  const independentReview = input.independentReview === true;
  const completed = input.result.status === "completed";
  const currentRevision = computeCandidateRevision(input.result);
  const forResult = input.verifications.filter((verification) => verification.resultId === input.result.id);
  const stale = forResult.filter((verification) => !verificationCoversRevision(verification, input.result));
  const current = forResult.filter((verification) => verificationCoversRevision(verification, input.result));
  const passed = current.filter((verification) => verification.status === "passed");
  const failed = current.filter((verification) => verification.status === "failed");
  const reasons: string[] = [];

  if (!completed) {
    reasons.push("Result is not completed");
  }

  const missing: ModuleId[] = [];
  for (const verifierId of required) {
    const match = passed.find((verification) => verification.verifierId === verifierId);
    if (match === undefined) {
      missing.push(verifierId);
      const failedMatch = failed.find((verification) => verification.verifierId === verifierId);
      if (failedMatch !== undefined) {
        reasons.push(`Required verifier ${verifierId} failed`);
      } else if (stale.some((verification) => verification.verifierId === verifierId)) {
        reasons.push(`Verification for ${verifierId} does not cover revision ${currentRevision}`);
      } else {
        reasons.push(`Required verifier ${verifierId} has not passed`);
      }
    }
  }

  const reviewPassed = passed.filter(
    (verification) =>
      verification.contract.type === "review" && verification.verifierId !== input.result.agentId,
  );
  const selfReviews = current.filter(
    (verification) =>
      verification.contract.type === "review" && verification.verifierId === input.result.agentId,
  );
  if (selfReviews.length > 0) {
    reasons.push("Independent review cannot be performed by the producing Agent");
  }

  let independentReviewPassed = !independentReview;
  if (independentReview) {
    independentReviewPassed = reviewPassed.length > 0 && selfReviews.length === 0;
    if (!independentReviewPassed && selfReviews.length === 0) {
      reasons.push("Independent review has not passed");
    }
  }

  const verificationPassed =
    completed && missing.length === 0 && independentReviewPassed && selfReviews.length === 0;

  return {
    completed,
    verificationPassed,
    independentReviewPassed,
    currentRevision,
    passed,
    failed,
    stale,
    missing,
    reasons,
  };
}

export function runCommandVerification(
  input: RunCommandVerificationInput,
): RunCommandVerificationResult {
  const command = input.command?.trim() || loadCommandVerifierConfig(input.cwd).command;
  if (command === undefined || command.trim() === "") {
    throw new VibeKitError({
      category: "configuration_invalid",
      code: "verifier_command_missing",
      message: "Command verifier requires a declared command",
    });
  }
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const candidateRevision = computeCandidateRevision(input.result);
  const verifierId = input.verifierId ?? COMMAND_VERIFIER_ID;
  const actor = input.actor ?? verifierId;
  const pending = createVerificationDocument({
    taskId: input.task.id,
    resultId: input.result.id,
    verifierId,
    candidateRevision,
    contract: { type: "command", command },
    startedAt,
    finishedAt: null,
    status: "pending",
    evidence: [],
    exitCode: null,
    observedFailures: [],
  });
  const storedPending = input.state.verifications.create(pending);
  appendGovernanceEvent(input.state, {
    type: "verification.started",
    projectId: input.task.projectId,
    taskId: input.task.id,
    runId: input.result.runId,
    actor,
    now: now(),
    data: {
      verificationId: storedPending.document.id,
      verifierId,
      candidateRevision,
      command,
    },
  });

  const executed = executeCommandVerifier({
    command,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    env: input.env,
  });
  const finishedAt = now().toISOString();
  const passed = executed.exitCode === 0 && !executed.timedOut;
  const observedFailures: string[] = [];
  if (executed.timedOut) {
    observedFailures.push("Command verifier timed out");
  }
  if (executed.exitCode !== 0) {
    observedFailures.push(`Command exited ${executed.exitCode}`);
    const excerpt = excerptOutput(executed.stderr || executed.stdout);
    if (excerpt !== "") {
      observedFailures.push(excerpt);
    }
  }
  const finished: VerificationDocument = {
    ...storedPending.document,
    finishedAt,
    status: passed ? "passed" : "failed",
    exitCode: executed.exitCode,
    observedFailures,
    evidence: [
      {
        state: "observed",
        source: verifierId,
        summary: redactSecrets(
          executed.timedOut
            ? `Command timed out for revision ${candidateRevision}`
            : `Command exited ${executed.exitCode} for revision ${candidateRevision}`,
        ),
      },
    ],
  };
  const stored = input.state.verifications.update(finished, { expectedHash: storedPending.hash });
  appendGovernanceEvent(input.state, {
    type: passed ? "verification.passed" : "verification.failed",
    projectId: input.task.projectId,
    taskId: input.task.id,
    runId: input.result.runId,
    actor,
    now: now(),
    data: {
      verificationId: stored.document.id,
      verifierId,
      candidateRevision,
      exitCode: executed.exitCode,
      timedOut: executed.timedOut,
    },
  });
  const result = linkVerification(input.state, input.result, stored.document.id);
  return { verification: stored.document, result };
}

export function recordIndependentReview(input: IndependentReviewInput): RunCommandVerificationResult {
  assertIndependentReviewer(input.result.agentId, input.reviewerId);
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const candidateRevision = computeCandidateRevision(input.result);
  const pending = createVerificationDocument({
    taskId: input.task.id,
    resultId: input.result.id,
    verifierId: input.reviewerId,
    candidateRevision,
    contract: { type: "review", review: "independent" },
    startedAt,
    finishedAt: null,
    status: "pending",
    evidence: [],
    observedFailures: [],
  });
  const storedPending = input.state.verifications.create(pending);
  appendGovernanceEvent(input.state, {
    type: "verification.started",
    projectId: input.task.projectId,
    taskId: input.task.id,
    runId: input.result.runId,
    actor: input.reviewerId,
    now: now(),
    data: {
      verificationId: storedPending.document.id,
      verifierId: input.reviewerId,
      candidateRevision,
      review: "independent",
    },
  });
  const finishedAt = now().toISOString();
  const finished: VerificationDocument = {
    ...storedPending.document,
    finishedAt,
    status: input.verdict,
    evidence: [
      {
        state: input.verdict === "passed" ? "accepted" : "rejected",
        source: input.reviewerId,
        summary: input.summary ?? `Independent review ${input.verdict}`,
      },
    ],
    observedFailures: input.verdict === "failed" ? [input.summary ?? "Independent review failed"] : [],
  };
  const stored = input.state.verifications.update(finished, { expectedHash: storedPending.hash });
  appendGovernanceEvent(input.state, {
    type: input.verdict === "passed" ? "verification.passed" : "verification.failed",
    projectId: input.task.projectId,
    taskId: input.task.id,
    runId: input.result.runId,
    actor: input.reviewerId,
    now: now(),
    data: {
      verificationId: stored.document.id,
      verifierId: input.reviewerId,
      candidateRevision,
      review: "independent",
    },
  });
  const result = linkVerification(input.state, input.result, stored.document.id);
  return { verification: stored.document, result };
}

export function assertIndependentReviewer(producingAgentId: ModuleId, reviewerId: ModuleId): void {
  if (producingAgentId === reviewerId) {
    throw new VibeKitError({
      category: "policy_blocked",
      code: "independent_review_self",
      message: "The producing Agent MUST NOT satisfy independent review by reviewing its own work",
      details: { producingAgentId, reviewerId },
    });
  }
}

export function createVerificationDocument(
  input: Omit<VerificationDocument, "schemaVersion" | "id"> & { readonly id?: RuntimeId },
): VerificationDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id ?? formatRuntimeId("verification", randomUUID()),
    taskId: input.taskId,
    resultId: input.resultId,
    verifierId: input.verifierId,
    candidateRevision: input.candidateRevision,
    contract: input.contract,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: input.status,
    evidence: input.evidence,
    exitCode: input.exitCode,
    observedFailures: input.observedFailures,
    ...(input.skipReason !== undefined ? { skipReason: input.skipReason } : {}),
  };
}

export function appendGovernanceEvent(
  state: RepositoryState,
  input: {
    readonly type: EventDocument["type"];
    readonly projectId: ProjectId;
    readonly taskId?: RuntimeId | null;
    readonly runId?: RuntimeId | null;
    readonly actor: string;
    readonly data?: Readonly<Record<string, unknown>>;
    readonly now?: Date;
  },
): EventDocument {
  return state.events.append({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: formatRuntimeId("event", randomUUID()),
    type: input.type,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    actor: input.actor,
    timestamp: (input.now ?? new Date()).toISOString(),
    data: input.data ?? {},
  });
}

export function governanceError(
  category: FailureCategory,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new VibeKitError({ category, code, message, details });
}

function linkVerification(
  state: RepositoryState,
  result: ResultDocument,
  verificationId: RuntimeId,
): ResultDocument {
  const stored = state.results.get(result.id);
  if (stored.document.verificationIds.includes(verificationId)) {
    return stored.document;
  }
  return state.results.update(
    {
      ...stored.document,
      verificationIds: [...stored.document.verificationIds, verificationId],
    },
    { expectedHash: stored.hash },
  ).document;
}

function excerptOutput(text: string): string {
  const trimmed = redactSecrets(text).trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed.length <= OUTPUT_EVIDENCE_LIMIT) {
    return trimmed;
  }
  return trimmed.slice(trimmed.length - OUTPUT_EVIDENCE_LIMIT);
}

function uniqueModuleIds(values: readonly ModuleId[]): ModuleId[] {
  return [...new Set(values)];
}
