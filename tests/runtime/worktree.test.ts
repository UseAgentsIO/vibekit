import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  createWorktree,
  isGitRepository,
  listWorktrees,
  removeWorktree,
  runManaged,
  shouldUseWorktree,
  worktreePathFor,
  type CreatePiSession,
  type PiSession,
  type PiSessionEvent,
} from "@vibekit/pi";
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

describe("worktree isolation", () => {
  it("creates dedicated worktrees for parallel coding Runs", () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    initGit(fixture.root);

    const first = createWorktree({
      repoRoot: fixture.root,
      runId: "run_550e8400-e29b-41d4-a716-4466554400a1",
    });
    const second = createWorktree({
      repoRoot: fixture.root,
      runId: "run_550e8400-e29b-41d4-a716-4466554400a2",
    });

    expect(first.path).not.toBe(second.path);
    expect(fs.existsSync(first.path)).toBe(true);
    expect(fs.existsSync(second.path)).toBe(true);
    expect(path.resolve(first.path)).toBe(
      path.resolve(worktreePathFor(fixture.root, "run_550e8400-e29b-41d4-a716-4466554400a1")),
    );
    const listed = listWorktrees(fixture.root);
    expect(listed).toEqual(expect.arrayContaining([first.path, second.path]));

    fs.writeFileSync(path.join(first.path, "from-a.txt"), "a\n", "utf8");
    expect(fs.existsSync(path.join(second.path, "from-a.txt"))).toBe(false);

    removeWorktree(first);
    removeWorktree(second);
    expect(fs.existsSync(first.path)).toBe(false);
    expect(fs.existsSync(second.path)).toBe(false);
  });

  it("uses a worktree cwd for a mutating coding Run and cleans it after success", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    initGit(fixture.root);
    const seen: string[] = [];
    const { session } = mockSession({});
    const createSession: CreatePiSession = async (options) => {
      seen.push(options.cwd);
      return session;
    };

    const outcome = await runManaged({
      projectRoot: fixture.root,
      bindingName: "coder",
      task: fixture.task,
      isolateWorktree: true,
      createSession,
    });

    expect(shouldUseWorktree({
      isolation: "worktree",
      mutationIsolation: "worktree",
      mutating: true,
    })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(outcome.worktree?.path);
    expect(seen[0]).toContain(`${path.sep}worktrees${path.sep}`);
    expect(seen[0]).not.toBe(fixture.root);
    expect(outcome.configuration?.cwd).toBe(outcome.worktree?.path);
    expect(fs.existsSync(outcome.worktree?.path ?? "")).toBe(false);
  });

  it("gives two parallel coding Runs different worktree cwds", async () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    initGit(fixture.root);
    const cwds: string[] = [];
    const releases: Array<() => void> = [];

    const start = (taskId: typeof fixture.task.id) => {
      let listener: ((event: PiSessionEvent) => void) | undefined;
      const session: PiSession = {
        async prompt() {
          listener?.({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: JSON.stringify({ summary: "ok", artifacts: [], evidence: [] }),
            },
          });
          await new Promise<void>((resolve) => {
            releases.push(resolve);
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
          return;
        },
      };
      return runManaged({
        projectRoot: fixture.root,
        bindingName: "coder",
        task: { ...fixture.task, id: taskId },
        isolateWorktree: true,
        exclusive: false,
        createSession: async (options) => {
          cwds.push(options.cwd);
          return session;
        },
      });
    };

    const first = start("task_550e8400-e29b-41d4-a716-446655440001");
    const second = start("task_550e8400-e29b-41d4-a716-446655440002");
    await waitFor(() => cwds.length === 2);

    expect(cwds[0]).not.toBe(cwds[1]);
    expect(cwds[0]).toContain(`${path.sep}worktrees${path.sep}`);
    expect(cwds[1]).toContain(`${path.sep}worktrees${path.sep}`);
    expect(isGitRepository(cwds[0] ?? "")).toBe(true);
    expect(isGitRepository(cwds[1] ?? "")).toBe(true);

    for (const release of releases) {
      release();
    }
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((item) => item.status)).toEqual(["completed", "completed"]);
    expect(fs.existsSync(outcomes[0]?.worktree?.path ?? "")).toBe(false);
    expect(fs.existsSync(outcomes[1]?.worktree?.path ?? "")).toBe(false);
  });

  it("cleans the worktree after cancellation, timeout, and failure", async () => {
    const cancelFixture = writeRuntimeFixture();
    temps.push(cancelFixture.root);
    initGit(cancelFixture.root);

    const controller = new AbortController();
    let cancelRelease: (() => void) | undefined;
    let cancelStarted = false;
    let cancelCwd = "";
    const cancelId = "run_550e8400-e29b-41d4-a716-4466554400c1" as const;
    const cancelled = runManaged({
      projectRoot: cancelFixture.root,
      bindingName: "coder",
      task: cancelFixture.task,
      runId: cancelId,
      isolateWorktree: true,
      signal: controller.signal,
      createSession: async (options) => {
        cancelCwd = options.cwd;
        return {
          async prompt() {
            cancelStarted = true;
            await new Promise<void>((resolve) => {
              cancelRelease = resolve;
            });
          },
          subscribe() {
            return () => undefined;
          },
          async abort() {
            return;
          },
          dispose() {
            return;
          },
        };
      },
    });
    await waitFor(() => cancelStarted && cancelCwd.length > 0);
    expect(cancelCwd).toContain(`${path.sep}worktrees${path.sep}`);
    expect(fs.existsSync(cancelCwd)).toBe(true);
    controller.abort();
    cancelRelease?.();
    const cancelOutcome = await cancelled;
    expect(cancelOutcome.status).toBe("cancelled");
    expect(fs.existsSync(cancelCwd)).toBe(false);

    const timeoutFixture = writeRuntimeFixture({
      project: {
        execution: {
          maxParallelRuns: 4,
          defaultIsolation: "process",
          mutationIsolation: "worktree",
          defaultTimeoutMs: 1,
          maxDelegationDepth: 2,
        },
      },
      agent: {
        execution: { isolation: "worktree", timeoutMs: 1, cleanupRequired: true },
      },
    });
    temps.push(timeoutFixture.root);
    initGit(timeoutFixture.root);
    const timeoutId = "run_550e8400-e29b-41d4-a716-4466554400c2" as const;
    const timeoutOutcome = await runManaged({
      projectRoot: timeoutFixture.root,
      bindingName: "coder",
      task: timeoutFixture.task,
      runId: timeoutId,
      isolateWorktree: true,
      createSession: async () => hangingSession().session,
    });
    expect(timeoutOutcome.status).toBe("timed_out");
    expect(fs.existsSync(timeoutOutcome.worktree?.path ?? worktreePathFor(timeoutFixture.root, timeoutId))).toBe(
      false,
    );

    const failedId = "run_550e8400-e29b-41d4-a716-4466554400c3" as const;
    const failed = await runManaged({
      projectRoot: cancelFixture.root,
      bindingName: "coder",
      task: { ...cancelFixture.task, id: "task_550e8400-e29b-41d4-a716-446655440012" },
      runId: failedId,
      isolateWorktree: true,
      createSession: async () => {
        throw new Error("session factory failed");
      },
    });
    expect(failed.status).toBe("failed");
    expect(fs.existsSync(failed.worktree?.path ?? worktreePathFor(cancelFixture.root, failedId))).toBe(
      false,
    );
  });
});

function initGit(root: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "pipe" });
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

function hangingSession(onStart?: () => void): { session: PiSession; started: boolean } {
  const handle = { started: false, session: undefined as unknown as PiSession };
  handle.session = {
    async prompt() {
      handle.started = true;
      onStart?.();
      await new Promise(() => undefined);
    },
    subscribe() {
      return () => undefined;
    },
    async abort() {
      return;
    },
    dispose() {
      return;
    },
  };
  return handle;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
