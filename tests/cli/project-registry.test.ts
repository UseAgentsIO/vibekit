import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultProject, emptyInstalledManifest, writeInstalledManifest, writeProjectDocument } from "@useagentsio/core";
import { locateProject, projectRegistryPath, readProjectRegistry, registerProject, unregisterProject } from "../../packages/cli/src/project-registry.js";
import { makeTempDir } from "../helpers.js";

const roots: string[] = [];

afterEach(() => {
  fs.rmSync(projectRegistryPath(), { force: true });
  fs.rmSync(`${projectRegistryPath()}.backup`, { force: true });
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Project registry", () => {
  it("writes atomically with owner-only permissions and rejects duplicate identities", () => {
    const first = project("shared-id");
    const second = project("shared-id");
    const entry = registerProject(first);
    expect(entry.path).toBe(fs.realpathSync(first));
    expect(fs.statSync(projectRegistryPath()).mode & 0o777).toBe(0o600);
    expect(() => registerProject(second)).toThrow(/already registered/);
    expect(readProjectRegistry()).toHaveLength(1);
    expect(fs.readdirSync(path.dirname(projectRegistryPath())).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("recovers malformed data from the last atomic backup", () => {
    const root = project("recoverable");
    registerProject(root);
    fs.writeFileSync(projectRegistryPath(), "{broken");
    expect(readProjectRegistry()).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(projectRegistryPath(), "utf8"))).toMatchObject({ schemaVersion: 1 });
  });

  it("keeps missing Projects visible, relocates only matching IDs and unregisters without deleting files", async () => {
    const oldRoot = project("relocatable");
    registerProject(oldRoot);
    fs.rmSync(oldRoot, { recursive: true });
    const newRoot = project("relocatable");
    const located = locateProject("project:relocatable", newRoot);
    expect(located.path).toBe(fs.realpathSync(newRoot));
    await unregisterProject("project:relocatable");
    expect(fs.existsSync(newRoot)).toBe(true);
    expect(readProjectRegistry()).toEqual([]);
  });
});

function project(slug: string): string {
  const root = makeTempDir("vibekit-registry-project-");
  roots.push(root);
  writeProjectDocument(root, createDefaultProject({ slug, name: slug }));
  writeInstalledManifest(root, emptyInstalledManifest());
  return root;
}
