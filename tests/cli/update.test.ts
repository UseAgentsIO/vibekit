import fs from "node:fs";
import path from "node:path";

import { writeRegistryIndex } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import {
  buildTempRegistry,
  makeTempDir,
  writeSyntheticComponent,
  type SyntheticComponentOptions,
} from "../helpers.js";

function publishVersion(registryRoot: string, options: SyntheticComponentOptions): void {
  writeSyntheticComponent(registryRoot, options);
  writeRegistryIndex(registryRoot);
}

describe("acceptance 8-9: update", () => {
  it("updates an unchanged Module automatically", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "sample",
        version: "1.0.0",
        payload: "v1\n",
      },
    ]);
    const dir = makeTempDir("vibekit-update-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const target = path.join(dir, ".vibekit/components/policy/sample.txt");
    expect(fs.readFileSync(target, "utf8")).toBe("v1\n");

    publishVersion(registry, {
      type: "policy",
      name: "sample",
      version: "1.1.0",
      payload: "v2\n",
    });

    const result = await runCli([
      "update",
      "policy:sample",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("Update policy:sample 1.0.0 → 1.1.0");
    expect(result.stdout).toContain("replace-upstream");
    expect(fs.readFileSync(target, "utf8")).toBe("v2\n");

    const installed = JSON.parse(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")) as {
      modules: Array<{ id: string; version: string }>;
    };
    expect(installed.modules.find((module) => module.id === "policy:sample")?.version).toBe("1.1.0");
    expect(fs.existsSync(path.join(dir, ".vibekit/runtime/generated/config.yaml"))).toBe(true);
  });

  it("stops the entire Module update when local and upstream both changed", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "multi",
        version: "1.0.0",
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
        payload: "placeholder\n",
      },
    ]);
    fs.writeFileSync(path.join(registry, "components/policy/multi/1.0.0/payload/one.txt"), "one-v1\n");
    fs.writeFileSync(path.join(registry, "components/policy/multi/1.0.0/payload/two.txt"), "two-v1\n");
    writeRegistryIndex(registry);

    const dir = makeTempDir("vibekit-update-conflict-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "multi", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const one = path.join(dir, ".vibekit/components/policies/one.txt");
    const two = path.join(dir, ".vibekit/components/policies/two.txt");
    fs.writeFileSync(one, "one-local\n", "utf8");
    const installedBefore = fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8");

    publishVersion(registry, {
      type: "policy",
      name: "multi",
      version: "1.1.0",
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
      payload: "placeholder\n",
    });
    fs.writeFileSync(path.join(registry, "components/policy/multi/1.1.0/payload/one.txt"), "one-v2\n");
    fs.writeFileSync(path.join(registry, "components/policy/multi/1.1.0/payload/two.txt"), "two-v2\n");
    writeRegistryIndex(registry);

    const result = await runCli([
      "update",
      "policy:multi",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/update_conflict|both changed/);
    expect(result.stdout).toContain(".vibekit/components/policies/one.txt");
    expect(fs.readFileSync(one, "utf8")).toBe("one-local\n");
    expect(fs.readFileSync(two, "utf8")).toBe("two-v1\n");
    expect(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")).toBe(installedBefore);
  });

  it("updates multiple selected Modules in one transaction", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "first",
        version: "1.0.0",
        payload: "first-v1\n",
      },
      {
        type: "policy",
        name: "second",
        version: "1.0.0",
        payload: "second-v1\n",
      },
    ]);
    const dir = makeTempDir("vibekit-update-batch-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "first", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);
    expect(
      (await runCli(["add", "policy", "second", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    publishVersion(registry, {
      type: "policy",
      name: "first",
      version: "1.1.0",
      payload: "first-v2\n",
    });
    publishVersion(registry, {
      type: "policy",
      name: "second",
      version: "1.1.0",
      payload: "second-v2\n",
    });

    const result = await runCli([
      "update",
      "policy:first",
      "policy:second",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("Update policy:first 1.0.0 → 1.1.0");
    expect(result.stdout).toContain("Update policy:second 1.0.0 → 1.1.0");
    expect(result.stdout).toContain("Updated policy:first to 1.1.0");
    expect(result.stdout).toContain("Updated policy:second to 1.1.0");
    expect(fs.readFileSync(path.join(dir, ".vibekit/components/policy/first.txt"), "utf8")).toBe("first-v2\n");
    expect(fs.readFileSync(path.join(dir, ".vibekit/components/policy/second.txt"), "utf8")).toBe("second-v2\n");
  });

  it("refuses an incompatible requested version", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "sample",
        version: "1.0.0",
        payload: "v1\n",
      },
    ]);
    const dir = makeTempDir("vibekit-update-compat-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const versionDir = writeSyntheticComponent(registry, {
      type: "policy",
      name: "sample",
      version: "2.0.0",
      payload: "v2\n",
    });
    const modulePath = path.join(versionDir, "module.yaml");
    const text = fs.readFileSync(modulePath, "utf8").replace(
      /vibekit:\s*["']?\^1\.0\.0["']?/,
      'vibekit: "^2.0.0"',
    );
    fs.writeFileSync(modulePath, text, "utf8");
    writeRegistryIndex(registry);

    const implicit = await runCli([
      "update",
      "policy:sample",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(implicit.exitCode, implicit.stderr + implicit.stdout).toBe(0);
    expect(implicit.stdout).toMatch(/Already current: policy:sample@1\.0\.0/);

    const explicit = await runCli([
      "update",
      "policy:sample@2.0.0",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(explicit.exitCode).toBe(1);
    expect(explicit.stderr).toMatch(/module_incompatible|compatibility/);
    const installed = JSON.parse(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")) as {
      modules: Array<{ id: string; version: string }>;
    };
    expect(installed.modules.find((module) => module.id === "policy:sample")?.version).toBe("1.0.0");
  });
});
