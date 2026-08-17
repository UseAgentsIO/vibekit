import { VibeKitError } from "@vibekit/core";
import { describe, expect, it } from "vitest";

import { createRepositoryState } from "../../packages/core/src/state/index.js";

import {
  approvalDoc,
  decisionDoc,
  resultDoc,
  taskDoc,
  tempProject,
  UUIDS,
  verificationDoc,
} from "./helpers.js";

describe("revision checks and claims", () => {
  it("rejects conflicting Task writes when the expected revision is stale", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const created = state.tasks.create(taskDoc());
    const first = state.tasks.update(
      { ...created.document, status: "claimed", claimedBy: `run_${UUIDS[1]}` },
      { expectedRevision: 1 },
    );
    expect(first.document.revision).toBe(2);
    try {
      state.tasks.update(
        { ...created.document, status: "cancelled" },
        { expectedRevision: 1 },
      );
      throw new Error("expected revision conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("conflict");
      expect((error as VibeKitError).code).toBe("state_revision_conflict");
    }
    expect(state.tasks.get(created.document.id).document.status).toBe("claimed");
  });

  it("rejects hash-based stale writes for records without a revision field", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const created = state.results.create(resultDoc());
    const updated = state.results.update(
      { ...created.document, summary: "Updated summary of the outcome" },
      { expectedHash: created.hash },
    );
    expect(updated.hash).not.toBe(created.hash);
    try {
      state.results.update(
        { ...created.document, summary: "Lost update" },
        { expectedHash: created.hash },
      );
      throw new Error("expected hash conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("conflict");
      expect((error as VibeKitError).code).toBe("state_hash_conflict");
    }
    expect(state.results.get(created.document.id).document.summary).toBe(
      "Updated summary of the outcome",
    );
  });

  it("requires an expected revision or hash on updates", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const decision = state.decisions.create(decisionDoc());
    try {
      state.decisions.update(
        { ...decision.document, status: "accepted" },
        {},
      );
      throw new Error("expected missing expected-revision");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).code).toBe("state_expected_missing");
    }
  });

  it("rejects creating a document that already exists", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    state.approvals.create(approvalDoc());
    try {
      state.approvals.create(approvalDoc());
      throw new Error("expected already-exists");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("conflict");
      expect((error as VibeKitError).code).toBe("state_already_exists");
    }
  });

  it("allows a verification update when the expected hash still matches", () => {
    const state = createRepositoryState({ projectRoot: tempProject() });
    const created = state.verifications.create(verificationDoc());
    const updated = state.verifications.update(
      {
        ...created.document,
        status: "passed",
        finishedAt: "2026-01-15T12:14:00.000Z",
        exitCode: 0,
        evidence: [
          {
            state: "observed",
            source: "verifier:command",
            summary: "All project tests passed.",
          },
        ],
      },
      { expectedHash: created.hash },
    );
    expect(updated.document.status).toBe("passed");
  });

  it("creates exclusive claims and recovers stale leases", () => {
    const clock = { now: new Date("2026-01-15T12:00:00.000Z") };
    const root = tempProject();
    const state = createRepositoryState({
      projectRoot: root,
      now: () => clock.now,
      claimLeaseMs: 1_000,
    });
    const task = taskDoc();
    const claim = state.claims.create({
      taskId: task.id,
      runId: `run_${UUIDS[1]}`,
      agentId: "agent:coder",
      scope: { paths: ["src/"], resources: [] },
    });
    expect(claim.revision).toBe(1);
    expect(state.claims.getActiveForTask(task.id)?.id).toBe(claim.id);

    try {
      state.claims.create({
        taskId: task.id,
        runId: `run_${UUIDS[2]}`,
        agentId: "agent:reviewer",
        scope: { paths: ["src/"], resources: [] },
      });
      throw new Error("expected exclusive claim conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("conflict");
      expect((error as VibeKitError).code).toBe("state_claim_held");
    }

    clock.now = new Date("2026-01-15T12:00:02.000Z");
    const recovered = state.claims.recoverStale();
    expect(recovered.map((item) => item.id)).toEqual([claim.id]);
    expect(state.claims.listActive(task.id)).toHaveLength(0);

    const replacement = state.claims.create({
      taskId: task.id,
      runId: `run_${UUIDS[2]}`,
      agentId: "agent:reviewer",
      scope: { paths: ["src/"], resources: [] },
    });
    expect(replacement.id).not.toBe(claim.id);
    state.claims.release(replacement.id);
    expect(state.claims.tryGet(replacement.id)).toBeUndefined();
  });

  it("recovers stale claims automatically on open after restart", () => {
    const clock = { now: new Date("2026-01-15T12:00:00.000Z") };
    const root = tempProject();
    const first = createRepositoryState({
      projectRoot: root,
      now: () => clock.now,
      claimLeaseMs: 500,
    });
    first.claims.create({
      taskId: `task_${UUIDS[0]}`,
      runId: `run_${UUIDS[1]}`,
      agentId: "agent:coder",
      scope: { paths: [], resources: [] },
    });
    first.close();

    clock.now = new Date("2026-01-15T12:00:01.000Z");
    const second = createRepositoryState({
      projectRoot: root,
      now: () => clock.now,
    });
    expect(second.claims.list()).toHaveLength(0);
  });

  it("rejects a held exclusive lock until the lease expires", () => {
    const clock = { now: new Date("2026-01-15T12:00:00.000Z") };
    const state = createRepositoryState({
      projectRoot: tempProject(),
      now: () => clock.now,
      lockLeaseMs: 1_000,
    });
    state.locks.acquire("docs:example", "writer-a");
    try {
      state.locks.acquire("docs:example", "writer-b");
      throw new Error("expected lock busy");
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("resource_busy");
      expect((error as VibeKitError).code).toBe("state_lock_held");
    }
    clock.now = new Date("2026-01-15T12:00:02.000Z");
    const recovered = state.locks.recoverStale();
    expect(recovered).toHaveLength(1);
    const next = state.locks.acquire("docs:example", "writer-b");
    expect(next.owner).toBe("writer-b");
  });
});
