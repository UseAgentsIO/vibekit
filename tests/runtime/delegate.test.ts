import fs from "node:fs";
import path from "node:path";

import {
  parseAndValidateYaml,
  stringifyYaml,
  VibeKitError,
  type AgentDocument,
  type TaskDocument,
} from "@useagentsio/core";
import {
  createAgentDelegateTool,
  detectDelegationCycle,
  executeDelegation,
  prepareIsolatedRun,
  validateDelegation,
  type CreatePiSession,
  type DelegationGraphContext,
  type PiSession,
  type PiSessionEvent,
} from "@useagentsio/pi";
import { afterEach, describe, expect, it } from "vitest";

import { readFixture } from "../helpers.js";
import { writeRuntimeFixture, type RuntimeFixture } from "./helpers.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent_delegate registration and validation", () => {
  it("registers agent_delegate only when the Agent has agent.delegate", () => {
    const coder = writeRuntimeFixture();
    temps.push(coder.root);
    const coderPrepared = prepareIsolatedRun({
      projectRoot: coder.root,
      bindingName: "coder",
      task: coder.task,
    });
    expect(coderPrepared.configuration.tools).not.toContain("agent_delegate");

    const chief = writeChiefFixture();
    const chiefPrepared = prepareIsolatedRun({
      projectRoot: chief.root,
      bindingName: "chief",
      task: chief.task,
    });
    expect(chiefPrepared.configuration.tools).toContain("agent_delegate");
  });

  it("rejects unauthorized delegation when the Agent contract forbids it", () => {
    const fixture = writeRuntimeFixture();
    temps.push(fixture.root);
    expect(() =>
      validateDelegation(
        { targetBinding: "reviewer", objective: "Review the change" },
        graphContext(fixture, {
          parentAgent: fixture.agent,
          parentBinding: "coder",
        }),
      ),
    ).toThrow(VibeKitError);
    try {
      validateDelegation(
        { targetBinding: "reviewer", objective: "Review the change" },
        graphContext(fixture, {
          parentAgent: fixture.agent,
          parentBinding: "coder",
        }),
      );
    } catch (error) {
      expect((error as VibeKitError).category).toBe("permission_denied");
      expect((error as VibeKitError).code).toBe("delegation_unauthorized");
    }
  });

  it("rejects a target the Project relationship does not allow", () => {
    const fixture = writeChiefFixture({
      projectDelegation: { chief: [], coder: [], reviewer: [] },
    });
    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Implement the slice" },
        graphContext(fixture),
      ),
    ).toThrow(/Project does not allow/);
  });

  it("rejects a target missing from the Project bindings", () => {
    const fixture = writeChiefFixture();
    expect(() =>
      validateDelegation(
        { targetBinding: "designer", objective: "Design the UI" },
        graphContext(fixture, {
          parentAgent: {
            ...chiefAgent(),
            delegation: {
              allowed: true,
              targets: ["coder", "designer"],
              maxDepth: 2,
              maxParallelChildren: 4,
            },
          },
        }),
      ),
    ).toThrow(VibeKitError);
    try {
      validateDelegation(
        { targetBinding: "designer", objective: "Design the UI" },
        graphContext(fixture, {
          parentAgent: {
            ...chiefAgent(),
            delegation: {
              allowed: true,
              targets: ["coder", "designer"],
              maxDepth: 2,
              maxParallelChildren: 4,
            },
          },
        }),
      );
    } catch (error) {
      expect((error as VibeKitError).code).toBe("delegation_target_missing");
    }
  });

  it("rejects delegation when the current Task forbids it", () => {
    const fixture = writeChiefFixture({
      task: { constraints: ["no-delegation"] },
    });
    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Implement the slice" },
        graphContext(fixture),
      ),
    ).toThrow(/does not permit delegation/);
  });

  it("rejects a self-cycle and an ancestor cycle", () => {
    const fixture = writeChiefFixture({
      projectDelegation: { chief: ["chief", "coder"], coder: ["chief"], reviewer: [] },
    });
    expect(
      detectDelegationCycle({
        parentBinding: "chief",
        targetBinding: "chief",
        graph: fixture.project.delegation,
      }),
    ).toBe(true);
    expect(() =>
      validateDelegation(
        { targetBinding: "chief", objective: "Talk to yourself" },
        graphContext(fixture, {
          parentAgent: {
            ...chiefAgent(),
            delegation: {
              allowed: true,
              targets: ["chief", "coder"],
              maxDepth: 2,
              maxParallelChildren: 4,
            },
          },
        }),
      ),
    ).toThrow(/cycle/i);

    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Loop back" },
        graphContext(fixture, { ancestorBindings: ["coder"] }),
      ),
    ).toThrow(/cycle/i);
  });

  it("rejects a Project delegation graph that can return to an ancestor", () => {
    const fixture = writeChiefFixture({
      projectDelegation: { chief: ["coder"], coder: ["chief"], reviewer: [] },
    });
    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Implement the slice" },
        graphContext(fixture),
      ),
    ).toThrow(VibeKitError);
    try {
      validateDelegation(
        { targetBinding: "coder", objective: "Implement the slice" },
        graphContext(fixture),
      );
    } catch (error) {
      expect((error as VibeKitError).code).toBe("delegation_cycle");
    }
  });

  it("rejects delegation that exceeds max depth or max children", () => {
    const fixture = writeChiefFixture();
    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Too deep" },
        graphContext(fixture, { depth: 2 }),
      ),
    ).toThrow(/depth/);
    expect(() =>
      validateDelegation(
        { targetBinding: "coder", objective: "Too many children" },
        graphContext(fixture, { activeChildCount: 4 }),
      ),
    ).toThrow(/children/);
  });

  it("executes an authorized child Run with bounded context only", async () => {
    const fixture = writeChiefFixture();
    const seen: Array<{ systemPrompt: string; tools: readonly string[] }> = [];
    const { session } = mockSession({});
    const createSession: CreatePiSession = async (options) => {
      seen.push({ systemPrompt: options.systemPrompt, tools: options.tools });
      return session;
    };

    const outcome = await executeDelegation(
      {
        targetBinding: "coder",
        objective: "CHILD_OBJECTIVE_ONLY",
        context: "child-context-ref",
        constraints: ["stay-in-scope"],
        expectedOutput: "Return a Result summary",
      },
      {
        ...graphContext(fixture),
        projectRoot: fixture.root,
        createSession,
      },
    );

    expect(outcome.validated.targetBinding).toBe("coder");
    expect(outcome.childTask.objective).toBe("CHILD_OBJECTIVE_ONLY");
    expect(outcome.childTask.objective).not.toBe(fixture.task.objective);
    expect(outcome.child.duplicate).toBe(false);
    expect(outcome.child.status).toBe("completed");
    expect(outcome.child.context?.objective).toBe("CHILD_OBJECTIVE_ONLY");
    expect(outcome.child.context?.userPrompt).toContain("CHILD_OBJECTIVE_ONLY");
    expect(outcome.child.context?.userPrompt).not.toContain("PARENT_OBJECTIVE_DO_NOT_LEAK");
    expect(outcome.child.context?.systemPrompt).not.toContain("PARENT_ONLY_CONTEXT_TOKEN");
    expect(seen[0]?.systemPrompt).not.toContain("PARENT_ONLY_CONTEXT_TOKEN");
    expect(seen[0]?.systemPrompt).not.toContain("PARENT_OBJECTIVE_DO_NOT_LEAK");
    expect(seen[0]?.tools).not.toContain("agent_delegate");
  });

  it("exposes agent_delegate as a callable tool that validates before execute", async () => {
    const fixture = writeChiefFixture();
    const tool = createAgentDelegateTool({
      execute: (request) => validateDelegation(request, graphContext(fixture)),
    });
    expect(tool.name).toBe("agent_delegate");
    await expect(tool.execute({ objective: "missing target" })).rejects.toBeInstanceOf(
      VibeKitError,
    );
    const validated = await tool.execute({
      targetBinding: "coder",
      objective: "Implement the slice",
    });
    expect(validated.targetBinding).toBe("coder");
  });
});

