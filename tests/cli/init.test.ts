import fs from "node:fs";
import path from "node:path";

import { parseAndValidateJson, parseAndValidateYaml } from "@vibekit/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("acceptance 1: init", () => {
  it("creates a valid Project in a clean fixture", () => {
    const dir = makeTempDir("vibekit-init-");
    const result = runCli(["init", dir, "--registry", officialRegistryDir]);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Initialized VibeKit Project/);
    expect(result.stdout).toMatch(/Created:/);

    expect(fs.existsSync(path.join(dir, ".pi/settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/skills"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions/vibekit/index.ts"))).toBe(true);
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

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    expect(installed.valid).toBe(true);
    expect(installed.data?.modules).toEqual([]);
    expect(result.stdout).toMatch(/doctor: ok/);
  });
});
