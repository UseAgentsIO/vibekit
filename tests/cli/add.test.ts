import fs from "node:fs";
import path from "node:path";

import { parseAndValidateJson, parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { buildTempRegistry, makeTempDir, officialRegistryDir } from "../helpers.js";

async function initProject(): Promise<string> {
  const dir = makeTempDir("vibekit-add-");
  const result = await runCli(["init", dir, "--registry", officialRegistryDir]);
  expect(result.exitCode, result.stderr).toBe(0);
  return dir;
}

describe("acceptance 2-4: add", () => {
  it("installs one Component and records ownership", async () => {
    const dir = await initProject();
    const result = await runCli([
      "add",
      "policy",
      "least-privilege",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policies/least-privilege.yaml"))).toBe(
      true,
    );

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    expect(installed.valid).toBe(true);
    const record = installed.data?.modules.find((module) => module.id === "policy:least-privilege");
    expect(record).toBeDefined();
    expect(record?.files[0]?.path).toBe(".vibekit/components/policies/least-privilege.yaml");
    expect(record?.files[0]?.ownership).toBe("exclusive");
    expect(record?.files[0]?.hash.startsWith("sha256:")).toBe(true);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.data?.policies).toContain("policy:least-privilege");
  });

  it("adds agent coder and installs required dependencies", async () => {
    const dir = await initProject();
    const result = await runCli([
      "add",
      "agent",
      "coder",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("agent:coder@1.0.0");
    expect(result.stdout).toContain("skill:software-development@1.0.0");
    expect(result.stdout).toContain("state:repository@1.0.0");
    expect(result.stdout).toContain("verifier:command@1.0.0");
    expect(result.stdout).toContain("Recommended (not installed):");
    expect(result.stdout).toContain("policy:require-verification");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/instructions.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/skills/software-development/SKILL.md"))).toBe(true);

    const installed = JSON.parse(
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    ) as { modules: Array<{ id: string }> };
    const ids = installed.modules.map((module) => module.id).sort();
    expect(ids).toEqual([
      "agent:coder",
      "skill:software-development",
      "state:repository",
      "verifier:command",
    ]);
    expect(ids).not.toContain("policy:require-verification");
    expect(ids).not.toContain("tool:github");
  });

  it("shows requested permissions before applying changes", async () => {
    const dir = await initProject();
    const result = await runCli([
      "add",
      "tool",
      "filesystem",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    const permissionsIndex = result.stdout.indexOf("Requested permissions:");
    const installedIndex = result.stdout.indexOf("Installed:");
    expect(permissionsIndex).toBeGreaterThan(-1);
    expect(installedIndex).toBeGreaterThan(permissionsIndex);
    expect(result.stdout).toContain("source.read");
    expect(result.stdout).toContain("source.write");
  });

  it("rolls back when installation fails", async () => {
    const dir = await initProject();
    const first = await runCli([
      "add",
      "policy",
      "least-privilege",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(first.exitCode, first.stderr).toBe(0);
    const before = fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8");
    const projectBefore = fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8");

    const registry = buildTempRegistry(
      [
        {
          type: "policy",
          name: "missing-dep",
          required: ["policy:does-not-exist"],
        },
      ],
      { allowMissingDeps: true },
    );
    const failed = await runCli([
      "add",
      "policy",
      "missing-dep",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toMatch(/required_dependency_missing|undeclared_dependency|module_not_found/);
    expect(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8")).toBe(projectBefore);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/policies/least-privilege.yaml"))).toBe(
      true,
    );
  });
});
