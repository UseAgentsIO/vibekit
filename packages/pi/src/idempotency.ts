import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { type RuntimeId } from "@vibekit/core";

import { fail } from "./fail.js";

export interface IdempotencyRecord {
  readonly key: string;
  readonly taskId: RuntimeId;
  readonly runId: RuntimeId | null;
  readonly createdAt: string;
  readonly status: "reserved" | "completed";
}

export interface IdempotencyStore {
  readonly directory: string;
  lookup(key: string): IdempotencyRecord | undefined;
  begin(key: string, taskId: RuntimeId, runId?: RuntimeId | null): {
    readonly record: IdempotencyRecord;
    readonly created: boolean;
  };
  complete(key: string, runId: RuntimeId): IdempotencyRecord;
}

export function idempotencyFileName(key: string): string {
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return `${digest}.json`;
}

export function createIdempotencyStore(options: {
  directory: string;
  now?: () => Date;
}): IdempotencyStore {
  return new FileIdempotencyStore(options.directory, options.now ?? (() => new Date()));
}

class FileIdempotencyStore implements IdempotencyStore {
  readonly directory: string;
  private readonly now: () => Date;

  constructor(directory: string, now: () => Date) {
    this.directory = directory;
    this.now = now;
  }

  lookup(key: string): IdempotencyRecord | undefined {
    assertKey(key);
    const filePath = this.pathFor(key);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return readRecord(filePath);
  }

  begin(
    key: string,
    taskId: RuntimeId,
    runId: RuntimeId | null = null,
  ): { record: IdempotencyRecord; created: boolean } {
    assertKey(key);
    fs.mkdirSync(this.directory, { recursive: true });
    const existing = this.lookup(key);
    if (existing !== undefined) {
      return { record: existing, created: false };
    }
    const record: IdempotencyRecord = {
      key,
      taskId,
      runId,
      createdAt: this.now().toISOString(),
      status: "reserved",
    };
    const filePath = this.pathFor(key);
    try {
      fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const raced = this.lookup(key);
        if (raced !== undefined) {
          return { record: raced, created: false };
        }
      }
      throw error;
    }
    return { record, created: true };
  }

  complete(key: string, runId: RuntimeId): IdempotencyRecord {
    const current = this.lookup(key);
    if (current === undefined) {
      throw fail("invalid_input", "idempotency_missing", `Idempotency key is not reserved`, {
        key,
      });
    }
    const next: IdempotencyRecord = {
      ...current,
      runId,
      status: "completed",
    };
    fs.writeFileSync(this.pathFor(key), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  private pathFor(key: string): string {
    return path.join(this.directory, idempotencyFileName(key));
  }
}

function assertKey(key: string): void {
  if (key.trim().length === 0) {
    throw fail("invalid_input", "idempotency_key_empty", "Idempotency key must be non-empty");
  }
}

function readRecord(filePath: string): IdempotencyRecord {
  const raw = fs.readFileSync(filePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw fail("invalid_input", "idempotency_corrupt", "Idempotency record is not valid JSON", {
      path: filePath,
    });
  }
  if (data === null || typeof data !== "object") {
    throw fail("invalid_input", "idempotency_corrupt", "Idempotency record is not an object", {
      path: filePath,
    });
  }
  const value = data as Record<string, unknown>;
  if (typeof value.key !== "string" || typeof value.taskId !== "string") {
    throw fail("invalid_input", "idempotency_corrupt", "Idempotency record is missing fields", {
      path: filePath,
    });
  }
  const runId = value.runId === null || value.runId === undefined ? null : String(value.runId);
  const status = value.status === "completed" ? "completed" : "reserved";
  return {
    key: value.key,
    taskId: value.taskId as RuntimeId,
    runId: runId as RuntimeId | null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    status,
  };
}
