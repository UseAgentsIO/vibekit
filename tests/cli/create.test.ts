import fs from "node:fs";
import path from "node:path";

import { parseAndValidateJson, parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("create", () => {
  it("creates a schemaVersion 2 Project with a terminal binding", async () => {
    const dir = makeTempDir("vibekit-create-");
    const result = await runCli([
      "create",
      dir,
      "--agent",
      "coder",
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--interface",
      "terminal",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Created VibeKit Project/);
    expect(result.stdout).toMatch(/vibekit msg/);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid, JSON.stringify(project.errors)).toBe(true);
    expect(project.data?.schemaVersion).toBe(2);
    expect(project.data?.defaultAgent).toBe("coder");
    expect(project.data?.interfaceBindings?.["terminal-main"]?.definition).toBe("interface:terminal");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/agent.yaml"))).toBe(true);
  });

  it("defaults a model when --yes is used without --model", async () => {
    const dir = makeTempDir("vibekit-create-default-model-");
    const result = await runCli([
      "create",
      dir,
      "--yes",
      "--provider",
      "openai",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid, JSON.stringify(project.errors)).toBe(true);
    expect(project.data?.defaults?.model?.provider).toBe("openai");
    expect(project.data?.defaults?.model?.id).toEqual(expect.any(String));
    expect(project.data?.defaults?.model?.id?.length).toBeGreaterThan(0);
  });

  it("installs the selected provider and interface", async () => {
    const dir = makeTempDir("vibekit-create-install-");
    const created = await runCli([
      "create",
      dir,
      "--agent",
      "chief",
      "--provider",
      "openai",
      "--interface",
      "terminal",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(created.stderr, created.stderr).toBe("");
    expect(created.exitCode).toBe(0);

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    expect(installed.valid, JSON.stringify(installed.errors)).toBe(true);
    const ids = installed.data?.modules.map((module) => module.id) ?? [];
    expect(ids).toContain("provider:openai");
    expect(ids).toContain("interface:terminal");

    const listed = await runCli(["list", "--dir", dir, "--registry", officialRegistryDir]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(listed.stdout).toMatch(/provider:openai\s+\S+\s+\S+\s+yes\b/);
    expect(listed.stdout).toMatch(/interface:terminal\s+\S+\s+\S+\s+yes\b/);
  });
});
