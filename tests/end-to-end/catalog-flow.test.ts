import fs from "node:fs";

import {
  applyAcceptedResult,
  createProposal,
  formatRuntimeId,
  isVibeKitError,
  readProjectDocument,
  recordIndependentReview,
  runCommandVerification,
  writeProjectDocument,
  type ProjectDocument,
  type TaskDocument,
} from "@useagentsio/core";
import {
  executeDelegation,
  loadAgentDocument,
  openProjectState,
  runManaged,
  type CreatePiSession,
  type PiSession,
  type PiSessionEvent,
} from "@useagentsio/pi";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

const ARTIFACT_REVISION = "a1b2c3d4e5f6789012345678901234567890abcd";
const PASSING_COMMAND = "node -e \"process.exit(0)\"";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("official catalog Chief → coder → reviewer", () => {
  it("runs a mocked composition through verification and the proposal path", async () => {
    const dir = await initCatalogProject();
    await addOfficial(dir, "agent", "chief");
    await addOfficial(dir, "agent", "coder");
    await addOfficial(dir, "agent", "reviewer");
    await addOfficial(dir, "policy", "require-verification");

    const project = await bindComposition(dir);
    const state = openProjectState({ projectRoot: dir, project });
    const task = state.tasks.create(chiefTask(project.id)).document;
    const createSession = mockCreateSession();

    const chief = await runManaged({
      projectRoot: dir,
      bindingName: "chief",
      task,
      project,
      state,
      createSession,
    });
    expect(chief.status).toBe("completed");
    expect(chief.duplicate).toBe(false);
    expect(chief.result?.agentId).toBe("agent:chief");
    expect(chief.configuration?.tools).toContain("agent_delegate");

    const parentAgent = loadAgentDocument({
      projectRoot: dir,
      project,
      bindingName: "chief",
    });

    const coder = await executeDelegation(
      {
        targetBinding: "coder",
        objective: "Add a greeting helper under src/",
        context: ["candidate-for-review"],
        constraints: ["stay-in-src"],
        expectedOutput: "Result with artifacts",
      },
      {
        project,
        parentAgent,
        parentBinding: "chief",
        parentTask: task,
        depth: 0,
        ancestorBindings: [],
        activeChildCount: 0,
        projectRoot: dir,
        state,
        createSession,
      },
    );
    expect(coder.child.status).toBe("completed");
    expect(coder.child.result?.agentId).toBe("agent:coder");
    expect(coder.child.configuration?.tools).not.toContain("agent_delegate");
    expect(coder.child.result?.artifacts[0]?.path).toBe("src/greeting.ts");
    const coderResult =
      state.results.tryGet(coder.child.result!.id)?.document ??
      state.results.create(coder.child.result!).document;

    const command = runCommandVerification({
      state,
      task: coder.childTask,
      result: coderResult,
      command: PASSING_COMMAND,
      cwd: dir,
    });
    expect(command.verification.status).toBe("passed");
    expect(command.verification.verifierId).toBe("verifier:command");

    expect(() =>
      recordIndependentReview({
        state,
        task: coder.childTask,
        result: command.result,
        reviewerId: "agent:coder",
        verdict: "passed",
      }),
    ).toThrow(/independent_review_self|MUST NOT/);
    try {
      recordIndependentReview({
        state,
        task: coder.childTask,
        result: command.result,
        reviewerId: "agent:coder",
        verdict: "passed",
      });
    } catch (error) {
      expect(isVibeKitError(error)).toBe(true);
      if (isVibeKitError(error)) {
        expect(error.code).toBe("independent_review_self");
      }
    }

    const review = await executeDelegation(
      {
        targetBinding: "reviewer",
        objective: "Independently review the coder candidate",
        context: [
          `candidate:${command.result.id}`,
          `producingAgent:${command.result.agentId}`,
        ],
        constraints: ["do-not-write-source"],
        expectedOutput: "Review findings",
      },
      {
        project,
        parentAgent,
        parentBinding: "chief",
        parentTask: task,
        depth: 0,
        ancestorBindings: [],
        activeChildCount: 0,
        projectRoot: dir,
        state,
        createSession,
      },
    );
    expect(review.child.status).toBe("completed");
    expect(review.child.result?.agentId).toBe("agent:reviewer");
    expect(review.child.result?.agentId).not.toBe(command.result.agentId);
    expect(review.child.configuration?.permissions.deny.some((grant) => grant.capability === "source.write")).toBe(
      true,
    );

    const independent = recordIndependentReview({
      state,
      task: coder.childTask,
      result: command.result,
      reviewerId: review.child.result!.agentId,
      verdict: "passed",
      summary: review.child.result?.summary,
    });
    expect(independent.verification.verifierId).toBe("agent:reviewer");
    expect(independent.verification.verifierId).not.toBe(command.result.agentId);
    expect(independent.verification.status).toBe("passed");

    const proposal = createProposal({
      task: coder.childTask,
      result: independent.result,
      verifications: [command.verification, independent.verification],
      required: ["verifier:command"],
      independentReview: true,
      project,
    });
    expect(proposal.applied).toBe(false);
    expect(proposal.delivery).toBe("proposal");
    expect(proposal.verificationPassed).toBe(true);
    expect(proposal.decision.canApply).toBe(false);

    expect(() =>
      applyAcceptedResult({
        state,
        projectRoot: dir,
        task: coder.childTask,
        result: independent.result,
        verifications: [command.verification, independent.verification],
        required: ["verifier:command"],
        independentReview: true,
        project,
      }),
    ).toThrow(/proposal|MUST NOT apply/i);
  });
});

