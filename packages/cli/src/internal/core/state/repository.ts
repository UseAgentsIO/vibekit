import crypto from "node:crypto";

import { cleanupPartialWrites } from "./atomic.js";
import {
  DEFAULT_CLAIM_LEASE_MS,
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_RUNTIME_RELATIVE_PATH,
  DEFAULT_STATE_RELATIVE_PATH,
  STATE_BACKEND_ID,
} from "./constants.js";
import { createClaimStore, type ClaimStore } from "./claims.js";
import { createEventLog, type EventLog } from "./events.js";
import { LockManager } from "./locks.js";
import { createDocumentStore, type DocumentStore } from "./store.js";
import {
  applyTrackingLayout,
  classifyTracking,
  normalizeTracking,
  resolveStatePaths,
} from "./tracking.js";
import type {
  RepositoryStateOptions,
  StatePaths,
  TrackingLayout,
} from "./types.js";

export class RepositoryState {
  readonly backend = STATE_BACKEND_ID;
  readonly projectRoot: string;
  readonly owner: string;
  readonly paths: StatePaths;
  readonly tracking: TrackingLayout;
  readonly locks: LockManager;
  readonly tasks: DocumentStore<"task">;
  readonly results: DocumentStore<"result">;
  readonly decisions: DocumentStore<"decision">;
  readonly approvals: DocumentStore<"approval">;
  readonly verifications: DocumentStore<"verification">;
  readonly events: EventLog;
  readonly claims: ClaimStore;

  private readonly now: () => Date;
  private opened = false;

  constructor(options: RepositoryStateOptions) {
    this.projectRoot = options.projectRoot;
    this.now = options.now ?? (() => new Date());
    this.owner = options.owner ?? `repository:${process.pid}:${crypto.randomUUID()}`;
    const tracking = normalizeTracking(options.tracking);
    this.tracking = classifyTracking(tracking);
    this.paths = resolveStatePaths({
      projectRoot: options.projectRoot,
      statePath: options.statePath ?? DEFAULT_STATE_RELATIVE_PATH,
      runtimePath: options.runtimePath ?? DEFAULT_RUNTIME_RELATIVE_PATH,
      tracking,
    });
    this.locks = new LockManager(
      this.paths.locks,
      this.now,
      options.lockLeaseMs ?? DEFAULT_LOCK_LEASE_MS,
    );
    this.tasks = createDocumentStore({
      kind: "task",
      directory: this.paths.tasks,
      locks: this.locks,
      owner: this.owner,
    });
    this.results = createDocumentStore({
      kind: "result",
      directory: this.paths.results,
      locks: this.locks,
      owner: this.owner,
    });
    this.decisions = createDocumentStore({
      kind: "decision",
      directory: this.paths.decisions,
      locks: this.locks,
      owner: this.owner,
    });
    this.approvals = createDocumentStore({
      kind: "approval",
      directory: this.paths.approvals,
      locks: this.locks,
      owner: this.owner,
    });
    this.verifications = createDocumentStore({
      kind: "verification",
      directory: this.paths.verifications,
      locks: this.locks,
      owner: this.owner,
    });
    this.events = createEventLog({
      directory: this.paths.events,
      locks: this.locks,
      owner: this.owner,
    });
    this.claims = createClaimStore({
      directory: this.paths.claims,
      locks: this.locks,
      owner: this.owner,
      now: this.now,
      defaultLeaseMs: options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS,
    });
  }

  open(): this {
    applyTrackingLayout(this.paths, this.tracking);
    cleanupPartialWrites(this.paths.state);
    cleanupPartialWrites(this.paths.runtime);
    this.locks.recoverStale();
    this.claims.recoverStale();
    this.opened = true;
    return this;
  }

  close(): void {
    for (const lock of this.locks.list()) {
      if (lock.owner === this.owner) {
        this.locks.release(lock.name, this.owner);
      }
    }
    this.opened = false;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  recoverStale(): { locks: number; claims: number; partialWrites: string[] } {
    const partialWrites = [
      ...cleanupPartialWrites(this.paths.state),
      ...cleanupPartialWrites(this.paths.runtime),
    ];
    return {
      locks: this.locks.recoverStale().length,
      claims: this.claims.recoverStale().length,
      partialWrites,
    };
  }
}

export function createRepositoryState(options: RepositoryStateOptions): RepositoryState {
  return new RepositoryState(options).open();
}