function graphContext(
  fixture: RuntimeFixture,
  overrides: Partial<DelegationGraphContext> = {},
): DelegationGraphContext {
  return {
    project: fixture.project,
    parentAgent: fixture.agent,
    parentBinding: fixture.bindingName,
    parentTask: fixture.task,
    depth: 0,
    ancestorBindings: [],
    activeChildCount: 0,
    ...overrides,
  };
}

function writeChiefFixture(
  options: {
    readonly projectDelegation?: Record<string, readonly string[]>;
    readonly task?: Partial<TaskDocument>;
  } = {},
): RuntimeFixture {
  const fixture = writeRuntimeFixture({
    bindingName: "chief",
    agent: chiefAgent(),
    instructions: "PARENT_ONLY_CONTEXT_TOKEN\nCompose work by delegating bounded Tasks.\n",
    project: {
      capabilityBindings: {
        "source.read": "tool:filesystem",
        "source.write": "tool:filesystem",
        "command.execute": "tool:execution",
        "repository.read": "tool:github",
        "repository.write": "tool:github",
        "agent.delegate": "tool:execution",
      },
      delegation: options.projectDelegation ?? {
        chief: ["coder", "reviewer"],
        coder: [],
        reviewer: [],
        researcher: [],
      },
    },
    task: {
      assignedAgent: "agent:chief",
      objective: "PARENT_OBJECTIVE_DO_NOT_LEAK",
      ...options.task,
    },
  });
  temps.push(fixture.root);
  writeBoundAgent(fixture.root, "coder", coderAgent(), "# Coder\n\nStay inside the Task scope.\n");
  return { ...fixture, agent: chiefAgent() };
}

