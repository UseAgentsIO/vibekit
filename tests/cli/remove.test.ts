import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("acceptance 10-11: remove", () => {
  it("does not delete a modified file", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "sample",
        payload: "original\n",
      },
    ]);
    const dir = makeTempDir("vibekit-remove-mod-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const target = path.join(dir, ".vibekit/components/policy/sample.txt");
    fs.writeFileSync(target, "user changed this\n", "utf8");
    const installedBefore = fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8");

    const result = await runCli([
      "remove",
      "policy:sample",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/remove_modified|Modified files stop removal/);
    expect(result.stdout + result.stderr).toContain(".vibekit/components/policy/sample.txt");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("user changed this\n");
    expect(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")).toBe(installedBefore);
  });

  it("does not remove a dependency still used by another Module", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "shared",
        payload: "shared\n",
      },
      {
        type: "policy",
        name: "alpha",
        required: ["policy:shared"],
        payload: "alpha\n",
      },
      {
        type: "policy",
        name: "beta",
        required: ["policy:shared"],
        payload: "beta\n",
      },
    ]);
    const dir = makeTempDir("vibekit-remove-shared-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "alpha", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);
    expect(
      (await runCli(["add", "policy", "beta", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const result = await runCli([
      "remove",
      "policy:alpha",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("policy:shared");
    expect(result.stdout).toMatch(/Kept \(still used\)|Shared dependencies kept/);

    expect(fs.existsSync(path.join(dir, ".vibekit/components/policy/alpha.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policy/shared.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policy/beta.txt"))).toBe(true);

    const installed = JSON.parse(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")) as {
      modules: Array<{ id: string }>;
    };
    const ids = installed.modules.map((module) => module.id).sort();
    expect(ids).toEqual(["policy:beta", "policy:shared"]);
    expect(ids).not.toContain("policy:alpha");
  });

  it("removes unchanged exclusive files", async () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "sample",
        payload: "original\n",
      },
    ]);
    const dir = makeTempDir("vibekit-remove-clean-");
    expect((await runCli(["init", dir, "--registry", registry])).exitCode).toBe(0);
    expect(
      (await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registry])).exitCode,
    ).toBe(0);

    const result = await runCli([
      "remove",
      "policy:sample",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policy/sample.txt"))).toBe(false);
    const installed = JSON.parse(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")) as {
      modules: Array<{ id: string }>;
    };
    expect(installed.modules.map((module) => module.id)).not.toContain("policy:sample");
  });
});
