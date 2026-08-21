export const MEMORY_TARGETS = ["notes", "preferences", "journal"] as const;

export type MemoryTarget = (typeof MEMORY_TARGETS)[number];

export const MEMORY_STATE_ID = "state:memory" as const;

export const MEMORY_READ_CAPABILITY = "memory.read";
export const MEMORY_WRITE_CAPABILITY = "memory.write";

export const DEFAULT_DB_RELATIVE_PATH = ".vibekit/state/memory.sqlite";
export const DEFAULT_CONVERSATIONS_DIR = ".vibekit/state/conversations";
export const DEFAULT_NOTES_LIMIT = 2200;
export const DEFAULT_PREFERENCES_LIMIT = 1375;
export const DEFAULT_SEARCH_LIMIT = 20;

export interface MemoryEntry {
  id: string;
  target: MemoryTarget;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry }
  | { ok: false; error: string };

export type MemoryForgetResult =
  | { ok: true; removed: MemoryEntry[] }
  | { ok: false; error: string };

export interface MemoryStore {
  readonly dbPath: string;
  store(input: { target: MemoryTarget; content: string }): MemoryWriteResult;
  get(id: string): MemoryEntry | undefined;
  search(query: string, options?: { target?: MemoryTarget; limit?: number }): MemoryEntry[];
  replace(input: {
    id?: string;
    oldText?: string;
    content: string;
    target?: MemoryTarget;
  }): MemoryWriteResult;
  forget(input: { id?: string; oldText?: string; target?: MemoryTarget }): MemoryForgetResult;
  snapshot(options?: { includeJournal?: boolean }): string;
  close(): void;
}

export function isMemoryTarget(value: unknown): value is MemoryTarget {
  return typeof value === "string" && (MEMORY_TARGETS as readonly string[]).includes(value);
}
