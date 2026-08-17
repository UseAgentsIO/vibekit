import {
  acceptCandidate,
  applyAcceptedResult,
  applySelfModification,
  computeCandidateRevision,
  createProposal,
  evaluateReadiness,
  evaluateVerification,
  executeCommandVerifier,
  hashSelfModificationBase,
  hashSelfModificationPayload,
  isVibeKitError,
  recordIndependentReview,
  runCommandVerification,
  VibeKitError,
} from "@vibekit/core";
import { evaluateVerification as hookEvaluate, verifyAfterRun } from "@vibekit/pi";
import { describe, expect, it } from "vitest";

import {
  FAILING_COMMAND,
  FIXED_NOW,
  PASSING_COMMAND,
  approvedFor,
  clock,
  exists,
  projectAuth,
  readFile,
  setupScenario,
  writeFile,
} from "./helpers.js";

describe("Verification and governance (acceptance 31–39)", () => {
  it("31. an Agent Result alone cannot become accepted State", () => {
    const { state, task, result } = setupScenario();
    expect(result.status).toBe("completed");
    expect(result.verificationIds).toEqual([]);
    expect(state.tasks.get(task.id).document.status).toBe("review");

    const readiness = evaluateReadiness({
      task,
      result,
      verifications: [],
      required: ["verifier:command"],
    });
    expect(readiness.completed).toBe(true);
    expect(readiness.verificationPassed).toBe(false);
    expect(readiness.canAccept).toBe(false);

    expect(() =>
      acceptCandidate({
        state,
        task,
        result,
        verifications: [],
        required: ["verifier:command"],
        clock,
      }),
    ).toThrow(VibeKitError);
    try {
      acceptCandidate({
        state,
        task,
        result,
        verifications: [],
        required: ["verifier:command"],
        clock,
      });
    } catch (error) {
      expect(isVibeKitError(error)).toBe(true);
      expect((error as VibeKitError).category).toBe("verification_failed");
    }
    expect(state.tasks.get(task.id).document.status).toBe("review");
    expect(state.tasks.get(task.id).document.status).not.toBe("accepted");
  });

  it("32. required deterministic Verification blocks on failure", () => {
    const { root, state, task, result } = setupScenario();
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: FAILING_COMMAND,
      cwd: root,
      now: clock,
    });
    expect(ran.verification.status).toBe("failed");
    expect(ran.verification.exitCode).toBe(1);
    expect(ran.verification.candidateRevision).toBe(computeCandidateRevision(result));
    expect(ran.result.verificationIds).toContain(ran.verification.id);

    const readiness = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
    });
    expect(readiness.verificationPassed).toBe(false);
    expect(readiness.canAccept).toBe(false);
    expect(() =>
      acceptCandidate({
        state,
        task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        clock,
      }),
    ).toThrow(VibeKitError);
    expect(state.tasks.get(task.id).document.status).toBe("review");
  });

  it("33. independent review cannot be performed by the producing Agent", () => {
    const { root, state, task, result } = setupScenario({ agentId: "agent:coder" });
    const command = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });

    expect(() =>
      recordIndependentReview({
        state,
        task,
        result: command.result,
        reviewerId: "agent:coder",
        verdict: "passed",
        now: clock,
      }),
    ).toThrow(VibeKitError);
    try {
      recordIndependentReview({
        state,
        task,
        result: command.result,
        reviewerId: "agent:coder",
        verdict: "passed",
        now: clock,
      });
    } catch (error) {
      expect(isVibeKitError(error)).toBe(true);
      expect((error as VibeKitError).code).toBe("independent_review_self");
    }

    const review = recordIndependentReview({
      state,
      task,
      result: command.result,
      reviewerId: "agent:reviewer",
      verdict: "passed",
      now: clock,
    });
    expect(review.verification.verifierId).toBe("agent:reviewer");
    expect(review.verification.contract.type).toBe("review");
    expect(review.verification.status).toBe("passed");

    const withoutReview = evaluateVerification({
      result: review.result,
      verifications: [command.verification],
      required: ["verifier:command"],
      independentReview: true,
    });
    expect(withoutReview.verificationPassed).toBe(false);
    expect(withoutReview.independentReviewPassed).toBe(false);

    const withReview = evaluateVerification({
      result: review.result,
      verifications: [command.verification, review.verification],
      required: ["verifier:command"],
      independentReview: true,
    });
    expect(withReview.verificationPassed).toBe(true);
  });

  it("34. Verification is tied to the exact candidate revision", () => {
    const { root, state, task, result } = setupScenario({
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    expect(ran.verification.status).toBe("passed");
    expect(ran.verification.candidateRevision).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const changed = state.results.update(
      {
        ...ran.result,
        artifacts: [{ path: "src/example.ts", revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
      },
      { expectedHash: state.results.get(ran.result.id).hash },
    ).document;

    const evaluation = evaluateVerification({
      result: changed,
      verifications: [ran.verification],
      required: ["verifier:command"],
    });
    expect(evaluation.stale).toHaveLength(1);
    expect(evaluation.verificationPassed).toBe(false);
    expect(evaluation.currentRevision).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(() =>
      acceptCandidate({
        state,
        task,
        result: changed,
        verifications: [ran.verification],
        required: ["verifier:command"],
        clock,
      }),
    ).toThrow(VibeKitError);
  });

  it("35. explicit Approval is required where Policy says it is", () => {
    const { root, state, task, result } = setupScenario({ authorization: "standing" });
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    const project = projectAuth({
      default: "standing",
      actions: { "result.apply": "explicit" },
    });
    const blocked = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      project,
      action: "result.apply",
      approvals: [],
    });
    expect(blocked.verificationPassed).toBe(true);
    expect(blocked.authorized).toBe(false);
    expect(blocked.canAccept).toBe(false);
    expect(blocked.authorization.status).toBe("approval_required");

    const standing = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      project: projectAuth({ default: "standing" }),
      action: "result.apply",
      approvals: [],
    });
    expect(standing.authorized).toBe(true);
    expect(standing.authorization.reason).toMatch(/Standing authorization/i);

    const approval = state.approvals.create(
      approvedFor(ran.result, {
        action: "result.apply",
        target: "src/example.ts",
        scope: { revision: computeCandidateRevision(ran.result) },
      }),
    ).document;
    const granted = acceptCandidate({
      state,
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      project,
      action: "result.apply",
      target: "src/example.ts",
      scope: { revision: computeCandidateRevision(ran.result) },
      approvals: [approval],
      clock,
    });
    expect(granted.task.status).toBe("accepted");
  });

  it("36. Approval applies only to the exact reviewed action", () => {
    const { root, state, task, result } = setupScenario({ authorization: "explicit" });
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    const approval = state.approvals.create(
      approvedFor(ran.result, {
        action: "deploy.apply",
        target: "production",
        scope: { revision: computeCandidateRevision(ran.result), environment: "production" },
      }),
    ).document;

    const otherAction = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "result.apply",
      target: "production",
      scope: { revision: computeCandidateRevision(ran.result), environment: "production" },
      approvals: [approval],
      now: FIXED_NOW,
    });
    expect(otherAction.authorized).toBe(false);

    const otherTarget = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "deploy.apply",
      target: "staging",
      scope: { revision: computeCandidateRevision(ran.result), environment: "production" },
      approvals: [approval],
      now: FIXED_NOW,
    });
    expect(otherTarget.authorized).toBe(false);

    const otherScope = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "deploy.apply",
      target: "production",
      scope: { revision: computeCandidateRevision(ran.result), environment: "staging" },
      approvals: [approval],
      now: FIXED_NOW,
    });
    expect(otherScope.authorized).toBe(false);

    const exact = evaluateReadiness({
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "deploy.apply",
      target: "production",
      scope: { revision: computeCandidateRevision(ran.result), environment: "production" },
      approvals: [approval],
      now: FIXED_NOW,
    });
    expect(exact.authorized).toBe(true);
    expect(exact.canAccept).toBe(true);
  });

  it("37. proposal mode does not apply the mutation", () => {
    const { root, state, task, result } = setupScenario({ delivery: "proposal" });
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    const accepted = acceptCandidate({
      state,
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      clock,
    });
    expect(accepted.task.status).toBe("accepted");

    const proposal = createProposal({
      task: accepted.task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
    });
    expect(proposal.applied).toBe(false);
    expect(proposal.delivery).toBe("proposal");
    expect(proposal.decision.canApply).toBe(false);

    expect(() =>
      applyAcceptedResult({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        writes: { "out/applied.txt": "should-not-exist" },
        clock,
      }),
    ).toThrow(VibeKitError);
    try {
      applyAcceptedResult({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        writes: { "out/applied.txt": "should-not-exist" },
        clock,
      });
    } catch (error) {
      expect(isVibeKitError(error)).toBe(true);
      expect((error as VibeKitError).code).toBe("delivery_proposal_blocks_apply");
    }
    expect(exists(root, "out/applied.txt")).toBe(false);
  });

  it("38. apply mode applies only an accepted and authorized result", () => {
    const { root, state, task, result } = setupScenario({
      delivery: "apply",
      authorization: "explicit",
    });
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    const approval = state.approvals.create(
      approvedFor(ran.result, {
        action: "result.apply",
        target: "src/example.ts",
        scope: { revision: computeCandidateRevision(ran.result) },
      }),
    ).document;

    expect(() =>
      applyAcceptedResult({
        state,
        projectRoot: root,
        task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "result.apply",
        target: "src/example.ts",
        scope: { revision: computeCandidateRevision(ran.result) },
        approvals: [approval],
        writes: { "out/applied.txt": "applied" },
        clock,
      }),
    ).toThrow(VibeKitError);
    try {
      applyAcceptedResult({
        state,
        projectRoot: root,
        task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "result.apply",
        target: "src/example.ts",
        scope: { revision: computeCandidateRevision(ran.result) },
        approvals: [approval],
        writes: { "out/applied.txt": "applied" },
        clock,
      });
    } catch (error) {
      expect(isVibeKitError(error)).toBe(true);
      expect((error as VibeKitError).code).toBe("apply_not_accepted");
    }
    expect(exists(root, "out/applied.txt")).toBe(false);

    const accepted = acceptCandidate({
      state,
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "result.apply",
      target: "src/example.ts",
      scope: { revision: computeCandidateRevision(ran.result) },
      approvals: [approval],
      clock,
    });

    expect(() =>
      applyAcceptedResult({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "result.apply",
        target: "src/example.ts",
        scope: { revision: computeCandidateRevision(ran.result) },
        approvals: [],
        writes: { "out/applied.txt": "applied" },
        clock,
      }),
    ).toThrow(VibeKitError);

    const applied = applyAcceptedResult({
      state,
      projectRoot: root,
      task: accepted.task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "result.apply",
      target: "src/example.ts",
      scope: { revision: computeCandidateRevision(ran.result) },
      approvals: [approval],
      writes: { "out/applied.txt": "applied" },
      clock,
    });
    expect(applied.applied).toBe(true);
    expect(applied.accepted).toBe(true);
    expect(applied.written).toEqual(["out/applied.txt"]);
    expect(readFile(root, "out/applied.txt")).toBe("applied");
  });

  it("39. self-modification checks both base hash and payload hash", () => {
    const { root, state, task, result } = setupScenario({
      delivery: "apply",
      authorization: "explicit",
    });
    const target = "agents/coder/instructions.md";
    writeFile(root, target, "base instructions\n");
    const proposedContent = { [target]: "updated instructions\n" };
    const baseHash = hashSelfModificationBase(root, [target]);
    const payloadHash = hashSelfModificationPayload(proposedContent);
    const ran = runCommandVerification({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    const approval = state.approvals.create(
      approvedFor(ran.result, {
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
      }),
    ).document;
    const accepted = acceptCandidate({
      state,
      task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "self-modify.apply",
      target,
      scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
      approvals: [approval],
      proposerId: "agent:coder",
      approverId: "human",
      clock,
    });

    expect(() =>
      applySelfModification({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
        approvals: [approval],
        proposerId: "agent:coder",
        approverId: "agent:coder",
        selfModification: {
          producedBy: "agent:coder",
          baseHash,
          payloadHash,
          affectedFiles: [target],
          proposedContent,
        },
        clock,
      }),
    ).toThrow(VibeKitError);

    writeFile(root, target, "someone else changed the base\n");
    expect(() =>
      applySelfModification({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
        approvals: [approval],
        proposerId: "agent:coder",
        approverId: "human",
        selfModification: {
          producedBy: "agent:coder",
          baseHash,
          payloadHash,
          affectedFiles: [target],
          proposedContent,
        },
        clock,
      }),
    ).toThrow(VibeKitError);
    try {
      applySelfModification({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
        approvals: [approval],
        proposerId: "agent:coder",
        approverId: "human",
        selfModification: {
          producedBy: "agent:coder",
          baseHash,
          payloadHash,
          affectedFiles: [target],
          proposedContent,
        },
        clock,
      });
    } catch (error) {
      expect((error as VibeKitError).code).toBe("self_modification_base_mismatch");
    }

    writeFile(root, target, "base instructions\n");
    expect(() =>
      applySelfModification({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
        approvals: [approval],
        proposerId: "agent:coder",
        approverId: "human",
        selfModification: {
          producedBy: "agent:coder",
          baseHash,
          payloadHash,
          affectedFiles: [target],
          proposedContent: { [target]: "tampered payload\n" },
        },
        clock,
      }),
    ).toThrow(VibeKitError);
    try {
      applySelfModification({
        state,
        projectRoot: root,
        task: accepted.task,
        result: ran.result,
        verifications: [ran.verification],
        required: ["verifier:command"],
        action: "self-modify.apply",
        target,
        scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
        approvals: [approval],
        proposerId: "agent:coder",
        approverId: "human",
        selfModification: {
          producedBy: "agent:coder",
          baseHash,
          payloadHash,
          affectedFiles: [target],
          proposedContent: { [target]: "tampered payload\n" },
        },
        clock,
      });
    } catch (error) {
      expect((error as VibeKitError).code).toBe("self_modification_payload_mismatch");
    }

    const applied = applySelfModification({
      state,
      projectRoot: root,
      task: accepted.task,
      result: ran.result,
      verifications: [ran.verification],
      required: ["verifier:command"],
      action: "self-modify.apply",
      target,
      scope: { revision: computeCandidateRevision(ran.result), baseHash, payloadHash },
      approvals: [approval],
      proposerId: "agent:coder",
      approverId: "human",
      selfModification: {
        producedBy: "agent:coder",
        baseHash,
        payloadHash,
        affectedFiles: [target],
        proposedContent,
      },
      clock,
    });
    expect(applied.applied).toBe(true);
    expect(applied.written).toEqual([target]);
    expect(readFile(root, target)).toBe("updated instructions\n");
  });
});

describe("command verifier payload", () => {
  it("runs a declared command and records the exit code", () => {
    const { root } = setupScenario();
    expect(executeCommandVerifier({ command: PASSING_COMMAND, cwd: root }).exitCode).toBe(0);
    expect(executeCommandVerifier({ command: FAILING_COMMAND, cwd: root }).exitCode).toBe(1);
  });

  it("exposes a Pi hook that calls core verification", () => {
    const { root, state, task, result } = setupScenario();
    const ran = verifyAfterRun({
      state,
      task,
      result,
      command: PASSING_COMMAND,
      cwd: root,
      now: clock,
    });
    expect(ran.verification.verifierId).toBe("verifier:command");
    expect(hookEvaluate({ result: ran.result, verifications: [ran.verification] }).completed).toBe(
      true,
    );
  });
});
