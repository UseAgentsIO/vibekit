import fs from "node:fs";
import path from "node:path";

import { atomicWriteFile, serializeJson } from "./atomic.js";
import { DEFAULT_LOCK_LEASE_MS } from "./constants.js";
import { stateError } from "./errors.js";
import type { LockRecord } from "./types.js";

function lockFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "__");
  return `${safe}.lock`;
}

function parseLock(raw: string, filePath: string): LockRecord {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    stateError("internal_error", "state_lock_corrupt", "Lock file is not valid JSON", {
      path: filePath,
    });
  }
  if (data === null || typeof data !== "object") {
    stateError("internal_error", "state_lock_corrupt", "Lock file is not an object", {
      path: filePath,
    });
  }
  const record = data as Partial<LockRecord>;
  if (
    typeof record.name !== "string" ||
    typeof record.owner !== "string" ||
    typeof record.acquiredAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.leaseMs !== "number"
  ) {
    stateError("internal_error", "state_lock_corrupt", "Lock file is missing required fields", {
      path: filePath,
    });
  }
  return {
    name: record.name,
    owner: record.owner,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
    leaseMs: record.leaseMs,
  };
}

export class LockManager {
  readonly directory: string;

  constructor(
    directory: string,
    private readonly now: () => Date,
    private readonly defaultLeaseMs: number = DEFAULT_LOCK_LEASE_MS,
  ) {
    this.directory = directory;
  }

  pathFor(name: string): string {
    return path.join(this.directory, lockFileName(name));
  }

  isExpired(lock: LockRecord, at: Date = this.now()): boolean {
    return Date.parse(lock.expiresAt) <= at.getTime();
  }

  tryRead(name: string): LockRecord | undefined {
    const filePath = this.pathFor(name);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return parseLock(fs.readFileSync(filePath, "utf8"), filePath);
  }

  list(): LockRecord[] {
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    const locks: LockRecord[] = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".lock")) {
        continue;
      }
      const filePath = path.join(this.directory, entry.name);
      locks.push(parseLock(fs.readFileSync(filePath, "utf8"), filePath));
    }
    return locks.sort((left, right) => left.name.localeCompare(right.name));
  }

  recoverStale(at: Date = this.now()): LockRecord[] {
    const recovered: LockRecord[] = [];
    for (const lock of this.list()) {
      if (!this.isExpired(lock, at)) {
        continue;
      }
      this.forceRemove(lock.name);
      recovered.push(lock);
    }
    return recovered;
  }

  acquire(name: string, owner: string, leaseMs: number = this.defaultLeaseMs): LockRecord {
    fs.mkdirSync(this.directory, { recursive: true });
    const existing = this.tryRead(name);
    if (existing) {
      if (this.isExpired(existing)) {
        this.forceRemove(name);
      } else if (existing.owner === owner) {
        return this.write(name, owner, leaseMs);
      } else {
        stateError("resource_busy", "state_lock_held", `State lock "${name}" is held`, {
          name,
          owner: existing.owner,
          expiresAt: existing.expiresAt,
        });
      }
    }
    return this.createExclusive(name, owner, leaseMs);
  }

  release(name: string, owner: string): void {
    const existing = this.tryRead(name);
    if (existing === undefined) {
      return;
    }
    if (existing.owner !== owner && !this.isExpired(existing)) {
      stateError(
        "permission_denied",
        "state_lock_owner_mismatch",
        `State lock "${name}" is owned by another holder`,
        { name, owner: existing.owner, requestedBy: owner },
      );
    }
    this.forceRemove(name);
  }

  private createExclusive(name: string, owner: string, leaseMs: number): LockRecord {
    const filePath = this.pathFor(name);
    const writeExclusive = (): LockRecord => {
      const record = this.buildRecord(name, owner, leaseMs);
      fs.writeFileSync(filePath, serializeJson(record), { flag: "wx" });
      return record;
    };
    try {
      return writeExclusive();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      const raced = this.tryRead(name);
      if (raced && this.isExpired(raced)) {
        this.forceRemove(name);
        return writeExclusive();
      }
      stateError("resource_busy", "state_lock_held", `State lock "${name}" is held`, {
        name,
        owner: raced?.owner,
        expiresAt: raced?.expiresAt,
      });
    }
  }

  private write(name: string, owner: string, leaseMs: number): LockRecord {
    const record = this.buildRecord(name, owner, leaseMs);
    atomicWriteFile(this.pathFor(name), serializeJson(record));
    return record;
  }

  private buildRecord(name: string, owner: string, leaseMs: number): LockRecord {
    const acquiredAt = this.now();
    return {
      name,
      owner,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + leaseMs).toISOString(),
      leaseMs,
    };
  }

  private forceRemove(name: string): void {
    const filePath = this.pathFor(name);
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
