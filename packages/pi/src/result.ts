import {
  CURRENT_SCHEMA_VERSION,
  redactSecrets,
  validateDocument,
  type ModuleId,
  type ResultArtifact,
  type ResultDocument,
  type ResultStatus,
  type RuntimeId,
} from "@vibekit/core";

import { newRuntimeId } from "./ids.js";

export interface CollectResultInput {
  readonly taskId: RuntimeId;
  readonly runId: RuntimeId;
  readonly agentId: ModuleId;
  readonly assistantText: string;
  readonly status: ResultStatus;
  readonly fallbackSummary: string;
  readonly unresolvedIssues?: readonly string[];
  readonly now?: Date;
}

export function collectResult(input: CollectResultInput): ResultDocument {
  const extracted = extractResultPayload(input.assistantText);
  const summary = redactSecrets(
    nonEmpty(extracted.summary) ?? nonEmpty(input.fallbackSummary) ?? input.status,
  );
  const candidate = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newRuntimeId("result"),
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    status: input.status === "completed" ? (extracted.status ?? "completed") : input.status,
    summary,
    artifacts: sanitizeArtifacts(extracted.artifacts),
    evidence: extracted.evidence ?? [],
    verificationIds: [],
    unresolvedIssues: [
      ...(extracted.unresolvedIssues ?? []),
      ...(input.unresolvedIssues ?? []),
    ].map((item) => redactSecrets(item)),
    discoveredConstraints: (extracted.discoveredConstraints ?? []).map((item) =>
      redactSecrets(item),
    ),
    recommendedNextActions: (extracted.recommendedNextActions ?? []).map((item) =>
      redactSecrets(item),
    ),
    createdAt: (input.now ?? new Date()).toISOString(),
  };

  const validated = validateDocument("result", candidate);
  if (validated.valid && validated.data !== undefined) {
    return validated.data;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: candidate.id,
    taskId: input.taskId,
    runId: input.runId,
    agentId: input.agentId,
    status: "failed",
    summary: redactSecrets(nonEmpty(input.fallbackSummary) ?? "Result collection failed"),
    artifacts: [],
    evidence: [],
    verificationIds: [],
    unresolvedIssues: [
      ...(input.unresolvedIssues ?? []),
      "result-contract-invalid",
    ],
    discoveredConstraints: [],
    recommendedNextActions: [],
    createdAt: candidate.createdAt,
  };
}

interface ExtractedResult {
  readonly status?: ResultStatus;
  readonly summary?: string;
  readonly artifacts?: readonly ResultArtifact[];
  readonly evidence?: ResultDocument["evidence"];
  readonly unresolvedIssues?: readonly string[];
  readonly discoveredConstraints?: readonly string[];
  readonly recommendedNextActions?: readonly string[];
}

export function extractResultPayload(text: string): ExtractedResult {
  const jsonBlock = extractJsonObject(text);
  if (jsonBlock === undefined) {
    return {};
  }
  const status =
    jsonBlock.status === "completed" || jsonBlock.status === "failed"
      ? jsonBlock.status
      : undefined;
  return {
    status,
    summary: typeof jsonBlock.summary === "string" ? jsonBlock.summary : undefined,
    artifacts: Array.isArray(jsonBlock.artifacts)
      ? (jsonBlock.artifacts as ResultArtifact[])
      : undefined,
    evidence: Array.isArray(jsonBlock.evidence)
      ? (jsonBlock.evidence as ResultDocument["evidence"])
      : undefined,
    unresolvedIssues: stringArray(jsonBlock.unresolvedIssues),
    discoveredConstraints: stringArray(jsonBlock.discoveredConstraints),
    recommendedNextActions: stringArray(jsonBlock.recommendedNextActions),
  };
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? firstBalancedObject(text);
  if (candidate === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function sanitizeArtifacts(artifacts: readonly ResultArtifact[] | undefined): ResultArtifact[] {
  if (artifacts === undefined) {
    return [];
  }
  return artifacts.filter(
    (artifact) =>
      artifact !== null &&
      typeof artifact === "object" &&
      typeof artifact.path === "string" &&
      artifact.path.length > 0 &&
      typeof artifact.revision === "string" &&
      artifact.revision.length > 0,
  );
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
