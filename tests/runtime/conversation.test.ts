import fs from "node:fs";
import path from "node:path";

import { createRepositoryState } from "@useagentsio/core";
import {
  runConversationTurn,
  runManaged,
  type CreatePiSession,
  type CreatePersistentSessionManager,
  type PiSession,
  type PiSessionEvent,
} from "@useagentsio/pi";
import { afterEach, describe, expect, it } from "vitest";

import { makeTempDir } from "../helpers.js";
import { writeRuntimeFixture } from "./helpers.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("persistent Pi conversations", () => {
  it("creates a session path on the first turn, reuses it, and keeps other keys distinct", async () => {
    const root = makeTempDir("vibekit-conversation-");
    temps.push(root);
    const firstPath = path.join(root, ".vibekit", "runtime", "sessions", "conv-a.jsonl");
    const otherPath = path.join(root, ".vibekit", "runtime", "sessions", "conv-b.jsonl");
    const opened: boolean[] = [];
    const seenManagers: unknown[] = [];
    const createSessionManager = stubSessionManager(opened);
    const { session, disposed } = mockSession({ text: "hello from turn" });
    const createSession: CreatePiSession = async (options) => {
      seenManagers.push(options.sessionManager);
      return session;
    };

    const first = await runConversationTurn({
      cwd: root,
      sessionPath: firstPath,
      tools: ["read"],
      systemPrompt: "You are a test agent.",
      model: { provider: "openai", id: "gpt-4.1", source: "project" },
      text: "first turn",
      allowNetwork: false,
      createSession,
      createSessionManager,
    });

    expect(first.sessionPath).toBe(firstPath);
    expect(first.text).toBe("hello from turn");
    expect(first.cancelled).toBe(false);
    expect(opened).toEqual([false]);
    expect(fs.existsSync(firstPath)).toBe(true);
    expect(disposed.value).toBe(true);

    const second = await runConversationTurn({
      cwd: root,
      sessionPath: first.sessionPath,
      tools: ["read"],
      systemPrompt: "You are a test agent.",
      model: { provider: "openai", id: "gpt-4.1", source: "project" },
      text: "second turn",
      allowNetwork: false,
      createSession,
      createSessionManager,
    });

    expect(second.sessionPath).toBe(first.sessionPath);
    expect(opened).toEqual([false, true]);
    expect(seenManagers[0]).toBe(seenManagers[1]);
    expect(fs.existsSync(first.sessionPath)).toBe(true);

    const other = await runConversationTurn({
      cwd: root,
      sessionPath: otherPath,
      tools: ["read"],
      systemPrompt: "You are a test agent.",
      model: { provider: "openai", id: "gpt-4.1", source: "project" },
      text: "other conversation",
      allowNetwork: false,
      createSession,
      createSessionManager,
    });

    expect(other.sessionPath).toBe(otherPath);
    expect(other.sessionPath).not.toBe(first.sessionPath);
    expect(opened).toEqual([false, true, false]);
    expect(seenManagers[2]).not.toBe(seenManagers[0]);
    expect(fs.existsSync(otherPath)).toBe(true);
    expect(fs.existsSync(first.sessionPath)).toBe(true);
  });

  it("persists Task, Events, and Result when runManaged receives state", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const state = createRepositoryState({ projectRoot: fixture.root });
    const { session } = mockSession({
      text: JSON.stringify({ summary: "ok", artifacts: [], evidence: [] }),
    });

    const outcome = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      state,
      isolateWorktree: false,
      createSession: async () => session,
    });

    expect(outcome.status).toBe("completed");
    expect(state.tasks.tryGet(fixture.task.id)?.document.id).toBe(fixture.task.id);
    expect(state.results.tryGet(outcome.result!.id)?.document.id).toBe(outcome.result!.id);
    expect(state.events.list({ runId: outcome.runId }).map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.created", "run.started", "run.completed", "result.created"]),
    );
  });
});

function stubSessionManager(opened: boolean[]): CreatePersistentSessionManager {
  const managers = new Map<string, { path: string; sessionFile: string }>();
  return ({ sessionPath, exists }) => {
    opened.push(exists);
    const existing = managers.get(sessionPath);
    if (exists && existing !== undefined) {
      return existing;
    }
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "", "utf8");
    const manager = { path: sessionPath, sessionFile: sessionPath };
    managers.set(sessionPath, manager);
    return manager;
  };
}

function mockSession(options: {
  readonly text?: string;
}): { session: PiSession; disposed: { value: boolean } } {
  const disposed = { value: false };
  let listener: ((event: PiSessionEvent) => void) | undefined;
  const session: PiSession = {
    async prompt() {
      listener?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: options.text ?? "ok",
        },
      });
    },
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    async abort() {
      return;
    },
    dispose() {
      disposed.value = true;
    },
  };
  return { session, disposed };
}
