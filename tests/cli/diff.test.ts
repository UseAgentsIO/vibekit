import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { officialRegistryDir, makeTempDir } from "../helpers.js";

describe("acceptance 7: diff detects local Agent edits", () => {
  it("reports local edits and does not modify the Project", async () => {
    const dir = makeTempDir("vibekit-diff-");
    expect((await runCli(["init", dir, "--registry", officialRegistryDir])).exitCode).toBe(0);
    const added = await runCli([
      "add",
      "agent",
      "coder",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(added.exitCode, added.stderr + added.stdout).toBe(0);

    const instructions = path.join(dir, ".vibekit/agents/coder/instructions.md");
    const beforeInstructions = fs.readFileSync(instructions, "utf8");
    const beforeInstalled = fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8");
    const beforeProject = fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8");
    fs.writeFileSync(instructions, `${beforeInstructions}\nlocal agent edit\n`, "utf8");

    const result = await runCli(["diff", "agent:coder", "--dir", dir, "--registry", officialRegistryDir]);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("agent:coder");
    expect(result.stdout).toContain(".vibekit/agents/coder/instructions.md");
    expect(result.stdout).toMatch(/status:\s+local/);
    expect(result.stdout).toContain("local: changed");
    expect(result.stdout).toContain("Local edits detected.");

    expect(fs.readFileSync(instructions, "utf8")).toContain("local agent edit");
    expect(fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8")).toBe(beforeInstalled);
    expect(fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8")).toBe(beforeProject);
    expect(fs.existsSync(path.join(dir, ".vibekit/runtime/generated/config.yaml"))).toBe(false);
  });

  it("accepts the split type name form", async () => {
    const dir = makeTempDir("vibekit-diff-split-");
    expect((await runCli(["init", dir, "--registry", officialRegistryDir])).exitCode).toBe(0);
    expect(
      (await runCli([
        "add",
        "policy",
        "least-privilege",
        "--yes",
        "--dir",
        dir,
        "--registry",
        officialRegistryDir,
      ])).exitCode,
    ).toBe(0);

    const result = await runCli([
      "diff",
      "policy",
      "least-privilege",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("policy:least-privilege");
    expect(result.stdout).toContain("status: unchanged");
  });
});
