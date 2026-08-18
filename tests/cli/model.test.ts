import fs from "node:fs";
import path from "node:path";

import { parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("model", () => {
  it("writes defaults.model without prompting when flags are passed", async () => {
    const dir = makeTempDir("vibekit-model-");
    const created = await runCli([
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
    expect(created.exitCode, created.stderr).toBe(0);

    const result = await runCli([
      "model",
      "--dir",
      dir,
      "--provider",
      "openrouter",
      "--model",
      "anthropic/claude-sonnet-4.5",
      "--yes",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Using openrouter / anthropic/claude-sonnet-4.5");

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.data?.defaults?.model).toEqual({
      provider: "openrouter",
      id: "anthropic/claude-sonnet-4.5",
    });
  });

  it("refuses non-interactive create without --model", async () => {
    const dir = makeTempDir("vibekit-model-required-");
    const result = await runCli([
      "create",
      dir,
      "--provider",
      "openai",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--model|model_required/);
  });
});
