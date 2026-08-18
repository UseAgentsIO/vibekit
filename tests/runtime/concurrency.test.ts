import fs from "node:fs";

import { createRepositoryState } from "@useagentsio/core";
import {
  createConcurrencyPool,
  planProcessIsolation,
  requiresProcessIsolation,
  runIsolatedProcess,
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

describe("Task claims and Project concurrency", () => {
  it("prevents the same exclusive Task from running twice", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const state = createRepositoryState({ projectRoot: fixture.root });
    let release: (() => void) | undefined;
    const { session } = mockSession({
      prompt: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });

    const first = runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      state,
      isolateWorktree: false,
      createSession: async () => session,
    });

    await waitFor(() => state.claims.getActiveForTask(fixture.task.id) !== undefined);

    await expect(
      runManaged({
        projectRoot: fixture.root,
        bindingName: "coder",
        task: fixture.task,
        state,
        isolateWorktree: false,
        createSession: async () => session,
      }),
    ).rejects.toMatchObject({ code: "state_claim_held" });

    release?.();
    const outcome = await first;
    expect(outcome.status).toBe("completed");
    expect(state.claims.getActiveForTask(fixture.task.id)).toBeUndefined();
  });

  it("recovers an expired claim and then allows a new exclusive Run", async () => {
    const clock = { now: new Date("2026-01-15T12:00:00.000Z") };
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const state = createRepositoryState({
      projectRoot: fixture.root,
      now: () => clock.now,
      claimLeaseMs: 1_000,
    });
    state.claims.create({
      taskId: fixture.task.id,
      runId: "run_550e8400-e29b-41d4-a716-4466554400aa",
      agentId: "agent:coder",
      scope: { paths: [], resources: [] },
    });
    expect(state.claims.getActiveForTask(fixture.task.id)).toBeDefined();

    clock.now = new Date("2026-01-15T12:00:02.000Z");
    const { session } = mockSession({});
    const outcome = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      state,
      isolateWorktree: false,
      now: clock.now,
      createSession: async () => session,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.duplicate).toBe(false);
  });

  it("enforces Project maxParallelRuns", async () => {
    const fixture = writeRuntimeFixture({
      project: {
        execution: {
          maxParallelRuns: 1,
          defaultIsolation: "process",
          mutationIsolation: "worktree",
          defaultTimeoutMs: 600000,
          maxDelegationDepth: 2,
        },
      },
    });
    temps.push(fixture.root);
    const pool = createConcurrencyPool({ max: 1 });
    let release: (() => void) | undefined;
    const { session } = mockSession({
      prompt: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });

    const first = runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      pool,
      isolateWorktree: false,
      createSession: async () => session,
    });
    await waitFor(() => pool.active() === 1);

    await expect(
      runManaged({
        projectRoot: fixture.root,
        bindingName: "coder",
        task: { ...fixture.task, id: "task_550e8400-e29b-41d4-a716-446655440099" },
        pool,
        isolateWorktree: false,
        createSession: async () => session,
      }),
    ).rejects.toMatchObject({ code: "pool_exhausted" });

    release?.();
    await first;
    expect(pool.active()).toBe(0);
  });

  it("plans process isolation and strips unrelated credentials from the child env", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    expect(
      requiresProcessIsolation({
        project: fixture.project,
        isolation: "process",
      }),
    ).toBe(true);

    const plan = planProcessIsolation({
      cwd: fixture.root,
      secrets: [{ name: "OPENAI_API_KEY", source: "environment", required: true }],
      source: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "sk-test-not-a-real-key-cccccccccc",
        AWS_SECRET_ACCESS_KEY: "should-not-pass",
        GITHUB_TOKEN: "should-not-pass",
        UNRELATED: "nope",
      },
      args: ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"],
    });
    expect(plan.env.OPENAI_API_KEY).toBeDefined();
    expect(plan.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(plan.env.GITHUB_TOKEN).toBeUndefined();
    expect(plan.stripped).toEqual(
      expect.arrayContaining(["AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "UNRELATED"]),
    );
    expect(plan.protocol.messages).toEqual(["start", "abort", "result"]);

    const child = await runIsolatedProcess(plan);
    expect(child.exitCode).toBe(0);
    const keys = JSON.parse(child.stdout) as string[];
    expect(keys).toContain("OPENAI_API_KEY");
    expect(keys).toContain("PATH");
    expect(keys).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(keys).not.toContain("GITHUB_TOKEN");
    expect(keys).not.toContain("UNRELATED");
  });

  it("attaches a process isolation plan to a managed Run", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    const { session } = mockSession({});
    const createSession: CreatePiSession = async () => session;
    const outcome = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: false,
      isolateProcess: true,
      env: {
        PATH: "/usr/bin",
        AWS_SECRET_ACCESS_KEY: "leak",
      },
      createSession,
    });
    expect(outcome.isolationPlan).toBeDefined();
    expect(outcome.isolationPlan?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(outcome.isolationPlan?.stripped).toContain("AWS_SECRET_ACCESS_KEY");
  });
});

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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
