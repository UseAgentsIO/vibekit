import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryStore,
  createMemoryTool,
  DEFAULT_DB_RELATIVE_PATH,
  isSqliteAvailable,
  type MemoryStore,
} from "../../packages/state-memory/src/index.js";

import { makeTempDir } from "../helpers.js";

const temps: string[] = [];
const stores: MemoryStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempProject(): string {
  const dir = makeTempDir("vibekit-memory-tool-");
  temps.push(dir);
  return dir;
}

function openStore(projectRoot: string): MemoryStore {
  const store = createMemoryStore({ projectRoot });
  stores.push(store);
  return store;
}

const describeSqlite = isSqliteAvailable() ? describe : describe.skip;

describe("memory tool permissions", () => {
  it("denies mutating actions when grantedCapabilities omits memory.write", async () => {
    const root = tempProject();
    const tool = createMemoryTool({ projectRoot: root });
    const denied = await tool.execute({
      action: "store",
      target: "notes",
      content: "Should not be written.",
      grantedCapabilities: ["memory.read"],
    });
    expect(denied).toEqual({
      ok: false,
      error: "Permission denied: memory.write is not granted",
    });
    expect(fs.existsSync(path.join(root, DEFAULT_DB_RELATIVE_PATH))).toBe(false);
  });

  it("denies replace and forget the same way", async () => {
    const tool = createMemoryTool({ projectRoot: tempProject() });
    const extra = { grantedCapabilities: ["memory.read"] };
    await expect(
      tool.execute({ action: "replace", id: "missing", content: "nope" }, extra),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/memory\.write/) });
    await expect(tool.execute({ action: "forget", id: "missing" }, extra)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/memory\.write/),
    });
  });

  it("allows mutating actions when grantedCapabilities is omitted", async () => {
    if (!isSqliteAvailable()) {
      return;
    }
    const root = tempProject();
    const store = openStore(root);
    const tool = createMemoryTool({ projectRoot: root, store });
    const result = await tool.execute({
      action: "store",
      target: "notes",
      content: "Allowed write.",
    });
    expect(result).toMatchObject({ ok: true, entry: { content: "Allowed write." } });
  });
});

describe("memory tool session_search", () => {
  it("finds text in a fake conversation JSON file", async () => {
    const root = tempProject();
    const conversationsDir = path.join(root, ".vibekit", "state", "conversations");
    fs.mkdirSync(conversationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(conversationsDir, "conversation_demo.json"),
      `${JSON.stringify(
        {
          id: "conversation_demo",
          messages: [{ role: "user", text: "Remember the staging hostname is frost.example" }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const tool = createMemoryTool({ projectRoot: root, conversationsDir });
    const result = await tool.execute({
      action: "session_search",
      query: "frost.example",
    });
    expect(result).toMatchObject({
      ok: true,
      matches: [
        {
          path: "conversation_demo.json",
          snippet: expect.stringContaining("frost.example"),
        },
      ],
    });
    expect(fs.existsSync(path.join(root, DEFAULT_DB_RELATIVE_PATH))).toBe(false);
  });

  it("returns an empty list when the conversations directory is missing", async () => {
    const tool = createMemoryTool({ projectRoot: tempProject() });
    await expect(tool.execute({ action: "session_search", query: "anything" })).resolves.toEqual({
      ok: true,
      matches: [],
    });
  });

  it("redacts secret-looking values in session_search results", async () => {
    const root = tempProject();
    const conversationsDir = path.join(root, ".vibekit", "state", "conversations");
    fs.mkdirSync(conversationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(conversationsDir, "leaky.json"),
      `${JSON.stringify({
        note: "operator mentioned frost.example and token sk-abcdefghijklmnopqrstuvwxyz",
      })}\n`,
      "utf8",
    );
    const tool = createMemoryTool({ projectRoot: root, conversationsDir });
    const result = (await tool.execute({
      action: "session_search",
      query: "frost.example",
    })) as { ok: true; matches: Array<{ snippet: string }> };
    expect(result.ok).toBe(true);
    expect(result.matches[0]?.snippet).toContain("frost.example");
    expect(result.matches[0]?.snippet).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(result.matches[0]?.snippet).toContain("[redacted]");
  });
});

describeSqlite("memory tool store actions", () => {
  it("round-trips store, search, and get through the tool", async () => {
    const root = tempProject();
    const store = openStore(root);
    const tool = createMemoryTool({ projectRoot: root, store });
    const stored = (await tool.execute({
      action: "store",
      target: "notes",
      content: "Formatter is prettier.",
    })) as { ok: true; entry: { id: string } };
    expect(stored.ok).toBe(true);

    const searched = (await tool.execute({
      action: "search",
      query: "prettier",
    })) as { ok: true; entries: Array<{ id: string }> };
    expect(searched.entries.map((entry) => entry.id)).toContain(stored.entry.id);

    const got = await tool.execute({ action: "get", id: stored.entry.id });
    expect(got).toMatchObject({
      ok: true,
      entry: { id: stored.entry.id, content: "Formatter is prettier." },
    });
  });
});
