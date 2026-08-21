import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  applyUpdate,
  applyUpdates,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  planUpdate,
  planUpdates,
  readInstalledManifest,
  readProjectDocument,
  writeProjectDocument,
  type ModuleId,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { makeTempDir, officialRegistryDir } from "../helpers.js";

const LEGACY_EXTENSION_MODULES: ReadonlyArray<{
  readonly id: ModuleId;
  readonly from: string;
  readonly to: string;
  readonly path: string;
}> = [
  { id: "tool:browser", from: "1.0.0", to: "1.1.0", path: ".pi/extensions/browser/index.ts" },
  { id: "tool:github", from: "1.1.0", to: "1.2.0", path: ".pi/extensions/github/index.ts" },
  { id: "tool:mcp", from: "1.0.0", to: "1.1.0", path: ".pi/extensions/mcp/index.ts" },
  { id: "tool:memory", from: "1.2.0", to: "1.3.0", path: ".pi/extensions/memory/index.ts" },
  { id: "tool:process", from: "1.0.0", to: "1.1.0", path: ".pi/extensions/process/index.ts" },
  { id: "tool:scheduler", from: "1.0.0", to: "1.1.0", path: ".pi/extensions/scheduler/index.ts" },
  { id: "tool:web", from: "1.0.0", to: "1.1.0", path: ".pi/extensions/web/index.ts" },
];

describe("registry Pi extension migration", () => {
  it.each(LEGACY_EXTENSION_MODULES)(
    "removes the unchanged $id@$from extension stub when updating to $to",
    (item) => {
      const registry = loadRegistry(officialRegistryDir);
      const projectRoot = installLegacyExtension(registry, item.id, item.from);
      const plan = planUpdate({
        projectRoot,
        registry,
        id: item.id,
        project: readProjectDocument(projectRoot),
        manifest: readInstalledManifest(projectRoot),
      });

      expect(plan.toVersion).toBe(item.to);
      expect(plan.conflicts).toEqual([]);
      expect(plan.deletes).toContain(item.path);
      const result = applyUpdate({ projectRoot, plan });
      expect(result.removed).toContain(item.path);
      expect(fs.existsSync(path.join(projectRoot, item.path))).toBe(false);
      expect(readInstalledManifest(projectRoot).modules.find((module) => module.id === item.id)?.version).toBe(
        item.to,
      );
    },
  );

  it("updates mutually dependent memory Modules atomically", () => {
    const registry = loadRegistry(officialRegistryDir);
    const legacyRegistry = {
      ...registry,
      index: {
        schemaVersion: 1 as const,
        modules: registry.index.modules.filter(
          (entry) =>
            !["state:memory", "tool:memory"].includes(entry.id) ||
            ((entry.id === "state:memory" || entry.id === "tool:memory") && entry.version === "1.0.0"),
        ),
      },
    };
    const projectRoot = makeTempDir("vibekit-pi-batch-");
    writeProjectDocument(projectRoot, createDefaultProject({ slug: "pi-batch", name: "Pi batch" }));
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      `${JSON.stringify({ name: "pi-batch", dependencies: { "@useagentsio/state-memory": "workspace:*" } }, null, 2)}\n`,
      "utf8",
    );
    const previous = process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;
    process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = "1";
    try {
      const installed = planInstall({
        projectRoot,
        registry: legacyRegistry,
        roots: ["tool:memory"],
        project: readProjectDocument(projectRoot),
        manifest: emptyInstalledManifest(),
      });
      applyInstall({ projectRoot, plan: installed });

      const plan = planUpdates({
        projectRoot,
        registry,
        updates: [{ id: "state:memory" }, { id: "tool:memory" }],
        project: readProjectDocument(projectRoot),
        manifest: readInstalledManifest(projectRoot),
      });
      expect(plan.conflicts).toEqual([]);
      expect(plan.updates.map((item) => `${item.id}@${item.toVersion}`)).toEqual([
        "state:memory@1.2.0",
        "tool:memory@1.3.0",
      ]);
      expect(plan.packageDependencies["@useagentsio/state-memory"]).toBeUndefined();

      const result = applyUpdates({ projectRoot, plan });
      expect(result.updated).toBe(true);
      expect(readInstalledManifest(projectRoot).modules.find((module) => module.id === "state:memory")?.version).toBe(
        "1.2.0",
      );
      expect(readInstalledManifest(projectRoot).modules.find((module) => module.id === "tool:memory")?.version).toBe(
        "1.3.0",
      );
      expect(fs.existsSync(path.join(projectRoot, ".pi/extensions/memory/index.ts"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;
      else process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = previous;
    }
  });
});

function installLegacyExtension(
  registry: ReturnType<typeof loadRegistry>,
  id: ModuleId,
  version: string,
): string {
  const projectRoot = makeTempDir(`vibekit-legacy-${id.slice(5)}-`);
  writeProjectDocument(projectRoot, createDefaultProject({ slug: "legacy-extension", name: "Legacy Extension" }));
  const legacyRegistry = {
    ...registry,
    index: {
      schemaVersion: 1 as const,
      modules: registry.index.modules.filter((entry) => entry.id !== id || entry.version === version),
    },
  };
  const plan = planInstall({
    projectRoot,
    registry: legacyRegistry,
    roots: [id],
    project: readProjectDocument(projectRoot),
    manifest: emptyInstalledManifest(),
  });
  expect(plan.modules.find((module) => module.id === id)?.version).toBe(version);
  applyInstall({ projectRoot, plan });
  return projectRoot;
}