async function initCatalogProject(): Promise<string> {
  const dir = makeTempDir("vibekit-catalog-flow-");
  temps.push(dir);
  const result = await runCli(["init", dir, "--registry", officialRegistryDir]);
  expect(result.exitCode, result.stderr).toBe(0);
  return dir;
}

async function addOfficial(dir: string, type: "agent" | "policy", name: string): Promise<void> {
  const result = await runCli([
    "add",
    type,
    name,
    "--yes",
    "--dir",
    dir,
    "--registry",
    officialRegistryDir,
  ]);
  expect(result.exitCode, result.stderr + result.stdout).toBe(0);
}

async function bindComposition(dir: string): Promise<ProjectDocument> {
  const project = readProjectDocument(dir);
  const next: ProjectDocument = {
    ...project,
    defaults: {
      ...project.defaults,
      model: project.defaults?.model ?? { provider: "openai", id: "gpt-4.1" },
    },
    capabilityBindings: {
      ...project.capabilityBindings,
      "source.read": "tool:filesystem",
      "source.write": "tool:filesystem",
      "command.execute": "tool:execution",
      "agent.delegate": "tool:execution",
    },
    delegation: {
      ...project.delegation,
      chief: ["coder", "reviewer"],
      coder: [],
      reviewer: [],
    },
  };
  writeProjectDocument(dir, next);
  const doctor = await runCli(["doctor", "--dir", dir, "--registry", officialRegistryDir]);
  expect(doctor.exitCode, doctor.stderr + doctor.stdout).toBe(0);
  return readProjectDocument(dir);
}

function chiefTask(projectId: TaskDocument["projectId"]): TaskDocument {
  return {
    schemaVersion: 1,
    id: formatRuntimeId("task", "550e8400-e29b-41d4-a716-4466554400c1"),
    projectId,
    objective: "Compose a bounded greeting change and have it reviewed",
    context: { references: [] },
    constraints: ["proposal-only"],
    acceptanceCriteria: ["greeting helper exists", "independent review passed"],
    requiredCapabilities: [],
    assignedAgent: "agent:chief",
    claimedBy: null,
    scope: { paths: ["src/**"], resources: [] },
    dependencies: [],
    priority: "normal",
    delivery: { mode: "proposal" },
    authorization: { state: "standing" },
    status: "open",
    revision: 1,
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
  };
}

function mockCreateSession(): CreatePiSession {
  return async (options) => {
    const isCoder = options.tools.includes("write");
    const isChief = options.tools.includes("agent_delegate");
    const text = isCoder
      ? JSON.stringify({
          summary: "Added greeting helper",
          artifacts: [{ path: "src/greeting.ts", revision: ARTIFACT_REVISION }],
          evidence: [{ state: "observed", source: "agent:coder", summary: "wrote src/greeting.ts" }],
          unresolvedIssues: [],
        })
      : isChief
        ? JSON.stringify({
            summary: "Delegated implementation and independent review",
            tasks: ["coder", "reviewer"],
            unresolvedIssues: [],
          })
        : JSON.stringify({
            summary: "Independent review passed",
            findings: ["candidate matches acceptance criteria"],
            evidence: [{ state: "accepted", source: "agent:reviewer", summary: "review passed" }],
            unresolvedIssues: [],
          });
    return mockSession(text);
  };
}

function mockSession(text: string): PiSession {
  let listener: ((event: PiSessionEvent) => void) | undefined;
  return {
    async prompt() {
      listener?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: text },
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
}
