import fs from "node:fs";
import path from "node:path";

import { VibeKitError } from "@vibekit/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STATE_TRACKING,
  STATE_BACKEND_ID,
  createRepositoryState,
} from "../../packages/core/src/state/index.js";

import {
  approvalDoc,
  decisionDoc,
  eventDoc,
  resultDoc,
  taskDoc,
  tempProject,
  verificationDoc,
} from "./helpers.js";

describe("repository State adapter", () => {
  it("uses state:repository defaults from spec §8.3", () => {
    const root = tempProject();
    const state = createRepositoryState({ projectRoot: root });
    expect(state.backend).toBe(STATE_BACKEND_ID);
    expect(state.tracking.tracking).toEqual(DEFAULT_STATE_TRACKING);
    expect(state.tracking.gitKinds).toEqual(["decisions"]);
    expect(state.tracking.ignoredKinds).toEqual([
      "tasks",
      "results",
      "approvals",
      "verifications",
      "events",
    ]);
    const gitignore = fs.readFileSync(path.join(state.paths.state, ".gitignore"), "utf8");
    expect(gitignore).toContain("/tasks/");
    expect(gitignore).toContain("/events/");
    expect(gitignore).not.toContain("/decisions/");
    expect(fs.readFileSync(path.join(state.paths.runtime, ".gitignore"), "utf8")).toBe("*\n");
    expect(fs.existsSync(state.paths.claims)).toBe(true);
    expect(fs.existsSync(state.paths.locks)).toBe(true);
  });

  it("stores Task, Result, Decision, Approval, and Verification records", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const task = state.tasks.create(taskDoc());
    const result = state.results.create(resultDoc());
    const decision = state.decisions.create(decisionDoc());
    const approval = state.approvals.create(approvalDoc());
    const verification = state.verifications.create(verificationDoc());

    expect(task.document.status).toBe("open");
    expect(result.document.taskId).toBe(task.document.id);
    expect(decision.document.question).toContain("REST");
    expect(approval.document.status).toBe("pending");
    expect(verification.document.status).toBe("pending");
    expect(fs.existsSync(task.path)).toBe(true);
    expect(state.tasks.list()).toHaveLength(1);
    expect(state.results.get(result.document.id).hash).toBe(result.hash);
  });

  it("survives process restart because the filesystem is the source of truth", () => {
    const root = tempProject();
    const first = createRepositoryState({ projectRoot: root });
    const created = first.tasks.create(taskDoc());
    first.results.create(resultDoc());
    first.decisions.create(decisionDoc({ status: "accepted" }));
    first.events.append(eventDoc());
    first.close();

    const second = createRepositoryState({ projectRoot: root });
    const restored = second.tasks.get(created.document.id);
    expect(restored.document).toEqual(created.document);
    expect(restored.hash).toBe(created.hash);
    expect(second.results.list()).toHaveLength(1);
    expect(second.decisions.list()[0]?.document.status).toBe("accepted");
    expect(second.events.list()).toHaveLength(1);
  });

  it("places ephemeral kinds under runtime and git kinds under state/", () => {
    const state = createRepositoryState({
      projectRoot: tempProject(),
      tracking: {
        ...DEFAULT_STATE_TRACKING,
        tasks: "ephemeral",
        decisions: "git",
      },
    });
    expect(state.paths.tasks).toContain(`${path.sep}runtime${path.sep}state${path.sep}tasks`);
    expect(state.paths.decisions.endsWith(`${path.sep}decisions`)).toBe(true);
    expect(state.paths.decisions).not.toContain(`${path.sep}runtime${path.sep}`);
    const gitignore = fs.readFileSync(path.join(state.paths.state, ".gitignore"), "utf8");
    expect(gitignore).not.toContain("/tasks/");
    expect(gitignore).not.toContain("/decisions/");
  });

  it("rejects invalid documents and illegal lifecycle transitions", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const task = state.tasks.create(taskDoc());
    expect(() => state.tasks.create(taskDoc({ objective: "" }))).toThrow(VibeKitError);
    try {
      state.tasks.update(
        { ...task.document, status: "accepted" },
        { expectedRevision: task.revision },
      );
      throw new Error("expected transition failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).code).toBe("lifecycle_invalid_transition");
    }
  });

  it("enforces typed runtime IDs on reads", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    expect(() => state.tasks.get("result_550e8400-e29b-41d4-a716-446655440003")).toThrow(
      VibeKitError,
    );
  });
});
