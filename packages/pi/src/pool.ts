import fs from "node:fs";
import path from "node:path";

import type { RuntimeId } from "@vibekit/core";

import { fail } from "./fail.js";

export interface PoolLease {
  readonly runId: RuntimeId;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface ConcurrencyPool {
  readonly max: number;
  readonly directory?: string;
  active(): number;
  tryAcquire(runId: RuntimeId): PoolLease | undefined;
  acquire(runId: RuntimeId): PoolLease;
  release(runId: RuntimeId): void;
  recoverStale(): PoolLease[];
}

export function createConcurrencyPool(options: {
  max: number;
  directory?: string;
  now?: () => Date;
  leaseMs?: number;
}): ConcurrencyPool {
  if (!Number.isInteger(options.max) || options.max < 1) {
    throw fail(
      "configuration_invalid",
      "pool_max_invalid",
      "maxParallelRuns must be a positive integer",
      { max: options.max },
    );
  }
  return new FileConcurrencyPool(
    options.max,
    options.directory,
    options.now ?? (() => new Date()),
    options.leaseMs ?? 3_600_000,
  );
}

class FileConcurrencyPool implements ConcurrencyPool {
  readonly max: number;
  readonly directory?: string;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly memory = new Map<RuntimeId, PoolLease>();

  constructor(max: number, directory: string | undefined, now: () => Date, leaseMs: number) {
    this.max = max;
    this.directory = directory;
    this.now = now;
    this.leaseMs = leaseMs;
    if (directory !== undefined) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  active(): number {
    this.recoverStale();
    return this.list().length;
  }

  tryAcquire(runId: RuntimeId): PoolLease | undefined {
    this.recoverStale();
    if (this.list().some((slot) => slot.runId === runId)) {
      throw fail("conflict", "pool_run_active", `Run ${runId} already holds a pool slot`, {
        runId,
      });
    }
    if (this.list().length >= this.max) {
      return undefined;
    }
    const acquiredAt = this.now();
    const lease: PoolLease = {
      runId,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + this.leaseMs).toISOString(),
    };
    this.memory.set(runId, lease);
    if (this.directory !== undefined) {
      fs.writeFileSync(this.pathFor(runId), `${JSON.stringify(lease, null, 2)}\n`, "utf8");
    }
    return lease;
  }

  acquire(runId: RuntimeId): PoolLease {
    const lease = this.tryAcquire(runId);
    if (lease === undefined) {
      throw fail(
        "resource_busy",
        "pool_exhausted",
        `Project already has ${this.max} parallel Runs`,
        { max: this.max, runId },
      );
    }
    return lease;
  }

  release(runId: RuntimeId): void {
    this.memory.delete(runId);
    if (this.directory !== undefined) {
      try {
        fs.unlinkSync(this.pathFor(runId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  recoverStale(): PoolLease[] {
    const recovered: PoolLease[] = [];
    const at = this.now().getTime();
    for (const lease of this.list()) {
      if (Date.parse(lease.expiresAt) > at) {
        continue;
      }
      this.release(lease.runId);
      recovered.push(lease);
    }
    return recovered;
  }

  private list(): PoolLease[] {
    if (this.directory === undefined) {
      return [...this.memory.values()];
    }
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    const leases: PoolLease[] = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const raw = fs.readFileSync(path.join(this.directory, entry.name), "utf8");
      try {
        const parsed = JSON.parse(raw) as PoolLease;
        if (typeof parsed.runId === "string") {
          leases.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return leases;
  }

  private pathFor(runId: RuntimeId): string {
    if (this.directory === undefined) {
      throw fail("internal_error", "pool_directory_missing", "Pool has no directory");
    }
    return path.join(this.directory, `${runId}.json`);
  }
}
