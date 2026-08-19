import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  formatRuntimeId,
  loadRegistry,
  localRegistrySource,
  writeInstalledManifest,
  writeProjectDocument,
  type ApprovalDocument,
} from "@useagentsio/core";
import { conversationKeyOf } from "@useagentsio/interface-sdk";
import { VibeKitHost } from "@useagentsio/host";
import type { CreatePiSession, PiSession } from "@useagentsio/pi";
import { describe, expect, it, vi } from "vitest";

import { buildTempRegistry, makeTempDir } from "../helpers.js";

function mockCreateSession(
  onPrompt: (options: Parameters<CreatePiSession>[0]) => Promise<void>,
  onDispose?: () => void,
): CreatePiSession {
  return async (options) => {
    const session: PiSession = {
      async prompt() {
        await onPrompt(options);
      },
      subscribe() {
        return () => {};
      },
      async abort() {
        // no-op test implementation
      },
      dispose() {
        onDispose?.();
      },
    };
    return session;
  };
}

describe("Host persistent turn tool execution with durable approvals", () => {
  it("enforces exact durable approval lookup on explicit authorization", async () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "file-editor",
        capabilities: ["source.write"],
        runtime: {
          kind: "package",
          package: "@test/file-editor",
          export: "createFileEditorTool",
        },
      },
    ]);

    const dir = makeTempDir("vibekit-host-approvals-");

    // Project with explicit authorization for source.write
    const project = {
      ...createDefaultProject({ slug: "approvals-demo", name: "Approvals Demo", defaultAgent: "chief" }),
      defaults: { model: { provider: "openai", id: "gpt-4.1" } },
      agentBindings: { chief: { definition: "agent:chief" as const } },
      capabilityBindings: { "source.write": "tool:file-editor" as const },
      interfaceBindings: {
        "terminal-main": {
          definition: "interface:terminal" as const,
          enabled: false,
          defaultAgent: "chief",
        },
      },
      authorization: {
        default: "standing" as const,
        actions: {
          "source.write": "explicit" as const,
        },
      },
    };
    writeProjectDocument(dir, project);

    const agentDir = path.join(dir, ".vibekit/agents/chief");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "instructions.md"), "# Chief\n", "utf8");
    fs.writeFileSync(
      path.join(agentDir, "agent.yaml"),
      `schemaVersion: 1
id: agent:chief
type: agent
name: chief
displayName: Chief
version: 1.0.0
description: Chief agent
compatibility:
  vibekit: "^1.0.0"
  pi: ">=0.50.0"
instructions: instructions.md
model:
  provider: inherit
  id: inherit
  allowProjectOverride: true
  allowTaskOverride: false
components:
  required: []
  optional: []
  recommended: []
capabilities:
  requires:
    - source.write
inputs:
  required:
    - objective
  optional: []
outputs:
  required:
    - summary
permissions:
  allow:
    - capability: source.write
      scope:
        paths: ["**"]
  deny: []
delegation:
  allowed: false
  targets: []
  maxDepth: 1
  maxParallelChildren: 1
execution:
  isolation: process
  timeoutMs: 60000
  cleanupRequired: false
state:
  read: []
  write: []
verification:
  required: []
  independentReview: false
completion:
  requires:
    - result-recorded
escalation:
  on:
    - permission-denied
files: []
`,
      "utf8",
    );

    // Mock package in node_modules
    const pkgDir = path.join(dir, "node_modules", "@test", "file-editor");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@test/file-editor", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(pkgDir, "index.js"),
      `
module.exports = {
  createFileEditorTool: () => ({
    name: "edit_file",
    description: "Edits a file",
    parameters: { type: "object" },
    execute: async (args) => {
      return { success: true, path: args.path };
    }
  })
};
`,
      "utf8",
    );

    // Write package.json in project
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@test/file-editor": "1.0.0" } }),
      "utf8",
    );

    const reg = loadRegistry(registryRoot, localRegistrySource(registryRoot));
    const checksum =
      reg.index.modules.find((m) => m.id === "tool:file-editor")?.checksum ??
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    const manifest = {
      ...emptyInstalledManifest(),
      modules: [
        {
          schemaVersion: 1 as const,
          id: "tool:file-editor" as const,
          version: "1.0.0",
          registrySource: localRegistrySource(registryRoot),
          sourceRevision: "test",
          integrityChecksum: checksum,
          installedAt: "2026-08-19T00:00:00.000Z",
          dependencies: [],
          files: [],
          configurationPaths: [],
          compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
        },
      ],
    };
    writeInstalledManifest(dir, manifest);

    const conversationKey = conversationKeyOf({
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
    });

    const expectedTaskId = formatRuntimeId("task", "550e8400-e29b-41d4-a716-446655440001");
    const resultId = formatRuntimeId("result", "550e8400-e29b-41d4-a716-446655440002");

    // Control the task UUID generated in createInboundTask
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("550e8400-e29b-41d4-a716-446655440001");

    // 1. Without Approval, execution should fail with approval_required and dispose() must run
    let disposedTurn1 = false;
    const host1 = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      createSession: mockCreateSession(
        async (sessionOptions) => {
          const tool = sessionOptions.customTools?.find((t) => t.name === "edit_file");
          if (tool) {
            await tool.execute({ path: "src/main.ts", action: "source.write" });
          }
        },
        () => {
          disposedTurn1 = true;
        },
      ),
    });

    await expect(
      host1.submit({
        eventId: "evt-1",
        interfaceBinding: "terminal-main",
        accountId: "local",
        conversationId: "cli",
        conversationKey,
        sender: { id: "local", trusted: true },
        text: "edit the file",
        attachments: [],
        timestamp: "2026-08-19T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    expect(disposedTurn1).toBe(true);
    await host1.stop();

    // Helper to test approval variations
    async function testApprovalVariant(approvalMod: Partial<ApprovalDocument>): Promise<boolean> {
      let executed = false;
      let disposed = false;
      const host = await VibeKitHost.start({
        projectRoot: dir,
        startInterfaces: false,
        createSession: mockCreateSession(
          async (sessionOptions) => {
            const tool = sessionOptions.customTools?.find((t) => t.name === "edit_file");
            if (tool) {
              await tool.execute({ path: "src/main.ts", action: "source.write" });
              executed = true;
            }
          },
          () => {
            disposed = true;
          },
        ),
      });

      const approval: ApprovalDocument = {
        schemaVersion: 1,
        id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440010"),
        projectId: project.id,
        action: "tool:file-editor / source.write",
        target: "src/main.ts",
        scope: { path: "src/main.ts", capability: "source.write" },
        taskId: expectedTaskId,
        resultId,
        status: "approved",
        requestedAuthority: "human",
        requestedAt: "2026-08-19T12:00:00.000Z",
        decidedAt: "2026-08-19T12:00:01.000Z",
        expiresAt: null,
        ...approvalMod,
      };

      const stateObj = (host as unknown as { state: { approvals: { create: (doc: ApprovalDocument) => void } } }).state;
      stateObj.approvals.create(approval);

      try {
        await host.submit({
          eventId: `evt-${Math.random()}`,
          interfaceBinding: "terminal-main",
          accountId: "local",
          conversationId: "cli",
          conversationKey,
          sender: { id: "local", trusted: true },
          text: "edit the file",
          attachments: [],
          timestamp: "2026-08-19T12:00:02.000Z",
        });
      } catch (error) {
        expect(disposed).toBe(true);
        await host.stop();
        throw error;
      }

      expect(disposed).toBe(true);
      await host.stop();
      return executed;
    }

    // 2. Approval with wrong action -> approval_required
    await expect(
      testApprovalVariant({
        id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440021"),
        action: "tool:other / source.write",
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    // 3. Approval with wrong target -> approval_required
    await expect(
      testApprovalVariant({
        id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440022"),
        target: "src/other.ts",
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    // 4. Approval with wrong scope -> approval_required
    await expect(
      testApprovalVariant({
        id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440023"),
        scope: { path: "src/other.ts", capability: "source.write" },
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    // 5. Approval with wrong taskId -> approval_required
    await expect(
      testApprovalVariant({
        id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440024"),
        taskId: formatRuntimeId("task", "550e8400-e29b-41d4-a716-999999999999"),
      }),
    ).rejects.toMatchObject({ code: "approval_required" });

    // 6. Exact matching durable Approval -> succeeds and executes tool
    const success = await testApprovalVariant({
      id: formatRuntimeId("approval", "550e8400-e29b-41d4-a716-446655440025"),
    });
    expect(success).toBe(true);

    vi.restoreAllMocks();
  });
});
