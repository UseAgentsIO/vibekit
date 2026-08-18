import fs from "node:fs";
import path from "node:path";

import { createRepositoryState } from "@useagentsio/core";
import {
  createIdempotencyStore,
  runManaged,
  type CreatePiSession,
  type PiSession,
  type PiSessionEvent,
} from "@useagentsio/pi";
import { afterEach, describe, expect, it } from "vitest";

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

describe("idempotency protection", () => {
  it("does not start the same consequential Task twice for one external event key", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const started: string[] = [];
    const { session } = mockSession({
      prompt: async (text) => {
        started.push(text);
      },
    });
    const createSession: CreatePiSession = async () => session;
    const store = createIdempotencyStore({
      directory: path.join(fixture.root, ".vibekit", "runtime", "idempotency"),
    });

    const first = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: false,
      idempotency: store,
      idempotencyKey: "interface:slack:event-123",
      createSession,
    });
    expect(first.duplicate).toBe(false);
    expect(first.status).toBe("completed");
    expect(started).toHaveLength(1);

    const second = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: false,
      idempotency: store,
      idempotencyKey: "interface:slack:event-123",
      createSession,
    });
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe("duplicate");
    expect(second.existing?.taskId).toBe(fixture.task.id);
    expect(started).toHaveLength(1);
    expect(second.runId).toBe(first.runId);
  });

  it("allows a different external event key to start work", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    let sessions = 0;
    const { session } = mockSession({});
    const createSession: CreatePiSession = async () => {
      sessions += 1;
      return session;
    };
    const store = createIdempotencyStore({
      directory: path.join(fixture.root, ".vibekit", "runtime", "idempotency"),
    });

    await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: false,
      idempotency: store,
      idempotencyKey: "interface:http:event-a",
      createSession,
    });
    await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: false,
      idempotency: store,
      idempotencyKey: "interface:http:event-b",
      createSession,
    });
    expect(sessions).toBe(2);
  });

  it("dedupes before Run creation when the store is created from Project State", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const state = createRepositoryState({ projectRoot: fixture.root });
    let sessions = 0;
    const { session } = mockSession({});
    const createSession: CreatePiSession = async () => {
      sessions += 1;
      return session;
    };

    const first = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      state,
      isolateWorktree: false,
      idempotencyKey: "webhook:delivery:99",
      createSession,
    });
    const second = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      state,
      isolateWorktree: false,
      idempotencyKey: "webhook:delivery:99",
      createSession,
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(sessions).toBe(1);
    expect(storeFiles(path.join(state.paths.runtime, "idempotency")).length).toBe(1);
  });
});

function storeFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
}

function mockSession(options: {
  readonly prompt?: (text: string) => Promise<void>;
}): { session: PiSession } {
  let listener: ((event: PiSessionEvent) => void) | undefined;
  const session: PiSession = {
    async prompt(text) {
      listener?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: JSON.stringify({ summary: "ok", artifacts: [], evidence: [] }),
        },
      });
      if (options.prompt) {
        await options.prompt(text);
      }
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
      return;
    },
  };
  return { session };
}
