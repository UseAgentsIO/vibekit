import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  applyRemove,
  applyUpdate,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  packageManagerInstallArgs,
  planInstall,
  planRemove,
  planUpdate,
  writeInstalledManifest,
  writeProjectDocument,
  writeRegistryIndex,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir, writeSyntheticComponent } from "../helpers.js";

describe("package dependency lifecycle", () => {
  it("uses --ignore-scripts for package manager install", () => {
    expect(packageManagerInstallArgs("npm")).toEqual(["install", "--ignore-scripts"]);
    expect(packageManagerInstallArgs("pnpm")).toEqual(["install", "--ignore-scripts"]);
  });

  it("updates github 1.0.0 to 1.1.0 by installing the implementation package", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "policy",
        name: "least-privilege",
        capabilities: ["policy.least-privilege"],
      },
      {
        type: "tool",
        name: "github",
        version: "1.0.0",
        capabilities: ["repository.read", "repository.write"],
        runtime: { kind: "config-only", available: false },
      },
    ]);
    const dir = makeTempDir("vibekit-gh-update-");
    writeProjectDocument(dir, createDefaultProject({ slug: "gh", name: "gh" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const registry = loadRegistry(registryRoot);
    const installed = applyInstall({
      projectRoot: dir,
      plan: planInstall({
        projectRoot: dir,
        registry,
        roots: ["tool:github"],
        project: createDefaultProject({ slug: "gh", name: "gh" }),
        manifest: emptyInstalledManifest(),
      }),
    });
    expect(installed.plan.packageDependencies["@useagentsio/tool-github"]).toBeUndefined();

    writeSyntheticComponent(registryRoot, {
      type: "tool",
      name: "github",
      version: "1.1.0",
      capabilities: ["repository.read", "repository.write"],
      required: ["policy:least-privilege"],
      runtime: {
        kind: "pi-extension",
        package: "@useagentsio/tool-github",
        export: "createGithubTool",
        available: true,
      },
      packages: { dependencies: { "@useagentsio/tool-github": "^1.1.0" } },
    });
    writeRegistryIndex(registryRoot);
    const updatedRegistry = loadRegistry(registryRoot);
    const plan = planUpdate({
      projectRoot: dir,
      registry: updatedRegistry,
      id: "tool:github",
      project: createDefaultProject({ slug: "gh", name: "gh" }),
      manifest: installed.plan.manifest,
    });
    expect(plan.packageDependencies["@useagentsio/tool-github"]).toBe("^1.1.0");
    applyUpdate({ projectRoot: dir, plan });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@useagentsio/tool-github"]).toBe("^1.1.0");
  });

  it("removes an unshared implementation package when the last Module is removed", () => {
    const impl = makeTempDir("vibekit-impl-rm-");
    fs.writeFileSync(
      path.join(impl, "package.json"),
      `${JSON.stringify({ name: "fixture-rm-tool", type: "module", main: "index.js" }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(impl, "index.js"), "export function createFixtureTool() { return {}; }\n");
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "only",
        runtime: { kind: "pi-extension", package: "fixture-rm-tool", export: "createFixtureTool" },
        packages: { dependencies: { "fixture-rm-tool": `file:${impl}` } },
      },
    ]);
    const dir = makeTempDir("vibekit-pkg-rm-");
    const project = createDefaultProject({ slug: "rm", name: "rm" });
    writeProjectDocument(dir, project);
    writeInstalledManifest(dir, emptyInstalledManifest());
    const registry = loadRegistry(registryRoot);
    const installed = applyInstall({
      projectRoot: dir,
      plan: planInstall({
        projectRoot: dir,
        registry,
        roots: ["tool:only"],
        project,
        manifest: emptyInstalledManifest(),
      }),
    });
    expect(
      (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> })
        .dependencies["fixture-rm-tool"],
    ).toBe(`file:${impl}`);
    applyRemove({
      projectRoot: dir,
      plan: planRemove({
        projectRoot: dir,
        registry,
        id: "tool:only",
        project: installed.plan.project,
        manifest: installed.plan.manifest,
      }),
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["fixture-rm-tool"]).toBeUndefined();
  });
});