function writeBoundAgent(
  root: string,
  binding: string,
  agent: AgentDocument,
  instructions: string,
): void {
  const directory = path.join(root, ".vibekit", "agents", binding);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "agent.yaml"), stringifyYaml(agent), "utf8");
  fs.writeFileSync(path.join(directory, "instructions.md"), instructions, "utf8");
}

function chiefAgent(): AgentDocument {
  const base = coderAgent();
  return {
    ...base,
    id: "agent:chief",
    name: "chief",
    displayName: "Chief",
    description: "Delegates bounded work to other Agents.",
    capabilities: { requires: ["source.read", "agent.delegate"] },
    inputs: { required: ["objective", "constraints"] },
    permissions: {
      allow: [
        { capability: "source.read", scope: { paths: ["**"] } },
        { capability: "agent.delegate", scope: { resources: ["coder", "reviewer"] } },
      ],
      deny: [
        { capability: "source.write" },
        { capability: "project.configure" },
        { capability: "module.install" },
        { capability: "deploy.apply" },
      ],
    },
    delegation: {
      allowed: true,
      targets: ["coder", "reviewer"],
      maxDepth: 2,
      maxParallelChildren: 4,
    },
    execution: { isolation: "process", timeoutMs: 600000, cleanupRequired: true },
  };
}

function coderAgent(): AgentDocument {
  const parsed = parseAndValidateYaml("agent", readFixture("valid", "agent-coder.yaml"));
  if (!parsed.valid || parsed.data === undefined) {
    throw new Error("coder fixture is invalid");
  }
  return parsed.data;
}

function mockSession(options: {
  readonly text?: string;
  readonly prompt?: (text: string) => Promise<void>;
}): { session: PiSession } {
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
              summary: `Delegated: ${text.slice(0, 24)}`,
              artifacts: [],
              evidence: [],
            }),
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
