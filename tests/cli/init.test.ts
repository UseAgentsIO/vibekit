import fs from "node:fs";
import path from "node:path";

import { parseAndValidateJson, parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("acceptance 1: init", () => {
  it("creates a valid Project in a clean fixture", async () => {
    const dir = makeTempDir("vibekit-init-");
    const result = await runCli(["init", dir, "--registry", officialRegistryDir]);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Initialized VibeKit Project/);
    expect(result.stdout).toMatch(/files created/);

    expect(fs.existsSync(path.join(dir, ".pi/extensions/vibekit/index.ts"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".vibekit/project.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/installed.json"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".vibekit/runtime/");

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.errors, JSON.stringify(project.errors)).toEqual([]);
    expect(project.valid).toBe(true);
    expect(project.data?.agentBindings).toEqual({});
    expect(project.data?.schemaVersion).toBe(2);
    expect(project.data?.runtime?.host).toBe("@useagentsio/host");

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    expect(installed.valid).toBe(true);
    expect(installed.data?.modules).toEqual([]);
    expect(result.stdout).toMatch(/doctor: ok/);
  });

  it("skips the setup wizard with --defaults", async () => {
    const dir = makeTempDir("vibekit-init-defaults-");
    const result = await runCli(["init", dir, "--defaults", "--registry", officialRegistryDir]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Skipped setup/);
    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid).toBe(true);
    expect(project.data?.agentBindings).toEqual({});
    expect(project.data?.defaults?.model).toBeUndefined();
  });

  it("applies flag-driven setup without a TTY", async () => {
    const dir = makeTempDir("vibekit-init-flags-");
    const result = await runCli([
      "init",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--agent",
      "reviewer",
      "--interface",
      "terminal",
      "--skill",
      "software-development",
      "--tool",
      "filesystem",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Initialized VibeKit Project/);
    expect(result.stdout).toMatch(/Reviewer/);
    expect(result.stdout).toMatch(/gpt-5 via OpenAI/);
    expect(result.stdout).not.toMatch(/\.vibekit\/agents\/reviewer\/agent\.yaml/);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid, JSON.stringify(project.errors)).toBe(true);
    expect(project.data?.defaultAgent).toBe("reviewer");
    expect(project.data?.defaults?.model).toEqual({ provider: "openai", id: "gpt-5" });
    expect(project.data?.interfaceBindings?.["terminal-main"]?.definition).toBe("interface:terminal");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/reviewer/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/components/providers/openai.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/config/tools/filesystem.yaml"))).toBe(true);
  });

  it("lists created files with --show-files", async () => {
    const dir = makeTempDir("vibekit-init-files-");
    const result = await runCli([
      "init",
      dir,
      "--defaults",
      "--show-files",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Created:/);
    expect(result.stdout).toMatch(/\.vibekit\/project\.yaml/);
  });

  it("rejects --model without --provider in non-interactive mode", async () => {
    const dir = makeTempDir("vibekit-init-model-only-");
    const result = await runCli([
      "init",
      dir,
      "--model",
      "gpt-5",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--provider|provider_required/);
  });
});
