import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDefaultProject,
  readProjectDocument,
  resolveProjectWorkspace,
  writeProjectDocument,
} from "@useagentsio/core";

import { makeTempDir } from "../helpers.js";

describe("Project workspace boundary", () => {
  it("persists an explicit workspace while omitting the root default", () => {
    const root = makeTempDir("vibekit-workspace-");
    const project = createDefaultProject({ slug: "workspace", name: "Workspace" });
    writeProjectDocument(root, { ...project, workspace: "src/app" });

    const persisted = fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8");
    expect(persisted).toContain("workspace: src/app");
    expect(readProjectDocument(root).workspace).toBe("src/app");
    expect(resolveProjectWorkspace(root, "src/app")).toBe(path.join(root, "src/app"));
  });

  it("rejects a workspace that escapes the Project", () => {
    const root = makeTempDir("vibekit-workspace-escape-");
    expect(() => resolveProjectWorkspace(root, "../outside")).toThrow(/file_target_invalid|must not contain/);
  });

  it("rejects a new workspace below a symlinked folder", () => {
    const root = makeTempDir("vibekit-workspace-link-");
    const outside = makeTempDir("vibekit-workspace-outside-");
    fs.symlinkSync(outside, path.join(root, "linked"), "dir");
    expect(() => resolveProjectWorkspace(root, "linked/new")).toThrow(/symlink/);
  });
});
