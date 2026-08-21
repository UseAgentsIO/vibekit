import fs from "node:fs";
import path from "node:path";

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
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { makeTempDir, officialRegistryDir } from "../helpers.js";

const EXECUTION_STUB = ".pi/extensions/execution/index.ts";
const FILESYSTEM_STUB = ".pi/extensions/filesystem/index.ts";

describe("Pi built-in Module migration", () => {
  it("updates an unchanged 1.0.0 stub transactionally and preserves a modified stub as a conflict", () => {
    const registry = loadRegistry(officialRegistryDir);
    const unchanged = installLegacyModule(registry, "tool:execution");
    const unchangedPlan = planUpdate({
      projectRoot: unchanged,
      registry,
      id: "tool:execution",
      project: readProjectDocument(unchanged),
      manifest: readInstalledManifest(unchanged),
    });

    expect(unchangedPlan.toVersion).toBe("1.1.0");
    expect(unchangedPlan.conflicts).toEqual([]);
    expect(unchangedPlan.deletes).toContain(EXECUTION_STUB);
    const applied = applyUpdate({ projectRoot: unchanged, plan: unchangedPlan });
    expect(applied.removed).toContain(EXECUTION_STUB);
    expect(fs.existsSync(path.join(unchanged, EXECUTION_STUB))).toBe(false);
    expect(readInstalledManifest(unchanged).modules[0]?.version).toBe("1.1.0");

    const modified = installLegacyModule(registry, "tool:filesystem");
    const modifiedPath = path.join(modified, FILESYSTEM_STUB);
    fs.appendFileSync(modifiedPath, "// local edit\n", "utf8");
    const modifiedPlan = planUpdate({
      projectRoot: modified,
      registry,
      id: "tool:filesystem",
      project: readProjectDocument(modified),
      manifest: readInstalledManifest(modified),
    });

    expect(modifiedPlan.conflicts.map((file) => file.path)).toContain(FILESYSTEM_STUB);
    expect(() => applyUpdate({ projectRoot: modified, plan: modifiedPlan })).toThrow(/conflicting files/);
    expect(fs.existsSync(modifiedPath)).toBe(true);
    expect(fs.readFileSync(modifiedPath, "utf8")).toContain("// local edit");
    expect(readInstalledManifest(modified).modules[0]?.version).toBe("1.0.0");
  });

  it("generates a Project with built-in capabilities and no Pi extension stubs", () => {
    const registry = loadRegistry(officialRegistryDir);
    const projectRoot = makeTempDir("vibekit-pi-generated-");
    writeProjectDocument(projectRoot, {
      ...createDefaultProject({ slug: "pi-generated", name: "Pi Generated" }),
      capabilityBindings: {
        "source.read": "tool:filesystem",
        "source.write": "tool:filesystem",
        "command.execute": "tool:execution",
      },
    });
    const plan = planInstall({
      projectRoot,
      registry,
      roots: ["tool:filesystem", "tool:execution"],
      project: readProjectDocument(projectRoot),
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot, plan });

    expect(plan.project.capabilityBindings["source.read"]).toBe("tool:filesystem");
    expect(plan.project.capabilityBindings["source.write"]).toBe("tool:filesystem");
    expect(plan.project.capabilityBindings["command.execute"]).toBe("tool:execution");
    expect(fs.existsSync(path.join(projectRoot, EXECUTION_STUB))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, FILESYSTEM_STUB))).toBe(false);
    const manifest = readInstalledManifest(projectRoot);
    expect(manifest.modules.find((module) => module.id === "tool:execution")?.files).toEqual([]);
    expect(manifest.modules.find((module) => module.id === "tool:filesystem")?.files).toEqual([]);
  });
});

function installLegacyModule(
  registry: ReturnType<typeof loadRegistry>,
  id: "tool:execution" | "tool:filesystem",
): string {
  const projectRoot = makeTempDir(`vibekit-pi-legacy-${id.slice(5)}-`);
  writeProjectDocument(projectRoot, createDefaultProject({ slug: "pi-legacy", name: "Pi Legacy" }));
  // Explicitly select the released module so this test continues to cover the migration source.
  const legacy = registry.index.modules.find((entry) => entry.id === id && entry.version === "1.0.0");
  expect(legacy).toBeDefined();
  const legacyPlan = planInstall({
    projectRoot,
    registry: {
      ...registry,
      index: { schemaVersion: 1, modules: registry.index.modules.filter((entry) => entry.id !== id || entry.version === "1.0.0") },
    },
    roots: [id],
    project: readProjectDocument(projectRoot),
    manifest: emptyInstalledManifest(),
  });
  expect(legacyPlan.modules.find((module) => module.id === id)?.version).toBe("1.0.0");
  applyInstall({ projectRoot, plan: legacyPlan });
  return projectRoot;
}
