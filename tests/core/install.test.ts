import fs from "node:fs";
import path from "node:path";

import {
  VibeKitError,
  applyInstall,
  loadRegistry,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  writeRegistryIndex,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";

import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("atomic install rollback", () => {
  it("removes files written before a later apply failure", async () => {
    const registryRoot = buildTempRegistry([
      {
        type: "policy",
        name: "multi",
        files: [
          {
            source: "payload/one.txt",
            target: ".vibekit/components/policies/one.txt",
            ownership: "exclusive",
          },
          {
            source: "payload/two.txt",
            target: ".vibekit/components/policies/two.txt",
            ownership: "exclusive",
          },
        ],
      },
    ]);
    fs.writeFileSync(
      path.join(registryRoot, "components/policy/multi/1.0.0/payload/one.txt"),
      "one\n",
    );
    fs.writeFileSync(
      path.join(registryRoot, "components/policy/multi/1.0.0/payload/two.txt"),
      "two\n",
    );
    writeRegistryIndex(registryRoot);
    const dir = makeTempDir("vibekit-rollback-");
    expect((await runCli(["init", dir, "--registry", registryRoot])).exitCode).toBe(0);
    const registry = loadRegistry(registryRoot);
    const plan = planInstall({
      projectRoot: dir,
      registry,
      roots: ["policy:multi"],
      project: readProjectDocument(dir),
      manifest: readInstalledManifest(dir),
    });
    fs.mkdirSync(path.join(dir, ".vibekit/components/policies/two.txt"), { recursive: true });

    expect(() => applyInstall({ projectRoot: dir, plan })).toThrow(VibeKitError);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policies/one.txt"))).toBe(false);
    expect(readInstalledManifest(dir).modules).toEqual([]);
    expect(readProjectDocument(dir).policies).toEqual([]);
  });
});
