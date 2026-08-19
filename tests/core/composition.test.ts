import {
  VibeKitError,
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { loadAgentDocument, prepareIsolatedRun } from "@useagentsio/pi";

import { buildTempRegistry, makeTempDir, officialRegistryDir } from "../helpers.js";

describe("capability composition", () => {
  it("installs and binds a source.read provider when creating Chief", () => {
    const dir = makeTempDir("vibekit-chief-cap-");
    const project = {
      ...createDefaultProject({ slug: "hq", name: "hq", defaultAgent: "chief" }),
      defaults: { model: { provider: "openai", id: "gpt-4" } },
    };
    writeProjectDocument(dir, project);
    writeInstalledManifest(dir, emptyInstalledManifest());
    const plan = planInstall({
      projectRoot: dir,
      registry: loadRegistry(officialRegistryDir),
      roots: ["agent:chief", "provider:openai", "interface:terminal"],
      project,
      manifest: emptyInstalledManifest(),
    });
    expect(plan.modules.some((module) => module.id === "tool:filesystem")).toBe(true);
    expect(plan.project.capabilityBindings["source.read"]).toBe("tool:filesystem");
    applyInstall({ projectRoot: dir, plan });
    expect(readInstalledManifest(dir).modules.some((module) => module.id === "tool:filesystem")).toBe(true);
    expect(readProjectDocument(dir).capabilityBindings["source.read"]).toBe("tool:filesystem");

    const prepared = prepareIsolatedRun({
      projectRoot: dir,
      bindingName: "chief",
      project: {
        ...readProjectDocument(dir),
        defaults: { model: { provider: "openai", id: "gpt-4" } },
      },
      agent: loadAgentDocument({
        projectRoot: dir,
        project: readProjectDocument(dir),
        bindingName: "chief",
      }),
      task: {
        schemaVersion: 1,
        id: "task_550e8400-e29b-41d4-a716-446655440000",
        projectId: readProjectDocument(dir).id,
        objective: "hello",
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
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(prepared.configuration.capabilities).toContain("source.read");
    expect(prepared.configuration.tools).toContain("read");
  });

  it("fails plan and doctor when a required capability has no provider", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "state",
        name: "repository",
        capabilities: ["state.repository"],
      },
    ]);
    const dir = makeTempDir("vibekit-cap-missing-");
    writeProjectDocument(dir, createDefaultProject({ slug: "gap", name: "gap" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    expect(() =>
      planInstall({
        projectRoot: dir,
        registry: loadRegistry(officialRegistryDir),
        roots: ["agent:chief"],
        project: {
          ...createDefaultProject({ slug: "gap", name: "gap" }),
          capabilityBindings: { "source.read": "tool:missing" },
        },
        manifest: emptyInstalledManifest(),
      }),
    ).toThrow(VibeKitError);

    const isolated = buildTempRegistry([
      {
        type: "policy",
        name: "empty",
      },
    ]);
    writeProjectDocument(dir, {
      ...createDefaultProject({ slug: "gap", name: "gap" }),
      agentBindings: { chief: { definition: "agent:chief" } },
      capabilityBindings: {},
    });
    const report = runDoctor({ projectRoot: dir, registry: loadRegistry(isolated) });
    expect(report.findings.some((finding) => finding.code === "agent_binding_missing")).toBe(true);
  });

  it("requires explicit selection when multiple providers exist", () => {
    const registryRoot = buildTempRegistry([
      { type: "tool", name: "files-a", capabilities: ["source.read"] },
      { type: "tool", name: "files-b", capabilities: ["source.read"] },
      { type: "state", name: "repository", capabilities: ["state.repository"] },
    ]);
    const dir = makeTempDir("vibekit-cap-amb-");
    writeProjectDocument(dir, createDefaultProject({ slug: "amb", name: "amb" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    expect(() =>
      planInstall({
        projectRoot: dir,
        registry: loadRegistry(registryRoot),
        roots: ["tool:files-a", "tool:files-b"],
        project: {
          ...createDefaultProject({ slug: "amb", name: "amb" }),
          agentBindings: { worker: { definition: "agent:worker" } },
        },
        manifest: emptyInstalledManifest(),
      }),
    ).not.toThrow();
  });
});
