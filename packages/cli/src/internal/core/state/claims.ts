import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";
import { assertModuleId, assertRuntimeIdOf, formatRuntimeId } from "../ids.js";
import type { RuntimeId } from "../ids.js";

import { atomicWriteFile, contentHash, serializeJson } from "./atomic.js";
import { DEFAULT_CLAIM_LEASE_MS } from "./constants.js";
import { stateError } from "./errors.js";
import type { LockManager } from "./locks.js";
import type { ClaimRecord, CreateClaimInput, RenewClaimOptions, WriteOptions } from "./types.js";

export interface ClaimStore {
  readonly directory: string;
  create(input: CreateClaimInput): ClaimRecord;
  get(id: RuntimeId): ClaimRecord;
  tryGet(id: RuntimeId): ClaimRecord | undefined;
  list(): ClaimRecord[];
  listActive(taskId?: RuntimeId): ClaimRecord[];
  getActiveForTask(taskId: RuntimeId): ClaimRecord | undefined;
  release(id: RuntimeId): void;
  renew(id: RuntimeId, options?: RenewClaimOptions): ClaimRecord;
  recoverStale(): ClaimRecord[];
}

export function createClaimStore(options: {
  directory: string;
  locks: LockManager;
  owner: string;
  now: () => Date;
  defaultLeaseMs: number;
}): ClaimStore {
  return new FileClaimStore(options);
}

class FileClaimStore implements ClaimStore {
  readonly directory: string;
  private readonly locks: LockManager;
  private readonly owner: string;
  private readonly now: () => Date;
  private readonly defaultLeaseMs: number;

  constructor(options: {
    directory: string;
    locks: LockManager;
    owner: string;
    now: () => Date;
    defaultLeaseMs: number;
  }) {
    this.directory = options.directory;
    this.locks = options.locks;
    this.owner = options.owner;
    this.now = options.now;
    this.defaultLeaseMs = options.defaultLeaseMs;
  }

