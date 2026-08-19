import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  OFFICIAL_REGISTRY_SOURCE,
  resolveModule,
  stringifyYaml,
  upsertInstalledModule,
  writeInstalledManifest,
  writeProjectDocument,
  type InstalledModuleDocument,
} from "@useagentsio/core";
import { conversationKeyOf } from "@useagentsio/interface-sdk";
import { VibeKitHost } from "@useagentsio/host";
import { describe, expect, it } from "vitest";

import { makeTempDir, officialRegistryDir } from "../helpers.js";

function writeProject(dir: string) {
  const project = {
    ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
    agentBindings: { chief: { definition: "agent:chief" as const } },
    interfaceBindings: {
      "terminal-main": {
        definition: "interface:terminal" as const,
        enabled: false,
        defaultAgent: "chief",
      },
    },
  };
  writeProjectDocument(dir, project);
  writeInstalledManifest(dir, emptyInstalledManifest());
  return project;
}

describe("VibeKitHost", () => {
  it("submits a message and returns output from an injected turn", async () => {
    const dir = makeTempDir("vibekit-host-");
    writeProject(dir);
    const host = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      runTurn: async (request) => ({
        task: {
          schemaVersion: 1,
          id: "task_550e8400-e29b-41d4-a716-446655440099",
          projectId: request.project.id,
          objective: request.message.text,
          context: { references: [] },
          constraints: [],
          acceptanceCriteria: [],
          requiredCapabilities: [],
          assignedAgent: "agent:chief",
          claimedBy: null,
          scope: { paths: [], resources: [] },
          dependencies: [],
          priority: "normal",
          delivery: { mode: "apply" },
          authorization: { state: "standing" },
          status: "open",
          revision: 1,
          createdAt: request.message.timestamp,
          updatedAt: request.message.timestamp,
        },
        runId: "run_550e8400-e29b-41d4-a716-446655440099",
        text: `echo:${request.message.text}`,
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });

    const conversationKey = conversationKeyOf({
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
    });
    const first = await host.submit({
      eventId: "evt-1",
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
      conversationKey,
      sender: { id: "local", trusted: true },
      text: "hello",
      attachments: [],
      timestamp: "2026-08-17T12:00:00.000Z",
    });
    expect(first.duplicate).toBe(false);
    expect(first.text).toBe("echo:hello");

    const dup = await host.submit({
      eventId: "evt-1",
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
      conversationKey,
      sender: { id: "local", trusted: true },
      text: "hello again",
      attachments: [],
      timestamp: "2026-08-17T12:00:01.000Z",
    });
    expect(dup.duplicate).toBe(true);

    const conversations = fs.readdirSync(path.join(dir, ".vibekit/state/conversations"));
    expect(conversations.some((name) => name.endsWith(".yaml"))).toBe(true);
    await host.stop();
  });

  it("refuses a second Host lock on the same Project", async () => {
    const dir = makeTempDir("vibekit-host-lock-");
    writeProject(dir);
    const first = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      runTurn: async (request) => ({
        task: {
          schemaVersion: 1,
          id: "task_550e8400-e29b-41d4-a716-446655440098",
          projectId: request.project.id,
          objective: "x",
          context: { references: [] },
          constraints: [],
          acceptanceCriteria: [],
          requiredCapabilities: [],
          assignedAgent: null,
          claimedBy: null,
          scope: { paths: [], resources: [] },
          dependencies: [],
          priority: "normal",
          delivery: { mode: "apply" },
          authorization: { state: "standing" },
          status: "open",
          revision: 1,
          createdAt: request.message.timestamp,
          updatedAt: request.message.timestamp,
        },
        runId: "run_550e8400-e29b-41d4-a716-446655440098",
        text: "ok",
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });
    await expect(
      VibeKitHost.start({ projectRoot: dir, startInterfaces: false }),
    ).rejects.toMatchObject({ code: "host_already_running" });
    await first.stop();
  });

  it("starts the terminal interface by dynamically loading its factory", async () => {
    const dir = makeTempDir("vibekit-host-interface-");
    const configPath = ".vibekit/config/interfaces/terminal-main.yaml";
    const project = {
      ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
      agentBindings: { chief: { definition: "agent:chief" as const } },
      interfaceBindings: {
        "terminal-main": {
          definition: "interface:terminal" as const,
          enabled: true,
          defaultAgent: "chief",
          config: configPath,
        },
      },
    };
    writeProjectDocument(dir, project);
    writeInstalledManifest(
      dir,
      upsertInstalledModule(
        emptyInstalledManifest(),
        installedStub("interface:terminal", "1.0.0", OFFICIAL_REGISTRY_SOURCE),
      ),
    );
    fs.mkdirSync(path.join(dir, ".vibekit/config/interfaces"), { recursive: true });
    fs.writeFileSync(path.join(dir, configPath), stringifyYaml({ interactive: false }), "utf8");

    const host = await VibeKitHost.start({
      projectRoot: dir,
      runTurn: async (request) => ({
        task: {
          schemaVersion: 1,
          id: "task_550e8400-e29b-41d4-a716-446655440097",
          projectId: request.project.id,
          objective: request.message.text,
          context: { references: [] },
          constraints: [],
          acceptanceCriteria: [],
          requiredCapabilities: [],
          assignedAgent: "agent:chief",
          claimedBy: null,
          scope: { paths: [], resources: [] },
          dependencies: [],
          priority: "normal",
          delivery: { mode: "apply" },
          authorization: { state: "standing" },
          status: "open",
          revision: 1,
          createdAt: request.message.timestamp,
          updatedAt: request.message.timestamp,
        },
        runId: "run_550e8400-e29b-41d4-a716-446655440097",
        text: `echo:${request.message.text}`,
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });

    const health = await host.health();
    expect(health.ok).toBe(true);
    expect(health.interfaces["terminal-main"]).toEqual({
      ok: true,
      connected: true,
      detail: "terminal",
    });
    await host.stop();
  });
});

function installedStub(
  id: InstalledModuleDocument["id"],
  version: string,
  registrySource: string,
): InstalledModuleDocument {
  return {
    schemaVersion: 1,
    id,
    version,
    registrySource,
    sourceRevision: "test",
    integrityChecksum: resolveModule(
      loadRegistry(officialRegistryDir, OFFICIAL_REGISTRY_SOURCE),
      id,
      version,
    ).checksum ?? `${id}@${version}`,
    installedAt: "2026-08-17T12:00:00.000Z",
    dependencies: [],
    files: [],
    configurationPaths: [],
    compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
  };
}
