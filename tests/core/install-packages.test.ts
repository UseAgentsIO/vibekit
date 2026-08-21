import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  readInstalledManifest,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("install package dependencies", () => {
  it("copies a file: implementation package into the Project", () => {
    const impl = makeTempDir("vibekit-impl-");
    fs.writeFileSync(
      path.join(impl, "package.json"),
      `${JSON.stringify({ name: "fixture-example-tool", type: "module", main: "index.js" }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(impl, "index.js"), "export function createFixtureTool() { return {}; }\n");

    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "fixture-example",
        capabilities: ["web.fetch"],
        runtime: {
          kind: "pi-extension",
          package: "fixture-example-tool",
          export: "createFixtureTool",
        },
        packages: { dependencies: { "fixture-example-tool": `file:${impl}` } },
      },
    ]);
    const dir = makeTempDir("vibekit-pkgdep-");
    writeProjectDocument(dir, createDefaultProject({ slug: "pkg", name: "pkg" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const plan = planInstall({
      projectRoot: dir,
      registry: loadRegistry(registryRoot),
      roots: ["tool:fixture-example"],
      project: createDefaultProject({ slug: "pkg", name: "pkg" }),
      manifest: emptyInstalledManifest(),
    });
    expect(plan.packageDependencies["fixture-example-tool"]).toBe(`file:${impl}`);
    applyInstall({ projectRoot: dir, plan });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["fixture-example-tool"]).toBe(`file:${impl}`);
    expect(fs.existsSync(path.join(dir, "node_modules/fixture-example-tool/index.js"))).toBe(true);
    expect(readInstalledManifest(dir).modules.some((module) => module.id === "tool:fixture-example")).toBe(
      true,
    );
  });

  it("rejects conflicting package specs", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "one",
        packages: { dependencies: { leftpad: "^1.0.0" } },
      },
      {
        type: "tool",
        name: "two",
        packages: { dependencies: { leftpad: "^2.0.0" } },
      },
    ]);
    expect(() =>
      planInstall({
        projectRoot: makeTempDir("vibekit-pkgconflict-"),
        registry: loadRegistry(registryRoot),
        roots: ["tool:one", "tool:two"],
        project: createDefaultProject({ slug: "pkg", name: "pkg" }),
        manifest: emptyInstalledManifest(),
      }),
    ).toThrow(/Conflicting package dependency/);
  });

  it("preserves an existing compatible package range", () => {
    const registryRoot = buildTempRegistry([{ type: "tool", name: "compatible", packages: { dependencies: { leftpad: "^1.2.0" } } }]);
    const dir = makeTempDir("vibekit-pkg-compatible-");
    fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "compatible", dependencies: { leftpad: "^1.2.1" } }, null, 2)}\n`);
    const project = createDefaultProject({ slug: "compatible", name: "compatible" });
    writeProjectDocument(dir, project);
    writeInstalledManifest(dir, emptyInstalledManifest());
    const plan = planInstall({
      projectRoot: dir,
      registry: loadRegistry(registryRoot),
      roots: ["tool:compatible"],
      project,
      manifest: emptyInstalledManifest(),
    });

    applyInstall({ projectRoot: dir, plan });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.leftpad).toBe("^1.2.1");
  });

  it("treats workspace package declarations as compatible with registry ranges", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "workspace-compatible",
        packages: { dependencies: { "@useagentsio/example-runtime": "^1.2.0" } },
      },
    ]);
    const dir = makeTempDir("vibekit-pkg-workspace-");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify(
        { name: "workspace-compatible", dependencies: { "@useagentsio/example-runtime": "workspace:*" } },
        null,
        2,
      )}\n`,
    );
    const project = createDefaultProject({ slug: "workspace-compatible", name: "workspace-compatible" });
    writeProjectDocument(dir, project);
    writeInstalledManifest(dir, emptyInstalledManifest());
    const previous = process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;
    process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = "1";
    try {
      const plan = planInstall({
        projectRoot: dir,
        registry: loadRegistry(registryRoot),
        roots: ["tool:workspace-compatible"],
        project,
        manifest: emptyInstalledManifest(),
      });
      expect(() => applyInstall({ projectRoot: dir, plan })).not.toThrow();
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      expect(pkg.dependencies["@useagentsio/example-runtime"]).toBe("workspace:*");
    } finally {
      if (previous === undefined) delete process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;
      else process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = previous;
    }
  });

  it("does not execute file: package lifecycle scripts", () => {
    const impl = makeTempDir("vibekit-impl-scripts-");
    fs.writeFileSync(
      path.join(impl, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture-script-tool",
          type: "module",
          main: "index.js",
          scripts: { preinstall: "node -e \"require('fs').writeFileSync('RAN.txt','yes')\"" },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(path.join(impl, "index.js"), "export function createFixtureTool() { return {}; }\n");
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "scripted",
        runtime: { kind: "pi-extension", package: "fixture-script-tool", export: "createFixtureTool" },
        packages: { dependencies: { "fixture-script-tool": `file:${impl}` } },
      },
    ]);
    const dir = makeTempDir("vibekit-pkgscript-");
    writeProjectDocument(dir, createDefaultProject({ slug: "pkg", name: "pkg" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const plan = planInstall({
      projectRoot: dir,
      registry: loadRegistry(registryRoot),
      roots: ["tool:scripted"],
      project: createDefaultProject({ slug: "pkg", name: "pkg" }),
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot: dir, plan });
    expect(fs.existsSync(path.join(dir, "RAN.txt"))).toBe(false);
    expect(fs.existsSync(path.join(impl, "RAN.txt"))).toBe(false);
  });

  it("rolls back package.json, lockfile, and node_modules when package install fails", () => {
    const previous = process.env.VIBEKIT_FORCE_PACKAGE_INSTALL;
    process.env.VIBEKIT_FORCE_PACKAGE_INSTALL = "1";
    const dir = makeTempDir("vibekit-pkgfail-");
    const originalPkg = {
      name: "pkgfail",
      private: true,
      type: "module",
      dependencies: { leftover: "1.0.0" },
    };
    fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(originalPkg, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3 }, null, 2)}\n`);
    fs.mkdirSync(path.join(dir, "node_modules/leftover"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/leftover/index.js"), "export default 1\n");
    writeProjectDocument(dir, createDefaultProject({ slug: "pkgfail", name: "pkgfail" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "missing-npm",
        runtime: {
          kind: "pi-extension",
          package: "this-package-does-not-exist-vibekit-xyz",
          export: "createTool",
        },
        packages: {
          dependencies: { "this-package-does-not-exist-vibekit-xyz": "99.0.0" },
        },
      },
    ]);
    const plan = planInstall({
      projectRoot: dir,
      registry: loadRegistry(registryRoot),
      roots: ["tool:missing-npm"],
      project: createDefaultProject({ slug: "pkgfail", name: "pkgfail" }),
      manifest: emptyInstalledManifest(),
    });
    expect(() => applyInstall({ projectRoot: dir, plan })).toThrow(
      /Failed to install Module package dependencies/,
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ leftover: "1.0.0" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"))).toEqual({
      lockfileVersion: 3,
    });
    expect(fs.existsSync(path.join(dir, "node_modules/leftover/index.js"))).toBe(true);
    expect(readInstalledManifest(dir).modules).toEqual([]);
    if (previous === undefined) {
      delete process.env.VIBEKIT_FORCE_PACKAGE_INSTALL;
    } else {
      process.env.VIBEKIT_FORCE_PACKAGE_INSTALL = previous;
    }
  });
});
