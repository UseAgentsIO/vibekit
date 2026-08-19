import {
  VibeKitError,
  authorizeInvocation,
  createDefaultProject,
  invocationFromToolCall,
  resolveEffectiveAuthority,
  type AgentDocument,
  type ApprovalDocument,
  type InstalledCapabilityProvider,
  type ProjectDocument,
  type TaskDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

function agent(overrides: Partial<AgentDocument> = {}): AgentDocument {
  return {
    schemaVersion: 1,
    id: "agent:worker",
    type: "agent",
    name: "worker",
    version: "1.0.0",
    description: "test",
    instructions: "do work",
    model: {
      provider: "openai",
      id: "gpt-4",
      allowProjectOverride: true,
      allowTaskOverride: false,
    },
    components: { required: [], optional: [], recommended: [] },
    capabilities: { requires: ["source.read", "web.fetch"] },
    inputs: { required: [], optional: [] },
    outputs: { required: [], optional: [] },
    permissions: {
      allow: [{ capability: "source.read" }, { capability: "web.fetch" }],
      deny: [],
    },
    delegation: { allowed: false, targets: [], maxDepth: 0, maxParallelChildren: 0 },
    state: { read: [], write: [] },
    execution: { isolation: "process", timeoutMs: 60000, cleanupRequired: false },
    verification: { required: [], independentReview: false },
    completion: { requires: [] },
    escalation: { on: [] },
    ...overrides,
  } as AgentDocument;
}

function project(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  const base = createDefaultProject({ slug: "auth", name: "auth" });
  return {
    ...base,
    policies: ["policy:least-privilege"],
    capabilityBindings: {},
    authorization: {
      default: "standing",
      actions: { ...base.authorization.actions },
    },
    ...overrides,
  };
}

function task(overrides: Partial<TaskDocument> = {}): TaskDocument {
  return {
    schemaVersion: 1,
    id: "task_550e8400-e29b-41d4-a716-446655440000",
    projectId: "project:auth",
    objective: "do it",
    context: { references: [] },
    constraints: [],
    acceptanceCriteria: [],
    requiredCapabilities: [],
    assignedAgent: "agent:worker",
    claimedBy: null,
    scope: { paths: [], resources: [] },
    dependencies: [],
    priority: "normal",
    delivery: { mode: "apply" },
    authorization: { state: "standing" },
    status: "open",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalDocument> = {}): ApprovalDocument {
  return {
    schemaVersion: 1,
    id: "approval_550e8400-e29b-41d4-a716-446655440000",
    projectId: "project:auth",
    action: "tool:filesystem / source.write",
    target: "src/foo.ts",
    scope: { path: "src/foo.ts", capability: "source.write" },
    taskId: "task_550e8400-e29b-41d4-a716-446655440000",
    resultId: "result_550e8400-e29b-41d4-a716-446655440000",
    status: "approved",
    requestedAuthority: "human",
    requestedAt: "2026-01-01T00:00:00.000Z",
    decidedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

const web: InstalledCapabilityProvider = {
  id: "tool:web",
  capabilities: ["web.fetch"],
  type: "tool",
  runtimeKind: "pi-extension",
};
const filesystem: InstalledCapabilityProvider = {
  id: "tool:filesystem",
  capabilities: ["source.read", "source.write"],
  type: "tool",
  runtimeKind: "pi-builtin",
};

describe("resolveEffectiveAuthority", () => {
  it("does not expose an installed custom Tool without an effective binding", () => {
    const authority = resolveEffectiveAuthority({
      project: project(),
      agent: agent({
        capabilities: { requires: ["source.read"] },
        permissions: { allow: [{ capability: "source.read" }], deny: [] },
      }),
      task: task(),
      installedProviders: [filesystem, web],
    });
    expect(authority.toolModuleIds).not.toContain("tool:web");
    expect(authority.capabilities).toEqual(["source.read"]);
    expect(authority.builtinTools).toEqual(expect.arrayContaining(["read"]));
  });

  it("does not expose a Tool capability denied by the Agent", () => {
    const authority = resolveEffectiveAuthority({
      project: project({ capabilityBindings: { "web.fetch": "tool:web" } }),
      agent: agent({
        capabilities: { requires: ["web.fetch"] },
        permissions: { allow: [], deny: [{ capability: "web.fetch" }] },
      }),
      task: task(),
      installedProviders: [web],
    });
    expect(authority.toolModuleIds).toEqual([]);
    expect(authority.capabilities).toEqual([]);
  });

  it("drops Agent capabilities outside Task requiredCapabilities", () => {
    const authority = resolveEffectiveAuthority({
      project: project({
        capabilityBindings: { "source.read": "tool:filesystem", "web.fetch": "tool:web" },
      }),
      agent: agent(),
      task: task({ requiredCapabilities: ["source.read"] }),
      installedProviders: [filesystem, web],
    });
    expect(authority.capabilities).toEqual(["source.read"]);
    expect(authority.toolModuleIds).not.toContain("tool:web");
  });

  it("keeps explicit mutating capabilities until invocation-time Approval", () => {
    const authority = resolveEffectiveAuthority({
      project: project({
        capabilityBindings: { "memory.write": "tool:memory" },
        authorization: {
          default: "deny",
          actions: { "memory.write": "explicit" },
        },
      }),
      agent: agent({
        capabilities: { requires: ["memory.write"] },
        permissions: { allow: [{ capability: "memory.write" }], deny: [] },
      }),
      task: task({ authorization: { state: "explicit" } }),
      installedProviders: [
        { id: "tool:memory", capabilities: ["memory.write"], type: "tool", runtimeKind: "pi-extension" },
      ],
    });
    expect(authority.capabilities).toEqual(["memory.write"]);
    expect(authority.grants["memory.write"]?.authorization).toBe("explicit");
  });

  it("never grants filesystem or bash when no Component providers are installed", () => {
    expect(() =>
      resolveEffectiveAuthority({
        project: project(),
        agent: agent({
          capabilities: { requires: ["source.read", "source.write", "command.execute"] },
          permissions: {
            allow: [
              { capability: "source.read" },
              { capability: "source.write" },
              { capability: "command.execute" },
            ],
            deny: [],
          },
        }),
        task: task(),
        installedProviders: [],
      }),
    ).toThrow(/capability_unresolved|No installed Module provides/);
  });

  it("policy:schedule-no-recurse removes schedule grants on scheduled Runs", () => {
    const authority = resolveEffectiveAuthority({
      project: project({
        policies: ["policy:least-privilege", "policy:schedule-no-recurse"],
        capabilityBindings: { "schedule.write": "tool:scheduler" },
      }),
      agent: agent({
        capabilities: { requires: ["schedule.write"] },
        permissions: { allow: [{ capability: "schedule.write" }], deny: [] },
      }),
      task: task(),
      installedProviders: [
        {
          id: "tool:scheduler",
          capabilities: ["schedule.read", "schedule.write"],
          type: "tool",
          runtimeKind: "pi-extension",
        },
      ],
      scheduledRun: true,
    });
    expect(authority.toolModuleIds).toEqual([]);
    expect(authority.capabilities).toEqual([]);
  });

  it("intersects Coder write paths with a narrower Task scope", () => {
    const authority = resolveEffectiveAuthority({
      project: project({ capabilityBindings: { "source.write": "tool:filesystem" } }),
      agent: agent({
        capabilities: { requires: ["source.write"] },
        permissions: {
          allow: [{ capability: "source.write", scope: { paths: ["src/**", "tests/**"] } }],
          deny: [],
        },
      }),
      task: task({ scope: { paths: ["src/hello.ts"], resources: [] } }),
      installedProviders: [filesystem],
    });
    expect(authority.grants["source.write"]?.scope.paths).toEqual(["src/hello.ts"]);
  });

  it("rejects a capability binding to a Module that does not provide it", () => {
    expect(() =>
      resolveEffectiveAuthority({
        project: project({ capabilityBindings: { "web.fetch": "tool:scheduler" } }),
        agent: agent({
          capabilities: { requires: ["web.fetch"] },
          permissions: { allow: [{ capability: "web.fetch" }], deny: [] },
        }),
        task: task(),
        installedProviders: [web],
      }),
    ).toThrow(VibeKitError);
  });
});

describe("authorizeInvocation", () => {
  const coderAgent = agent({
    capabilities: { requires: ["source.write", "command.execute"] },
    permissions: {
      allow: [
        { capability: "source.write", scope: { paths: ["src/**", "tests/**"] } },
        { capability: "command.execute", scope: { commands: ["project-verification"] } },
      ],
      deny: [],
    },
  });

  it("rejects writes outside the Agent grant paths", () => {
    const authority = resolveEffectiveAuthority({
      project: project({
        capabilityBindings: { "source.write": "tool:filesystem", "command.execute": "tool:execution" },
      }),
      agent: coderAgent,
      task: task(),
      installedProviders: [
        filesystem,
        { id: "tool:execution", capabilities: ["command.execute"], type: "tool", runtimeKind: "pi-builtin" },
      ],
    });
    expect(() =>
      authorizeInvocation({
        authority,
        invocation: invocationFromToolCall({
          toolName: "write",
          args: { path: "README.md" },
          authority,
        }),
        project: project(),
        task: task(),
      }),
    ).toThrow(/path_not_in_scope|outside the effective grant/);
  });

  it("rejects writes outside a narrower Task scope", () => {
    const proj = project({
      capabilityBindings: { "source.write": "tool:filesystem", "command.execute": "tool:execution" },
    });
    const scoped = task({ scope: { paths: ["src/hello.ts"], resources: [] } });
    const authority = resolveEffectiveAuthority({
      project: proj,
      agent: coderAgent,
      task: scoped,
      installedProviders: [
        filesystem,
        { id: "tool:execution", capabilities: ["command.execute"], type: "tool", runtimeKind: "pi-builtin" },
      ],
    });
    expect(() =>
      authorizeInvocation({
        authority,
        invocation: invocationFromToolCall({
          toolName: "write",
          args: { path: "src/other.ts" },
          authority,
        }),
        project: proj,
        task: scoped,
      }),
    ).toThrow(/path_not_in_scope|outside the effective grant/);
  });

  it("rejects commands outside the Agent command grant", () => {
    const proj = project({
      capabilityBindings: { "source.write": "tool:filesystem", "command.execute": "tool:execution" },
    });
    const authority = resolveEffectiveAuthority({
      project: proj,
      agent: coderAgent,
      task: task(),
      installedProviders: [
        filesystem,
        { id: "tool:execution", capabilities: ["command.execute"], type: "tool", runtimeKind: "pi-builtin" },
      ],
    });
    expect(() =>
      authorizeInvocation({
        authority,
        invocation: invocationFromToolCall({
          toolName: "bash",
          args: { command: "rm -rf /" },
          authority,
        }),
        project: proj,
        task: task(),
      }),
    ).toThrow(/command_not_in_scope|outside the effective grant/);
  });

  it("does not let an Approval for action A authorize action B", () => {
    const proj = project({
      capabilityBindings: { "source.write": "tool:filesystem" },
      authorization: { default: "deny", actions: { "source.write": "explicit" } },
    });
    const currentTask = task({
      authorization: { state: "explicit" },
      requiredCapabilities: ["source.write"],
    });
    const authority = resolveEffectiveAuthority({
      project: proj,
      agent: agent({
        capabilities: { requires: ["source.write"] },
        permissions: { allow: [{ capability: "source.write", scope: { paths: ["src/**"] } }], deny: [] },
      }),
      task: currentTask,
      installedProviders: [filesystem],
    });
    expect(() =>
      authorizeInvocation({
        authority,
        invocation: {
          capability: "source.write",
          action: "tool:filesystem / source.write",
          target: "src/bar.ts",
          requestedScope: { path: "src/bar.ts", capability: "source.write" },
        },
        project: proj,
        task: currentTask,
        approvals: [approval()],
      }),
    ).toThrow(/Explicit Approval is required/);
  });
});
