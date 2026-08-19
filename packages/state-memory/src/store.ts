import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { scanMemoryContent } from "./scan.js";
import { openSqliteDatabase, type SqliteDatabase } from "./sqlite.js";
import {
  DEFAULT_DB_RELATIVE_PATH,
  DEFAULT_NOTES_LIMIT,
  DEFAULT_PREFERENCES_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  isMemoryTarget,
  type MemoryEntry,
  type MemoryForgetResult,
  type MemoryStore,
  type MemoryTarget,
  type MemoryWriteResult,
} from "./types.js";

const SNAPSHOT_SEPARATOR = " § ";

interface StoreOptions {
  projectRoot: string;
  dbPath?: string;
  notesLimit?: number;
  preferencesLimit?: number;
}

export function createMemoryStore(options: StoreOptions): MemoryStore {
  const projectRoot = path.resolve(options.projectRoot);
  const dbPath = resolveDbPath(projectRoot, options.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = openSqliteDatabase(dbPath);
  const ftsEnabled = initializeSchema(db);
  const notesLimit = positiveInt(options.notesLimit, DEFAULT_NOTES_LIMIT);
  const preferencesLimit = positiveInt(options.preferencesLimit, DEFAULT_PREFERENCES_LIMIT);

  return new SqliteMemoryStore(db, dbPath, { notesLimit, preferencesLimit }, ftsEnabled);
}

function resolveDbPath(projectRoot: string, dbPath?: string): string {
  if (dbPath === undefined || dbPath.trim() === "") {
    return path.resolve(projectRoot, DEFAULT_DB_RELATIVE_PATH);
  }
  if (dbPath.includes("\0")) {
    throw new Error("dbPath must not contain a null byte");
  }
  return path.isAbsolute(dbPath) ? path.resolve(dbPath) : path.resolve(projectRoot, dbPath);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function initializeSchema(db: SqliteDatabase): boolean {
  db.exec("PRAGMA busy_timeout = 5000;");
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Some SQLite builds reject WAL (e.g. pure in-memory). File DBs still work.
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL CHECK (target IN ('notes', 'preferences', 'journal')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_entries_target ON memory_entries(target);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        target,
        content,
        tokenize = 'unicode61'
      );
    `);
    return true;
  } catch {
    return false;
  }
}

class SqliteMemoryStore implements MemoryStore {
  private closed = false;

  constructor(
    private readonly db: SqliteDatabase,
    readonly dbPath: string,
    private readonly limits: { notesLimit: number; preferencesLimit: number },
    private readonly ftsEnabled: boolean,
  ) {}

  store(input: { target: MemoryTarget; content: string }): MemoryWriteResult {
    this.assertOpen();
    if (!isMemoryTarget(input.target)) {
      return { ok: false, error: `invalid memory target: ${String(input.target)}` };
    }
    const content = normalizeContent(input.content);
    if (content === undefined) {
      return { ok: false, error: "content must be a non-empty string" };
    }
    const scanned = scanMemoryContent(content);
    if (!scanned.ok) {
      return scanned;
    }
    const existing = this.findExact(input.target, content);
    if (existing !== undefined) {
      return { ok: true, entry: existing };
    }
    const budget = this.checkBudget(input.target, content.length, 0);
    if (budget !== undefined) {
      return { ok: false, error: budget };
    }
    const now = nowIso();
    const entry: MemoryEntry = {
      id: randomUUID(),
      target: input.target,
      content,
      createdAt: now,
      updatedAt: now,
    };
    this.insert(entry);
    return { ok: true, entry };
  }

  get(id: string): MemoryEntry | undefined {
    this.assertOpen();
    if (typeof id !== "string" || id.length === 0) {
      return undefined;
    }
    const row = this.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id);
    return row === undefined ? undefined : toEntry(row);
  }

  search(query: string, options?: { target?: MemoryTarget; limit?: number }): MemoryEntry[] {
    this.assertOpen();
    const limit = clampLimit(options?.limit);
    const target = options?.target;
    if (target !== undefined && !isMemoryTarget(target)) {
      return [];
    }
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (trimmed === "") {
      return this.listRecent(target, limit);
    }
    if (this.ftsEnabled) {
      const ftsQuery = toFtsQuery(trimmed);
      if (ftsQuery !== undefined) {
        try {
          return this.searchFts(ftsQuery, target, limit);
        } catch {
          // Fall through to LIKE if the MATCH query is rejected.
        }
      }
    }
    return this.searchLike(trimmed, target, limit);
  }

  replace(input: {
    id?: string;
    oldText?: string;
    content: string;
    target?: MemoryTarget;
  }): MemoryWriteResult {
    this.assertOpen();
    const content = normalizeContent(input.content);
    if (content === undefined) {
      return { ok: false, error: "content must be a non-empty string" };
    }
    const scanned = scanMemoryContent(content);
    if (!scanned.ok) {
      return scanned;
    }
    const located = this.locate(input);
    if (!located.ok) {
      return located;
    }
    const current = located.entry;
    if (current.content === content) {
      return { ok: true, entry: current };
    }
    const budget = this.checkBudget(current.target, content.length, current.content.length);
    if (budget !== undefined) {
      return { ok: false, error: budget };
    }
    const updated: MemoryEntry = {
      ...current,
      content,
      updatedAt: nowIso(),
    };
    this.db.prepare(
      "UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?",
    ).run(updated.content, updated.updatedAt, updated.id);
    this.syncFts("update", updated);
    return { ok: true, entry: updated };
  }

  forget(input: { id?: string; oldText?: string; target?: MemoryTarget }): MemoryForgetResult {
    this.assertOpen();
    const located = this.locateAll(input);
    if (!located.ok) {
      return located;
    }
    const removed: MemoryEntry[] = [];
    for (const entry of located.entries) {
      this.db.prepare("DELETE FROM memory_entries WHERE id = ?").run(entry.id);
      this.syncFts("delete", entry);
      removed.push(entry);
    }
    return { ok: true, removed };
  }

  snapshot(options?: { includeJournal?: boolean }): string {
    this.assertOpen();
    const sections = [
      this.snapshotSection("notes", this.limits.notesLimit),
      this.snapshotSection("preferences", this.limits.preferencesLimit),
    ];
    if (options?.includeJournal === true) {
      sections.push(this.snapshotSection("journal"));
    }
    return sections.join("\n");
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("MemoryStore is closed");
    }
  }

  private snapshotSection(target: MemoryTarget, limit?: number): string {
    const entries = this.listByTarget(target);
    const used = totalChars(entries);
    const header =
      limit === undefined
        ? `MEMORY ${target}`
        : `MEMORY ${target} [${Math.round((used / limit) * 100)}% — ${used}/${limit}]`;
    if (entries.length === 0) {
      return header;
    }
    return `${header}\n${entries.map((entry) => entry.content).join(SNAPSHOT_SEPARATOR)}`;
  }

  private listByTarget(target: MemoryTarget): MemoryEntry[] {
    return this.db
      .prepare(
        "SELECT * FROM memory_entries WHERE target = ? ORDER BY created_at ASC, id ASC",
      )
      .all(target)
      .map(toEntry)
      .filter((entry): entry is MemoryEntry => entry !== undefined);
  }

  private listRecent(target: MemoryTarget | undefined, limit: number): MemoryEntry[] {
    const sql =
      target === undefined
        ? "SELECT * FROM memory_entries ORDER BY updated_at DESC, id DESC LIMIT ?"
        : "SELECT * FROM memory_entries WHERE target = ? ORDER BY updated_at DESC, id DESC LIMIT ?";
    const rows =
      target === undefined
        ? this.db.prepare(sql).all(limit)
        : this.db.prepare(sql).all(target, limit);
    return rows.map(toEntry).filter((entry): entry is MemoryEntry => entry !== undefined);
  }

  private findExact(target: MemoryTarget, content: string): MemoryEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM memory_entries WHERE target = ? AND content = ? LIMIT 1")
      .get(target, content);
    return row === undefined ? undefined : toEntry(row);
  }

  private usage(target: MemoryTarget): number {
    return totalChars(this.listByTarget(target));
  }

  private checkBudget(target: MemoryTarget, incoming: number, replacing: number): string | undefined {
    const limit = target === "notes" ? this.limits.notesLimit : target === "preferences" ? this.limits.preferencesLimit : undefined;
    if (limit === undefined) {
      return undefined;
    }
    const used = this.usage(target);
    const next = used - replacing + incoming;
    if (next <= limit) {
      return undefined;
    }
    const remaining = Math.max(0, limit - used);
    return `${target} budget exceeded: current usage ${used}/${limit} (${remaining} remaining); this write is ${incoming} characters and would total ${next}.`;
  }

  private insert(entry: MemoryEntry): void {
    this.db
      .prepare(
        "INSERT INTO memory_entries (id, target, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(entry.id, entry.target, entry.content, entry.createdAt, entry.updatedAt);
    this.syncFts("insert", entry);
  }

  private syncFts(op: "insert" | "update" | "delete", entry: MemoryEntry): void {
    if (!this.ftsEnabled) {
      return;
    }
    try {
      if (op === "delete" || op === "update") {
        this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(entry.id);
      }
      if (op === "insert" || op === "update") {
        this.db
          .prepare("INSERT INTO memory_fts (id, target, content) VALUES (?, ?, ?)")
          .run(entry.id, entry.target, entry.content);
      }
    } catch {
      // Search can fall back to LIKE if the FTS index is unavailable.
    }
  }

  private searchFts(ftsQuery: string, target: MemoryTarget | undefined, limit: number): MemoryEntry[] {
    const sql =
      target === undefined
        ? `SELECT e.* FROM memory_fts f
           JOIN memory_entries e ON e.id = f.id
           WHERE memory_fts MATCH ?
           ORDER BY bm25(memory_fts)
           LIMIT ?`
        : `SELECT e.* FROM memory_fts f
           JOIN memory_entries e ON e.id = f.id
           WHERE memory_fts MATCH ? AND e.target = ?
           ORDER BY bm25(memory_fts)
           LIMIT ?`;
    const rows =
      target === undefined
        ? this.db.prepare(sql).all(ftsQuery, limit)
        : this.db.prepare(sql).all(ftsQuery, target, limit);
    return rows.map(toEntry).filter((entry): entry is MemoryEntry => entry !== undefined);
  }

  private searchLike(query: string, target: MemoryTarget | undefined, limit: number): MemoryEntry[] {
    const needle = `%${escapeLike(query)}%`;
    const sql =
      target === undefined
        ? `SELECT * FROM memory_entries
           WHERE content LIKE ? ESCAPE '\\'
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`
        : `SELECT * FROM memory_entries
           WHERE content LIKE ? ESCAPE '\\' AND target = ?
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`;
    const rows =
      target === undefined
        ? this.db.prepare(sql).all(needle, limit)
        : this.db.prepare(sql).all(needle, target, limit);
    return rows.map(toEntry).filter((entry): entry is MemoryEntry => entry !== undefined);
  }

  private locate(input: {
    id?: string;
    oldText?: string;
    target?: MemoryTarget;
  }): { ok: true; entry: MemoryEntry } | { ok: false; error: string } {
    const matches = this.locateAll(input);
    if (!matches.ok) {
      return matches;
    }
    if (matches.entries.length !== 1) {
      return {
        ok: false,
        error: `oldText matched ${matches.entries.length} entries; provide id or a more specific oldText`,
      };
    }
    const entry = matches.entries[0];
    if (entry === undefined) {
      return { ok: false, error: "memory entry not found" };
    }
    return { ok: true, entry };
  }

  private locateAll(input: {
    id?: string;
    oldText?: string;
    target?: MemoryTarget;
  }): { ok: true; entries: MemoryEntry[] } | { ok: false; error: string } {
    if (input.target !== undefined && !isMemoryTarget(input.target)) {
      return { ok: false, error: `invalid memory target: ${String(input.target)}` };
    }
    if (typeof input.id === "string" && input.id.length > 0) {
      const entry = this.get(input.id);
      if (entry === undefined) {
        return { ok: false, error: `memory entry not found: ${input.id}` };
      }
      if (input.target !== undefined && entry.target !== input.target) {
        return { ok: false, error: `memory entry ${input.id} is not in target ${input.target}` };
      }
      return { ok: true, entries: [entry] };
    }
    const oldText = typeof input.oldText === "string" ? input.oldText : "";
    if (oldText.length === 0) {
      return { ok: false, error: "id or oldText is required" };
    }
    const sql =
      input.target === undefined
        ? "SELECT * FROM memory_entries WHERE instr(content, ?) > 0 ORDER BY updated_at DESC, id DESC"
        : "SELECT * FROM memory_entries WHERE instr(content, ?) > 0 AND target = ? ORDER BY updated_at DESC, id DESC";
    const rows =
      input.target === undefined
        ? this.db.prepare(sql).all(oldText)
        : this.db.prepare(sql).all(oldText, input.target);
    const entries = rows.map(toEntry).filter((entry): entry is MemoryEntry => entry !== undefined);
    if (entries.length === 0) {
      return { ok: false, error: "memory entry not found for oldText" };
    }
    const exact = entries.filter((entry) => entry.content === oldText);
    return { ok: true, entries: exact.length > 0 ? exact : entries };
  }
}

function normalizeContent(content: unknown): string | undefined {
  if (typeof content !== "string") {
    return undefined;
  }
  const trimmed = content.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.min(Math.floor(limit), 100);
}

function totalChars(entries: readonly MemoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.content.length, 0);
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function toFtsQuery(query: string): string | undefined {
  const tokens = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replace(/"/g, '""')}"`);
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.join(" AND ");
}

function toEntry(row: Record<string, unknown> | undefined): MemoryEntry | undefined {
  if (row === undefined) {
    return undefined;
  }
  const id = row.id;
  const target = row.target;
  const content = row.content;
  const createdAt = row.created_at ?? row.createdAt;
  const updatedAt = row.updated_at ?? row.updatedAt;
  if (
    typeof id !== "string" ||
    !isMemoryTarget(target) ||
    typeof content !== "string" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return undefined;
  }
  return { id, target, content, createdAt, updatedAt };
}
