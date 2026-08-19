# @useagentsio/state-memory

Optional VibeKit memory backend: a Project-local SQLite file with FTS5 search, plus the Agent-facing `memory` tool.

This is an installable Component package (`state:memory` / `tool:memory`). It is not a Host feature. A Project that only has `state:repository` must never create a memory database or inject memory context.

## Runtime

Primary engine is Node's built-in `node:sqlite` (`DatabaseSync`). That API ships with **Node.js 22.5+**. On Node 20, install the optional dependency `better-sqlite3` if you need SQLite; otherwise SQLite-backed calls throw a clear error. `session_search` does not require SQLite.

## Store

Default database path: `<projectRoot>/.vibekit/state/memory.sqlite`.

Targets in the same database:

- `notes` — environment and conventions (default budget 2200 characters)
- `preferences` — operator profile (default budget 1375 characters)
- `journal` — dated working notes, indexed but omitted from `snapshot()` unless `includeJournal` is set

Writes persist immediately. `snapshot()` is a point-in-time read for session injection; callers inject it once.

## Safety

`scanMemoryContent` rejects prompt-injection phrasing, credential-looking strings, SSH private key headers, and bidirectional/invisible Unicode. Exact duplicate content in the same target is not stored twice.

Memory is not Project truth. Tasks, Results, Decisions, and Approvals stay on `state:repository`.
