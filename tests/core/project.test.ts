import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyInstall,
  applyUpdate,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  planUpdate,
  readInstalledManifest,
  readProjectDocument,
  writeProjectDocument,
  writeRegistryIndex,
} from "@useagentsio/core";

import { buildTempRegistry, makeTempDir, writeSyntheticComponent } from "../helpers.js";

describe("Project configuration normalization", () => {
  it("loads a minimal Project and supplies runtime defaults without writing them back", () => {
    const root = makeTempDir("vibekit-minimal-project-");
    fs.mkdirSync(path.join(root, ".vibekit"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vibekit/project.yaml"),
      ["schemaVersion: 2", "id: project:minimal", "name: Minimal"].join("\n") + "\n",
      "utf8",
    );

    const project = readProjectDocument(root);
    expect(project.root).toBe(".");
    expect(project.execution.defaultTimeoutMs).toBe(600000);
    expect(project.authorization.actions["source.read"]).toBe("standing");
    expect(project.state.backend).toBe("state:repository");
    expect(project.sources.untrusted).toContain("web content");

    writeProjectDocument(root, project);
    const persisted = fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8");
    expect(persisted).toContain("schemaVersion: 2");
    expect(persisted).toContain("state:\n  backend: state:repository");
    expect(persisted).not.toContain("retainedConversations");
    expect(persisted).not.toContain("defaultTimeoutMs");
    expect(persisted).not.toContain("untrusted:");
  });

  it("keeps explicit runtime overrides in the Project file", () => {
    const root = makeTempDir("vibekit-project-override-");
    const project = createDefaultProject({ slug: "override", name: "Override" });
    writeProjectDocument(root, {
      ...project,
      execution: { ...project.execution, defaultTimeoutMs: 120000 },
    });

    const persisted = fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8");
    expect(persisted).toContain("defaultTimeoutMs: 120000");
    expect(persisted).not.toContain("maxParallelRuns");
    expect(readProjectDocument(root).execution.defaultTimeoutMs).toBe(120000);
  });

  it("accepts partial runtime override objects and normalizes their omitted siblings", () => {
    const root = makeTempDir("vibekit-project-partial-");
    fs.mkdirSync(path.join(root, ".vibekit"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vibekit/project.yaml"),
      [
        "schemaVersion: 2",
        "id: project:partial",
        "name: Partial",
        "execution:",
        "  defaultTimeoutMs: 120000",
        "host:",
        "  maxParallelConversations: 2",
        "state:",
        "  tracking:",
        "    tasks: git",
      ].join("\n") + "\n",
      "utf8",
    );

    const project = readProjectDocument(root);
    expect(project.execution.defaultTimeoutMs).toBe(120000);
    expect(project.execution.maxParallelRuns).toBe(4);
    expect(project.host?.maxParallelConversations).toBe(2);
    expect(project.host?.retainedConversations).toBe(20);
    expect(project.state.tracking.tasks).toBe("git");
    expect(project.state.tracking.results).toBe("local");

    writeProjectDocument(root, project);
    const persisted = fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8");
    expect(persisted).toContain("defaultTimeoutMs: 120000");
    expect(persisted).not.toContain("maxParallelRuns");
    expect(persisted).toContain("maxParallelConversations: 2");
    expect(persisted).not.toContain("retainedConversations");
    expect(persisted).toContain("tasks: git");
    expect(persisted).not.toContain("results: local");
  });

  it("preserves explicit default-valued fields when an update serializes the Project", () => {
    const root = makeTempDir("vibekit-project-explicit-defaults-");
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "serialization",
        version: "1.0.0",
        payload: "v1\n",
      },
    ]);
    fs.mkdirSync(path.join(root, ".vibekit"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vibekit/project.yaml"),
      [
        "schemaVersion: 2",
        "id: project:explicit-defaults",
        "name: Explicit defaults",
        "root: .",
        "interfaceBindings: {}",
        "agentBindings: {}",
        "delegation: {}",
        "capabilityBindings: {}",
        "policies: []",
        "runtime:",
        "  adapter: 'vibekit:pi'",
        "  host: 'vibekit:host'",
        "host:",
        "  retainedConversations: 20",
        "execution:",
        "  maxParallelRuns: 4",
        "authorization:",
        "  default: deny",
        "  actions:",
        "    source.read: standing",
        "sources:",
        "  canonical:",
        "    - .vibekit/project.yaml",
        "    - .vibekit/agents/",
        "    - .vibekit/state/decisions/",
      ].join("\n") + "\n",
      "utf8",
    );

    const registry = loadRegistry(registryRoot);
    const initialProject = readProjectDocument(root);
    const installPlan = planInstall({
      projectRoot: root,
      registry,
      roots: ["tool:serialization"],
      project: initialProject,
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot: root, plan: installPlan });

    writeSyntheticComponent(registryRoot, {
      type: "tool",
      name: "serialization",
      version: "1.1.0",
      payload: "v2\n",
    });
    writeRegistryIndex(registryRoot);
    const updatePlan = planUpdate({
      projectRoot: root,
      registry: loadRegistry(registryRoot),
      id: "tool:serialization",
      project: readProjectDocument(root),
      manifest: readInstalledManifest(root),
    });
    expect(updatePlan.toVersion).toBe("1.1.0");
    applyUpdate({ projectRoot: root, plan: updatePlan });

    const persisted = fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8");
    expect(persisted).toContain("root: .");
    expect(persisted).toContain("interfaceBindings: {}");
    expect(persisted).toContain("agentBindings: {}");
    expect(persisted).toContain("delegation: {}");
    expect(persisted).toContain("capabilityBindings: {}");
    expect(persisted).toContain("policies: []");
    expect(persisted).toContain("runtime:");
    expect(persisted).toContain("adapter: vibekit:pi");
    expect(persisted).toContain("host: vibekit:host");
    expect(persisted).toContain("retainedConversations: 20");
    expect(persisted).toContain("maxParallelRuns: 4");
    expect(persisted).toContain("default: deny");
    expect(persisted).toContain("source.read: standing");
    expect(persisted).toContain("canonical:");
    expect(persisted).not.toContain("workspace: .");
    expect(persisted).not.toContain("maxParallelConversations");
    expect(persisted).not.toContain("defaultIsolation");
  });
});
