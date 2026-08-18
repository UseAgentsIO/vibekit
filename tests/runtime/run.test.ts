import { validateDocument } from "@useagentsio/core";
import {
  runIsolated,
  type CreatePiSession,
  type PiSession,
  type PiSessionEvent,
} from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { writeRuntimeFixture } from "./helpers.js";

function mockSession(options: {
  readonly text?: string;
  readonly prompt?: (text: string) => Promise<void>;
}): { session: PiSession; aborted: { value: boolean }; disposed: { value: boolean } } {
  const aborted = { value: false };
  const disposed = { value: false };
  let listener: ((event: PiSessionEvent) => void) | undefined;
  const session: PiSession = {
    async prompt(text) {
      listener?.({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta:
            options.text ??
            JSON.stringify({
              summary: `Handled: ${text.slice(0, 24)}`,
              artifacts: [],
              evidence: [],
            }),
        },
      });
      listener?.({ type: "tool_execution_start", toolName: "read" });
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
      aborted.value = true;
    },
    dispose() {
      disposed.value = true;
    },
  };
  return { session, aborted, disposed };
}

describe("isolated Pi Run", () => {
  it("creates a session with cwd, allowlisted tools, and returns Events plus a Result", async () => {
    const fixture = writeRuntimeFixture();
    const seen: Array<{ cwd: string; tools: readonly string[]; systemPrompt: string }> = [];
    const { session, disposed } = mockSession({});
    const createSession: CreatePiSession = async (options) => {
      seen.push({
        cwd: options.cwd,
        tools: options.tools,
        systemPrompt: options.systemPrompt,
      });
      return session;
    };

    const outcome = await runIsolated({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      createSession,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.cwd).toBe(fixture.root);
    expect(seen[0]?.tools).toEqual(
      expect.arrayContaining(["read", "write", "edit", "bash"]),
    );
    expect(seen[0]?.systemPrompt).toContain("You are executing a VibeKit Agent Run");
    expect(outcome.status).toBe("completed");
    expect(outcome.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["run.created", "run.started", "run.progress", "run.completed", "result.created"]),
    );
    expect(disposed.value).toBe(true);
    expect(validateDocument("result", outcome.result).valid).toBe(true);
    expect(validateDocument("event", outcome.events[0]).valid).toBe(true);
  });

  it("maps cancellation to session.abort and dispose", async () => {
    const fixture = writeRuntimeFixture();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const { session, aborted, disposed } = mockSession({
      prompt: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });

    const running = runIsolated({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      signal: controller.signal,
      createSession: async () => session,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    release?.();
    const outcome = await running;

    expect(aborted.value).toBe(true);
    expect(disposed.value).toBe(true);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.events.some((event) => event.type === "run.cancelled")).toBe(true);
    expect(outcome.result.status).toBe("failed");
  });

  it("aborts and records run.timed_out when the timeout fires", async () => {
    const fixture = writeRuntimeFixture({
      project: {
        execution: {
          ...fixtureExecution(),
          defaultTimeoutMs: 1,
        },
      },
      agent: {
        execution: { isolation: "worktree", timeoutMs: 1, cleanupRequired: true },
      },
    });
    const { session, aborted, disposed } = mockSession({
      prompt: () => new Promise(() => undefined),
    });

    const outcome = await runIsolated({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      createSession: async () => session,
    });

    expect(aborted.value).toBe(true);
    expect(disposed.value).toBe(true);
    expect(outcome.status).toBe("timed_out");
    expect(outcome.events.some((event) => event.type === "run.timed_out")).toBe(true);
    expect(outcome.result.status).toBe("failed");
  });

  it("does not claim completion when required cleanup fails", async () => {
    const fixture = writeRuntimeFixture();
    const { session } = mockSession({});
    session.dispose = () => {
      throw new Error("dispose failed");
    };

    const outcome = await runIsolated({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      createSession: async () => session,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.failure?.category).toBe("cleanup_failed");
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.unresolvedIssues).toContain("cleanup-failed");
  });
});

function fixtureExecution(): {
  maxParallelRuns: number;
  defaultIsolation: "process";
  mutationIsolation: "worktree";
  defaultTimeoutMs: number;
  maxDelegationDepth: number;
} {
  return {
    maxParallelRuns: 4,
    defaultIsolation: "process",
    mutationIsolation: "worktree",
    defaultTimeoutMs: 600000,
    maxDelegationDepth: 2,
  };
}
