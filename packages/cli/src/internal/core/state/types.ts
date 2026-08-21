import type { ModuleId, RuntimeId } from "../ids.js";
import type {
  ApprovalDocument,
  DecisionDocument,
  EventDocument,
  ProjectTracking,
  ResultDocument,
  TaskDocument,
  TrackingMode,
  VerificationDocument,
} from "../types.js";

export const STATE_RECORD_KINDS = [
  "tasks",
  "results",
  "decisions",
  "approvals",
  "verifications",
  "events",
] as const;

export type StateRecordKind = (typeof STATE_RECORD_KINDS)[number];

export const DOCUMENT_STORE_KINDS = [
  "task",
  "result",
  "decision",
  "approval",
  "verification",
] as const;

export type DocumentStoreKind = (typeof DOCUMENT_STORE_KINDS)[number];

export interface RepositoryStateOptions {
  readonly projectRoot: string;
  readonly statePath?: string;
  readonly runtimePath?: string;
  readonly tracking?: ProjectTracking;
  readonly now?: () => Date;
  readonly lockLeaseMs?: number;
  readonly claimLeaseMs?: number;
  readonly owner?: string;
}

export interface WriteOptions {
  readonly expectedRevision?: number;
  readonly expectedHash?: string;
}

export interface StoredRecord<T> {
  readonly document: T;
  readonly hash: string;
  readonly path: string;
  readonly revision?: number;
}

export interface MutationScope {
  readonly paths: readonly string[];
  readonly resources: readonly string[];
}

export interface ClaimRecord {
  readonly schemaVersion: 1;
  readonly id: RuntimeId;
  readonly taskId: RuntimeId;
  readonly runId: RuntimeId;
  readonly agentId: ModuleId;
  readonly scope: MutationScope;
  readonly claimedAt: string;
  readonly expiresAt: string;
  readonly exclusive: boolean;
  readonly revision: number;
}

export interface CreateClaimInput {
  readonly taskId: RuntimeId;
  readonly runId: RuntimeId;
  readonly agentId: ModuleId;
  readonly scope: MutationScope;
  readonly exclusive?: boolean;
  readonly leaseMs?: number;
  readonly id?: RuntimeId;
}

export interface RenewClaimOptions {
  readonly expectedRevision?: number;
  readonly leaseMs?: number;
}

export interface LockRecord {
  readonly name: string;
  readonly owner: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly leaseMs: number;
}

export interface EventFilter {
  readonly from?: string;
  readonly to?: string;
  readonly type?: string;
  readonly taskId?: RuntimeId;
  readonly runId?: RuntimeId;
}

export interface StatePaths {
  readonly root: string;
  readonly state: string;
  readonly runtime: string;
  readonly tasks: string;
  readonly results: string;
  readonly decisions: string;
  readonly approvals: string;
  readonly verifications: string;
  readonly events: string;
  readonly claims: string;
  readonly locks: string;
}

export interface AtomicWriteOptions {
  /** Invoked after the temp file is durable and before rename. Throw to simulate a crash. */
  readonly afterWriteBeforeRename?: (tempPath: string, targetPath: string) => void;
}

export type DocumentByKind = {
  task: TaskDocument;
  result: ResultDocument;
  decision: DecisionDocument;
  approval: ApprovalDocument;
  verification: VerificationDocument;
};

export type TrackingKind = keyof ProjectTracking;

export interface TrackingLayout {
  readonly tracking: ProjectTracking;
  readonly ignoredKinds: readonly StateRecordKind[];
  readonly gitKinds: readonly StateRecordKind[];
  readonly ephemeralKinds: readonly StateRecordKind[];
}

export type { EventDocument, ProjectTracking, TrackingMode };
