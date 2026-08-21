import { VibeKitError } from "./errors.js";

export const TASK_STATES = [
  "open",
  "claimed",
  "running",
  "blocked",
  "review",
  "accepted",
  "failed",
  "cancelled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const RUN_STATES = [
  "created",
  "ready",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const DECISION_STATES = [
  "proposed",
  "accepted",
  "rejected",
  "disputed",
  "superseded",
] as const;

export type DecisionState = (typeof DECISION_STATES)[number];

export const APPROVAL_STATES = ["pending", "approved", "rejected", "expired"] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const VERIFICATION_STATES = ["pending", "passed", "failed", "skipped"] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const EVIDENCE_STATES = [
  "observed",
  "proposed",
  "accepted",
  "rejected",
  "disputed",
  "superseded",
  "inferred",
  "unresolved",
] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const LIFECYCLE_KINDS = [
  "task",
  "run",
  "decision",
  "approval",
  "verification",
  "evidence",
] as const;

export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

export interface LifecycleStateMap {
  task: TaskState;
  run: RunState;
  decision: DecisionState;
  approval: ApprovalState;
  verification: VerificationState;
  evidence: EvidenceState;
}

const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  open: ["claimed", "cancelled"],
  claimed: ["running", "cancelled", "open"],
  running: ["blocked", "review", "accepted", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  review: ["accepted", "failed", "cancelled"],
  accepted: [],
  failed: [],
  cancelled: [],
};

const RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  created: ["ready", "cancelled"],
  ready: ["running", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled", "timed_out"],
  waiting: ["running", "cancelled", "timed_out", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

const DECISION_TRANSITIONS: Record<DecisionState, readonly DecisionState[]> = {
  proposed: ["accepted", "rejected", "disputed"],
  accepted: ["superseded"],
  rejected: ["superseded"],
  disputed: ["superseded"],
  superseded: [],
};

const APPROVAL_TRANSITIONS: Record<ApprovalState, readonly ApprovalState[]> = {
  pending: ["approved", "rejected", "expired"],
  approved: [],
  rejected: [],
  expired: [],
};

const VERIFICATION_TRANSITIONS: Record<
  VerificationState,
  readonly VerificationState[]
> = {
  pending: ["passed", "failed", "skipped"],
  passed: [],
  failed: [],
  skipped: [],
};

const EVIDENCE_TRANSITIONS: Record<EvidenceState, readonly EvidenceState[]> = {
  proposed: ["accepted", "rejected", "disputed", "superseded"],
  observed: ["accepted", "rejected", "disputed", "unresolved", "superseded"],
  inferred: ["accepted", "rejected", "disputed", "unresolved", "superseded"],
  accepted: ["superseded"],
  rejected: ["superseded"],
  disputed: ["superseded"],
  unresolved: ["accepted", "rejected", "disputed", "superseded"],
  superseded: [],
};

const TRANSITION_TABLES = {
  task: TASK_TRANSITIONS,
  run: RUN_TRANSITIONS,
  decision: DECISION_TRANSITIONS,
  approval: APPROVAL_TRANSITIONS,
  verification: VERIFICATION_TRANSITIONS,
  evidence: EVIDENCE_TRANSITIONS,
} as const;

const STATE_SETS: Record<LifecycleKind, ReadonlySet<string>> = {
  task: new Set(TASK_STATES),
  run: new Set(RUN_STATES),
  decision: new Set(DECISION_STATES),
  approval: new Set(APPROVAL_STATES),
  verification: new Set(VERIFICATION_STATES),
  evidence: new Set(EVIDENCE_STATES),
};

export function isLifecycleKind(value: string): value is LifecycleKind {
  return (LIFECYCLE_KINDS as readonly string[]).includes(value);
}

export function allowedTransitions<K extends LifecycleKind>(
  kind: K,
  from: LifecycleStateMap[K],
): readonly LifecycleStateMap[K][] {
  const table = TRANSITION_TABLES[kind] as Record<
    LifecycleStateMap[K],
    readonly LifecycleStateMap[K][]
  >;
  return table[from] ?? [];
}

export function canTransition<K extends LifecycleKind>(
  kind: K,
  from: string,
  to: string,
): boolean {
  if (from === to) {
    return false;
  }
  const states = STATE_SETS[kind];
  if (!states.has(from) || !states.has(to)) {
    return false;
  }
  const allowed = (TRANSITION_TABLES[kind] as Record<string, readonly string[]>)[from];
  return allowed !== undefined && allowed.includes(to);
}

export function assertTransition<K extends LifecycleKind>(
  kind: K,
  from: string,
  to: string,
): void {
  if (!isLifecycleKind(kind)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "lifecycle_kind_unknown",
      message: `Unknown lifecycle kind "${String(kind)}"`,
    });
  }
  if (from === to) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "lifecycle_same_state",
      message: `${kind} transition from ${from} to ${to} is invalid`,
      details: { kind, from, to },
    });
  }
  const states = STATE_SETS[kind];
  if (!states.has(from) || !states.has(to)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "lifecycle_state_unknown",
      message: `Unknown ${kind} state in transition ${from} → ${to}`,
      details: { kind, from, to },
    });
  }
  const allowed = (TRANSITION_TABLES[kind] as Record<string, readonly string[]>)[from];
  if (allowed === undefined || !allowed.includes(to)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "lifecycle_invalid_transition",
      message: `Invalid ${kind} transition: ${from} → ${to}`,
      details: { kind, from, to, allowed: allowed ?? [] },
    });
  }
}
