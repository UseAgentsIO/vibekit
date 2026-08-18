import fs from "node:fs";
import path from "node:path";

import { parseAndValidateYaml } from "@useagentsio/core";
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
      "gpt-4.1",
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
});
