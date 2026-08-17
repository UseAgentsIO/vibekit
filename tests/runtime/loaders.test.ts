import fs from "node:fs";
import path from "node:path";

import { VibeKitError, stringifyYaml } from "@vibekit/core";
import { loadAgentDocument, loadProjectDocument, loadTaskDocument } from "@vibekit/pi";
import { describe, expect, it } from "vitest";

import { makeTempDir } from "../helpers.js";
import { writeRuntimeFixture } from "./helpers.js";

describe("Project and Agent loaders", () => {
  it("loads a valid Project, Agent, and Task from disk", () => {
    const fixture = writeRuntimeFixture();
    const project = loadProjectDocument(fixture.root);
    expect(project.id).toBe("project:example-app");

    const agent = loadAgentDocument({
      projectRoot: fixture.root,
      project,
      bindingName: "coder",
    });
    expect(agent.document.id).toBe("agent:coder");
    expect(agent.instructions).toContain("Stay inside the Task scope");

    const taskPath = path.join(fixture.root, "task.yaml");
    fs.writeFileSync(taskPath, stringifyYaml(fixture.task), "utf8");
    const task = loadTaskDocument(taskPath);
    expect(task.id).toBe(fixture.task.id);
  });

  it("fails closed when project.yaml is missing", () => {
    const root = makeTempDir("vibekit-pi-missing-");
    expect(() => loadProjectDocument(root)).toThrow(VibeKitError);
    try {
      loadProjectDocument(root);
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("configuration_invalid");
      expect((error as VibeKitError).code).toBe("project_missing");
    }
  });

  it("fails closed when the Agent binding is missing", () => {
    const fixture = writeRuntimeFixture({
      project: { agentBindings: {} },
    });
    expect(() =>
      loadAgentDocument({
        projectRoot: fixture.root,
        project: loadProjectDocument(fixture.root),
        bindingName: "coder",
      }),
    ).toThrow(/no Agent binding/);
  });

  it("fails closed when Agent instructions are missing", () => {
    const fixture = writeRuntimeFixture();
    fs.unlinkSync(path.join(fixture.root, ".vibekit", "agents", "coder", "instructions.md"));
    expect(() =>
      loadAgentDocument({
        projectRoot: fixture.root,
        project: loadProjectDocument(fixture.root),
        bindingName: "coder",
      }),
    ).toThrow(/instructions/);
  });

  it("fails closed on invalid Project YAML", () => {
    const root = makeTempDir("vibekit-pi-invalid-");
    fs.mkdirSync(path.join(root, ".vibekit"), { recursive: true });
    fs.writeFileSync(path.join(root, ".vibekit", "project.yaml"), "schemaVersion: 1\n", "utf8");
    expect(() => loadProjectDocument(root)).toThrow(VibeKitError);
    try {
      loadProjectDocument(root);
    } catch (error) {
      expect((error as VibeKitError).category).toBe("configuration_invalid");
      expect((error as VibeKitError).code).toBe("project_invalid");
    }
  });
});
