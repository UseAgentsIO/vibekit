import fs from "node:fs";
import path from "node:path";

import {
  VibeKitError,
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  readInstalledManifest,
  resolveInstalledModule,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("installed module integrity", () => {
  it("fails closed when same-version registry runtime metadata is mutated after install", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "fixture-example",
        capabilities: ["web.fetch"],
        runtime: {
          kind: "pi-extension",
          package: "fixture-a",
          export: "createA",
        },
      },
    ]);
    const dir = makeTempDir("vibekit-integrity-");
    writeProjectDocument(dir, createDefaultProject({ slug: "int", name: "int" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const registry = loadRegistry(registryRoot);
    const plan = planInstall({
      projectRoot: dir,
      registry,
      roots: ["tool:fixture-example"],
      project: createDefaultProject({ slug: "int", name: "int" }),
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot: dir, plan });
    const record = readInstalledManifest(dir).modules[0]!;
    expect(resolveInstalledModule(record).document).toMatchObject({
      runtime: { package: "fixture-a" },
    });

    const moduleYaml = path.join(registryRoot, "components/tool/fixture-example/1.0.0/module.yaml");
    const text = fs.readFileSync(moduleYaml, "utf8").replace("fixture-a", "fixture-mutated");
    fs.writeFileSync(moduleYaml, text);
    expect(() => resolveInstalledModule(record)).toThrow(VibeKitError);
  });
});
