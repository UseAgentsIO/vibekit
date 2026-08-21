import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildRegistryIndex, loadModuleFromDirectory } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir, officialRegistryDir } from "../helpers.js";

describe("Pi built-in registry components", () => {
  it("ships corrected execution and filesystem versions without Pi extension files", () => {
    const result = buildRegistryIndex(officialRegistryDir);
    for (const id of ["tool:execution", "tool:filesystem"]) {
      const corrected = result.index.modules.find((entry) => entry.id === id && entry.version === "1.1.0");
      expect(corrected, `${id}@1.1.0`).toBeDefined();
      const module = loadModuleFromDirectory(officialRegistryDir, path.join(officialRegistryDir, corrected!.path));
      expect(module.files.filter((file) => file.target.startsWith(".pi/extensions/")).length).toBe(0);
    }
  });

  it("keeps Host runtime bindings when corrected registry stubs are removed", () => {
    const result = buildRegistryIndex(officialRegistryDir);
    const expected = [
      ["tool:browser", "1.1.0", "vibekit:tool-browser", "createBrowserTool"],
      ["tool:execution", "1.1.0", undefined, undefined],
      ["tool:filesystem", "1.1.0", undefined, undefined],
      ["tool:github", "1.2.0", "vibekit:tool-github", "createGithubTool"],
      ["tool:mcp", "1.1.0", "vibekit:tool-mcp", "createMcpTool"],
      ["tool:memory", "1.3.0", "vibekit:state-memory", "createMemoryTool"],
      ["tool:process", "1.1.0", "vibekit:tool-process", "createProcessTool"],
      ["tool:scheduler", "1.1.0", "vibekit:tool-scheduler", "createSchedulerTool"],
      ["tool:web", "1.1.0", "vibekit:tool-web", "createWebTool"],
    ] as const;
    for (const [id, version, packageName, exportName] of expected) {
      const entry = result.index.modules.find((candidate) => candidate.id === id && candidate.version === version);
      expect(entry, `${id}@${version}`).toBeDefined();
      const module = loadModuleFromDirectory(officialRegistryDir, path.join(officialRegistryDir, entry!.path));
      expect(module.files.filter((file) => file.target.startsWith(".pi/extensions/")).length).toBe(0);
      const runtime = module.document.type === "agent" ? undefined : module.document.runtime;
      expect(runtime?.package).toBe(packageName);
      expect(runtime?.export).toBe(exportName);
    }
  });

  it("rejects a new pi-builtin module that installs a non-factory extension", () => {
    expect(() =>
      buildTempRegistry([
        {
          type: "tool",
          name: "invalid-builtin",
          version: "1.1.0",
          files: [
            {
              source: "payload/index.ts",
              target: ".pi/extensions/invalid-builtin/index.ts",
            },
          ],
          payload: "export const invalidBuiltin = {};\n",
          runtime: { kind: "pi-builtin", tools: ["bash"] },
        },
      ]),
    ).toThrow(/pi_builtin_extension_invalid|default-exported Pi extension factory/);
  });

  it("loads every current registry-owned Pi extension through the installed Pi loader", async () => {
    const registry = buildRegistryIndex(officialRegistryDir).index;
    const latest = new Map<string, (typeof registry.modules)[number]>();
    for (const entry of registry.modules) {
      // buildRegistryIndex emits each Module's versions in ascending order.
      latest.set(entry.id, entry);
    }

    const projectRoot = makeTempDir("vibekit-pi-registry-loader-");
    const extensionPaths: string[] = [];
    for (const entry of latest.values()) {
      const module = loadModuleFromDirectory(officialRegistryDir, path.join(officialRegistryDir, entry.path));
      for (const file of module.files) {
        if (!file.target.startsWith(".pi/extensions/")) {
          continue;
        }
        const target = path.join(projectRoot, file.target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(module.absolutePath, file.source), target);
        extensionPaths.push(target);
      }
    }

    const pi = await import(
      pathToFileURL(
        path.join(process.cwd(), "packages/cli/node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
      ).href,
    );
    const loader = new pi.DefaultResourceLoader({
      cwd: projectRoot,
      agentDir: path.join(projectRoot, ".pi-agent"),
      noExtensions: true,
      additionalExtensionPaths: extensionPaths,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();

    expect(loader.getExtensions().errors).toEqual([]);
  });
});