  create(input: CreateClaimInput): ClaimRecord {
    assertRuntimeIdOf("task", input.taskId);
    assertRuntimeIdOf("run", input.runId);
    assertModuleId(input.agentId);
    const id = input.id ?? formatRuntimeId("claim", crypto.randomUUID());
    assertRuntimeIdOf("claim", id);
    const exclusive = input.exclusive ?? true;
    const leaseMs = input.leaseMs ?? this.defaultLeaseMs;
    return this.withTaskLock(input.taskId, () => {
      this.recoverTask(input.taskId);
      this.assertClaimSlot(input.taskId, exclusive);
      const claimedAt = this.now();
      const record: ClaimRecord = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id,
        taskId: input.taskId,
        runId: input.runId,
        agentId: input.agentId,
        scope: {
          paths: [...input.scope.paths],
          resources: [...input.scope.resources],
        },
        claimedAt: claimedAt.toISOString(),
        expiresAt: new Date(claimedAt.getTime() + leaseMs).toISOString(),
        exclusive,
        revision: 1,
      };
      this.write(record);
      return record;
    });
  }

  get(id: RuntimeId): ClaimRecord {
    const record = this.tryGet(id);
    if (record === undefined) {
      stateError("invalid_input", "state_claim_not_found", `Claim ${String(id)} not found`, {
        id,
      });
    }
    return record;
  }

  tryGet(id: RuntimeId): ClaimRecord | undefined {
    assertRuntimeIdOf("claim", id);
    const filePath = this.pathFor(id);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return this.readFile(filePath);
  }

  list(): ClaimRecord[] {
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    const records: ClaimRecord[] = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) {
        continue;
      }
      records.push(this.readFile(path.join(this.directory, entry.name)));
    }
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  listActive(taskId?: RuntimeId): ClaimRecord[] {
    const at = this.now().getTime();
    return this.list().filter((claim) => {
      if (taskId && claim.taskId !== taskId) {
        return false;
      }
      return Date.parse(claim.expiresAt) > at;
    });
  }

  getActiveForTask(taskId: RuntimeId): ClaimRecord | undefined {
    return this.listActive(taskId)[0];
  }

  release(id: RuntimeId): void {
    const claim = this.get(id);
    this.withTaskLock(claim.taskId, () => {
      this.remove(id);
    });
  }

  renew(id: RuntimeId, options: RenewClaimOptions = {}): ClaimRecord {
    const current = this.get(id);
    return this.withTaskLock(current.taskId, () => {
      const latest = this.get(id);
      if (this.isExpired(latest)) {
        stateError("conflict", "state_claim_expired", `Claim ${id} has expired`, {
          id,
          expiresAt: latest.expiresAt,
        });
      }
      this.assertExpected(latest, { expectedRevision: options.expectedRevision });
      const leaseMs = options.leaseMs ?? this.defaultLeaseMs;
      const next: ClaimRecord = {
        ...latest,
        expiresAt: new Date(this.now().getTime() + leaseMs).toISOString(),
        revision: latest.revision + 1,
      };
      this.write(next);
      return next;
    });
  }

  recoverStale(): ClaimRecord[] {
    const recovered: ClaimRecord[] = [];
    for (const claim of this.list()) {
      if (!this.isExpired(claim)) {
        continue;
      }
      this.remove(claim.id);
      recovered.push(claim);
    }
    return recovered.sort((left, right) => left.id.localeCompare(right.id));
  }

  private recoverTask(taskId: RuntimeId): void {
    for (const claim of this.list().filter((item) => item.taskId === taskId)) {
      if (this.isExpired(claim)) {
        this.remove(claim.id);
      }
    }
  }

  private assertClaimSlot(taskId: RuntimeId, exclusive: boolean): void {
    const active = this.listActive(taskId);
    if (active.length === 0) {
      return;
    }
    const blocking = exclusive || active.some((claim) => claim.exclusive);
    if (blocking) {
      const held = active[0];
      stateError(
        "conflict",
        "state_claim_held",
        `Task ${taskId} already has an active claim`,
        {
          taskId,
          claimId: held?.id,
          expiresAt: held?.expiresAt,
        },
      );
    }
  }

  private assertExpected(current: ClaimRecord, options: WriteOptions): void {
    if (options.expectedRevision === undefined) {
      return;
    }
    if (options.expectedRevision !== current.revision) {
      stateError(
        "conflict",
        "state_revision_conflict",
        `Stale claim write: expected revision ${options.expectedRevision}, found ${current.revision}`,
        {
          id: current.id,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
        },
      );
    }
  }

  private withTaskLock<T>(taskId: RuntimeId, fn: () => T): T {
    const lockName = `claims:${taskId}`;
    this.locks.acquire(lockName, this.owner);
    try {
      return fn();
    } finally {
      this.locks.release(lockName, this.owner);
    }
  }

  private pathFor(id: RuntimeId): string {
    return path.join(this.directory, `${id}.json`);
  }

  private write(record: ClaimRecord): void {
    atomicWriteFile(this.pathFor(record.id), serializeJson(record));
  }

  private readFile(filePath: string): ClaimRecord {
    const raw = fs.readFileSync(filePath, "utf8");
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      stateError("invalid_input", "state_claim_corrupt", "Claim file is not valid JSON", {
        path: filePath,
        hash: contentHash(raw),
      });
    }
    return parseClaimRecord(data, filePath);
  }

  private remove(id: RuntimeId): void {
    try {
      fs.unlinkSync(this.pathFor(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private isExpired(claim: ClaimRecord, at: Date = this.now()): boolean {
    return Date.parse(claim.expiresAt) <= at.getTime();
  }
}

function parseClaimRecord(data: unknown, filePath: string): ClaimRecord {
  if (data === null || typeof data !== "object") {
    stateError("invalid_input", "state_claim_corrupt", "Claim file is not an object", {
      path: filePath,
    });
  }
  const value = data as Record<string, unknown>;
  if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    stateError("invalid_input", "state_claim_corrupt", "Claim schemaVersion is invalid", {
      path: filePath,
      schemaVersion: value.schemaVersion,
    });
  }
  if (typeof value.id !== "string") {
    stateError("invalid_input", "state_claim_corrupt", "Claim id is required", { path: filePath });
  }
  assertRuntimeIdOf("claim", value.id);
  if (typeof value.taskId !== "string") {
    stateError("invalid_input", "state_claim_corrupt", "Claim taskId is required", {
      path: filePath,
    });
  }
  assertRuntimeIdOf("task", value.taskId);
  if (typeof value.runId !== "string") {
    stateError("invalid_input", "state_claim_corrupt", "Claim runId is required", {
      path: filePath,
    });
  }
  assertRuntimeIdOf("run", value.runId);
  if (typeof value.agentId !== "string") {
    stateError("invalid_input", "state_claim_corrupt", "Claim agentId is required", {
      path: filePath,
    });
  }
  assertModuleId(value.agentId);
  const scope = value.scope;
  if (scope === null || typeof scope !== "object") {
    stateError("invalid_input", "state_claim_corrupt", "Claim scope is required", {
      path: filePath,
    });
  }
  const scopeValue = scope as { paths?: unknown; resources?: unknown };
  if (!Array.isArray(scopeValue.paths) || !Array.isArray(scopeValue.resources)) {
    stateError("invalid_input", "state_claim_corrupt", "Claim scope must include paths and resources", {
      path: filePath,
    });
  }
  if (typeof value.claimedAt !== "string" || Number.isNaN(Date.parse(value.claimedAt))) {
    stateError("invalid_input", "state_claim_corrupt", "Claim claimedAt is invalid", {
      path: filePath,
    });
  }
  if (typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))) {
    stateError("invalid_input", "state_claim_corrupt", "Claim expiresAt is invalid", {
      path: filePath,
    });
  }
  if (typeof value.exclusive !== "boolean") {
    stateError("invalid_input", "state_claim_corrupt", "Claim exclusive must be a boolean", {
      path: filePath,
    });
  }
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 1) {
    stateError("invalid_input", "state_claim_corrupt", "Claim revision must be an integer >= 1", {
      path: filePath,
    });
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: value.id,
    taskId: value.taskId,
    runId: value.runId,
    agentId: value.agentId,
    scope: {
      paths: scopeValue.paths.filter((item): item is string => typeof item === "string"),
      resources: scopeValue.resources.filter((item): item is string => typeof item === "string"),
    },
    claimedAt: value.claimedAt,
    expiresAt: value.expiresAt,
    exclusive: value.exclusive,
    revision: value.revision,
  };
}

export { DEFAULT_CLAIM_LEASE_MS };
