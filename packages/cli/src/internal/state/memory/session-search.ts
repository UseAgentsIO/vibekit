import fs from "node:fs";
import path from "node:path";

import { redactSecretLookingValues } from "./scan.js";

export interface SessionSearchMatch {
  path: string;
  snippet: string;
}

export interface SessionSearchResult {
  ok: true;
  matches: SessionSearchMatch[];
}

const SNIPPET_RADIUS = 160;

export function searchConversationDocuments(
  conversationsDir: string,
  query: string,
  limit = 20,
): SessionSearchResult {
  try {
    return searchConversationDocumentsUnsafe(conversationsDir, query, limit);
  } catch {
    return { ok: true, matches: [] };
  }
}

function searchConversationDocumentsUnsafe(
  conversationsDir: string,
  query: string,
  limit: number,
): SessionSearchResult {
  const needle = typeof query === "string" ? query.trim() : "";
  if (needle.length === 0) {
    return { ok: true, matches: [] };
  }
  if (typeof conversationsDir !== "string" || conversationsDir.length === 0) {
    return { ok: true, matches: [] };
  }
  if (!fs.existsSync(conversationsDir)) {
    return { ok: true, matches: [] };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(conversationsDir);
  } catch {
    return { ok: true, matches: [] };
  }
  if (!stat.isDirectory()) {
    return { ok: true, matches: [] };
  }

  const lowered = needle.toLowerCase();
  const cap = clampSessionLimit(limit);
  const matches: SessionSearchMatch[] = [];
  for (const filePath of walkJsonFiles(conversationsDir)) {
    if (matches.length >= cap) {
      break;
    }
    const match = matchFile(filePath, conversationsDir, lowered);
    if (match !== undefined) {
      matches.push(match);
    }
  }
  return { ok: true, matches };
}

function matchFile(
  filePath: string,
  root: string,
  loweredQuery: string,
): SessionSearchMatch | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const redacted = redactSecretLookingValues(raw);
  const index = redacted.toLowerCase().indexOf(loweredQuery);
  if (index < 0) {
    return undefined;
  }
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(redacted.length, index + loweredQuery.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < redacted.length ? "…" : "";
  return {
    path: path.relative(root, filePath).split(path.sep).join("/"),
    snippet: `${prefix}${redacted.slice(start, end)}${suffix}`,
  };
}

function* walkJsonFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        yield* walkJsonFiles(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        yield full;
      }
    } catch {
      // Skip unreadable entries.
    }
  }
}

function clampSessionLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 20;
  }
  return Math.min(Math.floor(limit), 100);
}
