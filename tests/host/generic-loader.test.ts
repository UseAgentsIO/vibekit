import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  localRegistrySource,
  OFFICIAL_REGISTRY_SOURCE,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  sha256Checksum,
  upsertInstalledModule,
  writeInstalledManifest,
  writeProjectDocument,
  type InstalledModuleDocument,
  type ModuleId,
  type ProjectId,
} from "@useagentsio/core";
import {
  bindInstalledTools,
  bindOptionalStateAdapter,
  loadInterfaceFactory,
  VibeKitHost,
} from "@useagentsio/host";
import { createFakeInterface } from "@useagentsio/interface-sdk";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir } from "../helpers.js";

const hostSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/host/src",
);
const cliStartSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/cli/src/commands/start.ts",
);

describe("generic Host runtime loader", () => {
  it("does not switch on official Interface IDs or keep an official runtime map", () => {
    const loader = fs.readFileSync(path.join(hostSrc, "interface-loader.ts"), "utf8");
    const tools = fs.readFileSync(path.join(hostSrc, "tool-binder.ts"), "utf8");
    const state = fs.readFileSync(path.join(hostSrc, "state-binder.ts"), "utf8");
    const start = fs.readFileSync(cliStartSrc, "utf8");
    for (const source of [loader, tools, state]) {
      expect(source).not.toContain("OFFICIAL_INTERFACE_RUNTIME");
      expect(source).not.toContain("runtimeFromOfficialRegistry");
      expect(source).not.toContain("defaultRegistryRoot");
      expect(source).not.toContain("loadRegistry(");
    }
    expect(loader).not.toMatch(/interface:terminal|interface:telegram/);
    expect(start).not.toContain("createTelegramInterface");
    expect(start).not.toContain("createTerminalInterface");
    expect(start).not.toContain("factories:");
  });

  it("loads a non-UseAgentsIO tool through installed runtime metadata", async () => {
    const { projectRoot } = installFixtureProject({
      tools: [fixtureToolModule()],
    });
    writeLocalPackage(
      projectRoot,
      "fixture-example-tool",
      `export function createFixtureTool() {
  return {
    name: "fixture_example",
    description: "Generic third-party fixture tool",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ ok: true, source: "fixture-example" }),
  };
}
`,
    );

    const tools = await bindInstalledTools(projectRoot, {
      resolveSecret: () => "",
      allowedModuleIds: ["tool:fixture-example"],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.moduleId).toBe("tool:fixture-example");
    expect(tools[0]?.name).toBe("fixture_example");
    await expect(tools[0]?.execute({})).resolves.toEqual({ ok: true, source: "fixture-example" });

    const denied = await bindInstalledTools(projectRoot, {
      resolveSecret: () => "",
      allowedModuleIds: [],
    });
    expect(denied).toEqual([]);
  });

  it("loads a non-UseAgentsIO interface through installed runtime metadata", async () => {
    const { projectRoot } = installFixtureProject({
      interfaces: [fixtureInterfaceModule()],
    });
    writeLocalPackage(projectRoot, "fixture-example-interface", fixtureInterfaceSource("fixture-example"));

    const factory = await loadInterfaceFactory("interface:fixture-example", undefined, projectRoot);
    const running = await factory.create({}, silentServices());
    await running.start();
    expect(await running.health()).toEqual({
      ok: true,
      connected: true,
      detail: "fixture-example",
    });
    await running.stop();
  });

  it("starts Host with a generic Interface without a factories map", async () => {
    const { projectRoot } = installFixtureProject({
      interfaces: [fixtureInterfaceModule()],
      bindInterface: "interface:fixture-example",
    });
    writeLocalPackage(projectRoot, "fixture-example-interface", fixtureInterfaceSource("fixture-example"));

    const host = await VibeKitHost.start({
      projectRoot,
      runTurn: async (request) => ({
        task: dummyTask(request.project.id, request.message.timestamp),
        runId: "run_550e8400-e29b-41d4-a716-446655440096",
        text: "ok",
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });
    const health = await host.health();
    expect(health.ok).toBe(true);
    expect(health.interfaces["fixture-main"]).toEqual({
      ok: true,
      connected: true,
      detail: "fixture-example",
    });
    await host.stop();
  });

  it("uses the custom registry runtime when an official ID is installed from a local source", async () => {
    const { projectRoot } = installFixtureProject({
      tools: [
        {
          type: "tool",
          name: "web",
          runtime: {
            kind: "pi-extension",
            package: "fixture-example-tool",
            export: "createFixtureTool",
          },
        },
      ],
    });
    writeLocalPackage(
      projectRoot,
      "fixture-example-tool",
      `export function createFixtureTool() {
  return {
    name: "fixture_custom_web",
    description: "Custom-registry runtime for tool:web",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ source: "custom-registry" }),
  };
}
`,
    );

    const tools = await bindInstalledTools(projectRoot, {
      resolveSecret: () => "",
      allowedModuleIds: ["tool:web"],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]?.moduleId).toBe("tool:web");
    expect(tools[0]?.name).toBe("fixture_custom_web");
    expect(tools[0]?.name).not.toBe("web");
  });

  it("uses the custom Interface runtime for an official ID installed from a local source", async () => {
    const { projectRoot } = installFixtureProject({
      interfaces: [
        {
          type: "interface",
          name: "terminal",
          runtime: {
            kind: "interface",
            package: "fixture-example-interface",
            export: "createFixtureInterface",
            lifecycle: "singleton",
          },
        },
      ],
    });
    writeLocalPackage(
      projectRoot,
      "fixture-example-interface",
      fixtureInterfaceSource("custom-terminal"),
    );

    const factory = await loadInterfaceFactory("interface:terminal", undefined, projectRoot);
    const running = await factory.create({}, silentServices());
    expect(await running.health()).toMatchObject({ detail: "custom-terminal" });
  });

  it("never binds a tool that is not installed", async () => {
    const dir = makeTempDir("vibekit-loader-uninstalled-");
    writeProjectDocument(dir, createDefaultProject({ slug: "demo", name: "Demo" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    writeLocalPackage(
      dir,
      "fixture-example-tool",
      `export function createFixtureTool() {
  return { name: "fixture_example", description: "x", parameters: {}, execute: async () => ({}) };
}
`,
    );
    const tools = await bindInstalledTools(dir, {
      resolveSecret: () => {
        throw new Error("secrets must not be resolved for uninstalled tools");
      },
    });
    expect(tools).toEqual([]);
  });

  it("does not execute config-only or available:false tools", async () => {
    const { projectRoot } = installFixtureProject({
      tools: [
        {
          type: "tool",
          name: "fixture-config-only",
          runtime: { kind: "config-only", available: false },
        },
        {
          type: "tool",
          name: "fixture-unavailable",
          runtime: {
            kind: "pi-extension",
            package: "fixture-example-tool",
            export: "createFixtureTool",
            available: false,
          },
        },
        {
          type: "tool",
          name: "fixture-builtin",
          runtime: { kind: "pi-builtin", tools: ["bash"] },
        },
      ],
    });
    writeLocalPackage(
      projectRoot,
      "fixture-example-tool",
      `export function createFixtureTool() {
  throw new Error("available:false tools must not be imported");
}
`,
    );
    const tools = await bindInstalledTools(projectRoot, { resolveSecret: () => "" });
    expect(tools).toEqual([]);
  });

  it("fails closed when an executable tool package cannot be loaded", async () => {
    const { projectRoot } = installFixtureProject({
      tools: [
        {
          type: "tool",
          name: "fixture-missing-pkg",
          runtime: {
            kind: "pi-extension",
            package: "fixture-package-that-does-not-exist",
            export: "createFixtureTool",
          },
        },
      ],
    });
    await expect(bindInstalledTools(projectRoot, { resolveSecret: () => "" })).rejects.toMatchObject({
      code: "tool_factory_missing",
    });
  });

  it("fails closed when an enabled Interface is not installed", async () => {
    const dir = makeTempDir("vibekit-loader-iface-missing-");
    writeProjectDocument(dir, {
      ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
      agentBindings: { chief: { definition: "agent:chief" } },
      interfaceBindings: {
        "fixture-main": {
          definition: "interface:fixture-example",
          enabled: true,
          defaultAgent: "chief",
        },
      },
    });
    writeInstalledManifest(dir, emptyInstalledManifest());
    await expect(
      VibeKitHost.start({
        projectRoot: dir,
        runTurn: async (request) => ({
          task: dummyTask(request.project.id, request.message.timestamp),
          runId: "run_550e8400-e29b-41d4-a716-446655440095",
          text: "ok",
          cancelled: false,
          events: [],
          sessionPath: request.conversation.sessionPath,
        }),
      }),
    ).rejects.toMatchObject({ code: "module_not_installed" });
  });

  it("honors factories as a testing override before installed runtime", async () => {
    const dir = makeTempDir("vibekit-loader-factories-");
    writeProjectDocument(dir, {
      ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
      agentBindings: { chief: { definition: "agent:chief" } },
      interfaceBindings: {
        "fixture-main": {
          definition: "interface:fixture-example",
          enabled: true,
          defaultAgent: "chief",
        },
      },
    });
    writeInstalledManifest(dir, emptyInstalledManifest());
    const host = await VibeKitHost.start({
      projectRoot: dir,
      factories: {
        "interface:fixture-example": { create: createFakeInterface },
      },
      runTurn: async (request) => ({
        task: dummyTask(request.project.id, request.message.timestamp),
        runId: "run_550e8400-e29b-41d4-a716-446655440094",
        text: "ok",
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });
    const health = await host.health();
    expect(health.interfaces["fixture-main"]).toEqual({ ok: true, connected: true });
    await host.stop();
  });

  it("loads a package-backed state adapter from the installed record", async () => {
    const { projectRoot } = installFixtureProject({
      states: [
        {
          type: "state",
          name: "fixture-example",
          runtime: {
            kind: "package",
            package: "fixture-example-state",
            export: "createFixtureStateAdapter",
          },
        },
      ],
    });
    writeLocalPackage(
      projectRoot,
      "fixture-example-state",
      `export function createFixtureStateAdapter() {
  return { id: "state:fixture-example", sessionContext: async () => "fixture-state" };
}
`,
    );
    const adapter = await bindOptionalStateAdapter(projectRoot, "state:fixture-example");
    expect(adapter?.id).toBe("state:fixture-example");
    await expect(adapter?.sessionContext?.()).resolves.toBe("fixture-state");
  });

  it("does not bind a config-only state adapter", async () => {
    const { projectRoot } = installFixtureProject({
      states: [
        {
          type: "state",
          name: "fixture-config",
          runtime: { kind: "config-only", available: false },
        },
      ],
    });
    const adapter = await bindOptionalStateAdapter(projectRoot, "state:fixture-config");
    expect(adapter).toBeUndefined();
  });

  it("fails closed when recorded local registry source is missing", async () => {
    const dir = makeTempDir("vibekit-loader-missing-source-");
    writeProjectDocument(dir, createDefaultProject({ slug: "demo", name: "Demo" }));
    writeInstalledManifest(
      dir,
      upsertInstalledModule(
        emptyInstalledManifest(),
        installedStub("tool:fixture-example", "1.0.0", localRegistrySource("/tmp/does-not-exist-vibekit-registry")),
      ),
    );
    await expect(bindInstalledTools(dir, { resolveSecret: () => "" })).rejects.toMatchObject({
      code: "registry_index_missing",
    });
  });

  it("does not silently resolve a local-installed official ID from the official catalog", async () => {
    const dir = makeTempDir("vibekit-loader-no-fallback-");
    writeProjectDocument(dir, createDefaultProject({ slug: "demo", name: "Demo" }));
    writeInstalledManifest(
      dir,
      upsertInstalledModule(
        emptyInstalledManifest(),
        installedStub("tool:web", "1.0.0", localRegistrySource("/tmp/does-not-exist-vibekit-registry")),
      ),
    );
    await expect(bindInstalledTools(dir, { resolveSecret: () => "" })).rejects.toMatchObject({
      code: "registry_index_missing",
    });
  });
});

function fixtureToolModule() {
  return {
    type: "tool" as const,
    name: "fixture-example",
    runtime: {
      kind: "pi-extension" as const,
      package: "fixture-example-tool",
      export: "createFixtureTool",
    },
    packages: { dependencies: { "fixture-example-tool": "1.0.0" } },
  };
}

function fixtureInterfaceModule() {
  return {
    type: "interface" as const,
    name: "fixture-example",
    runtime: {
      kind: "interface" as const,
      package: "fixture-example-interface",
      export: "createFixtureInterface",
      lifecycle: "singleton" as const,
    },
    packages: { dependencies: { "fixture-example-interface": "1.0.0" } },
  };
}

function fixtureInterfaceSource(detail: string): string {
  return `export function createFixtureInterface() {
  let started = false;
  return {
    start: async () => { started = true; },
    stop: async () => { started = false; },
    deliver: async () => {},
    health: async () => ({ ok: started, connected: started, detail: ${JSON.stringify(detail)} }),
  };
}
`;
}

function installFixtureProject(options: {
  readonly tools?: Parameters<typeof buildTempRegistry>[0];
  readonly interfaces?: Parameters<typeof buildTempRegistry>[0];
  readonly states?: Parameters<typeof buildTempRegistry>[0];
  readonly bindInterface?: ModuleId;
}): { readonly projectRoot: string; readonly registryRoot: string } {
  const components = [
    ...(options.tools ?? []),
    ...(options.interfaces ?? []),
    ...(options.states ?? []),
  ];
  const registryRoot = buildTempRegistry(components);
  const projectRoot = makeTempDir("vibekit-loader-project-");
  const project = {
    ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
    agentBindings: { chief: { definition: "agent:chief" as const } },
    ...(options.bindInterface !== undefined
      ? {
          interfaceBindings: {
            "fixture-main": {
              definition: options.bindInterface,
              enabled: true,
              defaultAgent: "chief",
            },
          },
        }
      : {}),
  };
  writeProjectDocument(projectRoot, project);
  writeInstalledManifest(projectRoot, emptyInstalledManifest());
  const roots = components.map((component) => `${component.type}:${component.name}` as ModuleId);
  const registry = loadRegistry(registryRoot);
  expect(registry.source).toBe(localRegistrySource(registryRoot));
  expect(registry.source).not.toBe(OFFICIAL_REGISTRY_SOURCE);
  const plan = planInstall({
    projectRoot,
    registry,
    roots,
    project: readProjectDocument(projectRoot),
    manifest: readInstalledManifest(projectRoot),
  });
  applyInstall({ projectRoot, plan });
  for (const id of roots) {
    const record = readInstalledManifest(projectRoot).modules.find((module) => module.id === id);
    expect(record?.registrySource).toBe(localRegistrySource(registryRoot));
  }
  return { projectRoot, registryRoot };
}

function writeLocalPackage(projectRoot: string, name: string, source: string): void {
  const pkgDir = path.join(projectRoot, "node_modules", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    `${JSON.stringify({ name, type: "module", exports: "./index.js" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(pkgDir, "index.js"), source, "utf8");
  const projectPkg = path.join(projectRoot, "package.json");
  if (!fs.existsSync(projectPkg)) {
    fs.writeFileSync(
      projectPkg,
      `${JSON.stringify({ name: "temp-project", private: true, type: "module" }, null, 2)}\n`,
    );
  }
}

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
    integrityChecksum: sha256Checksum(`${id}@${version}`),
    installedAt: "2026-08-17T12:00:00.000Z",
    dependencies: [],
    files: [],
    configurationPaths: [],
    compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
  };
}

function silentServices() {
  return {
    submit: async () => undefined,
    cancel: async () => true,
    approve: async () => undefined,
    resolveSecret: (name: string) => name,
    log: { info() {}, warn() {}, error() {} },
  };
}

function dummyTask(projectId: ProjectId, timestamp: string) {
  return {
    schemaVersion: 1 as const,
    id: "task_550e8400-e29b-41d4-a716-446655440093" as const,
    projectId,
    objective: "x",
    context: { references: [] },
    constraints: [],
    acceptanceCriteria: [],
    requiredCapabilities: [],
    assignedAgent: "agent:chief" as const,
    claimedBy: null,
    scope: { paths: [], resources: [] },
    dependencies: [],
    priority: "normal" as const,
    delivery: { mode: "apply" as const },
    authorization: { state: "standing" as const },
    status: "open" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
