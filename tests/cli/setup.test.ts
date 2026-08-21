import fs from "node:fs";
import path from "node:path";

import { parseAndValidateYaml, readProjectDocument, writeProjectDocument } from "@useagentsio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runMsg = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("../../packages/cli/src/commands/msg.js", () => ({ runMsg }));

import { parseCliArgs } from "../../packages/cli/src/args.js";
import { runSetup } from "../../packages/cli/src/commands/setup.js";
import { OutputBuffer } from "../../packages/cli/src/output.js";
import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("setup and product entry point", () => {
  beforeEach(() => {
    runMsg.mockClear();
  });

  it("composes a useful default and reruns without overwriting choices", async () => {
    const dir = makeTempDir("vibekit-setup-");
    const first = parseCliArgs([
      "setup",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    const firstOut = new OutputBuffer();
    expect(await runSetup(first.positionals, first.flags, firstOut, { openInterface: false })).toBe(0);

    const projectPath = path.join(dir, ".vibekit", "project.yaml");
    const initial = readProjectDocument(dir);
    expect(initial.defaultAgent).toBe("assistant");
    expect(initial.interfaceBindings?.["terminal-main"]?.enabled).toBe(true);
    expect(initial.defaults?.model).toEqual({ provider: "openai", id: "gpt-5" });
    expect(initial.capabilityBindings["source.read"]).toBe("tool:filesystem");
    expect(initial.capabilityBindings["memory.write"]).toBe("tool:memory");
    expect(initial.policies).toContain("policy:least-privilege");
    expect(fs.existsSync(path.join(dir, ".vibekit/config/policies/least-privilege.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/config/state/memory.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/config/tools/memory.yaml"))).toBe(true);

    writeProjectDocument(dir, { ...initial, name: "User Project", workspace: "workspace" });
    const second = parseCliArgs(["setup", dir, "--yes", "--registry", officialRegistryDir]);
    const secondOut = new OutputBuffer();
    expect(await runSetup(second.positionals, second.flags, secondOut, { openInterface: false })).toBe(0);

    const rerun = readProjectDocument(dir);
    expect(rerun.name).toBe("User Project");
    expect(rerun.workspace).toBe("workspace");
    expect(rerun.defaults?.model).toEqual({ provider: "openai", id: "gpt-5" });
    const parsed = parseAndValidateYaml("project", fs.readFileSync(projectPath, "utf8"));
    expect(parsed.valid, JSON.stringify(parsed.errors)).toBe(true);
  });

  it("runs the same controlled conversation proof before completing first-run setup", async () => {
    const dir = makeTempDir("vibekit-first-run-");
    const parsed = parseCliArgs([
      "setup",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    const out = new OutputBuffer();
    expect(await runSetup(parsed.positionals, parsed.flags, out)).toBe(0);
    expect(runMsg).toHaveBeenCalledWith(
      [expect.stringContaining("Reply with exactly READY")],
      expect.objectContaining({ dir }),
      out,
    );
    expect(out.stdout).toContain("Conversation check: ready.");
    expect(out.stdout).not.toContain("Next:");
    expect(out.stdout).not.toContain("vibekit msg");
  });

  it("keeps project composition behind the explicit advanced builder", async () => {
    const dir = makeTempDir("vibekit-project-builder-");
    const result = await runCli([
      "project",
      "create",
      dir,
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Created VibeKit Project");
    expect(readProjectDocument(dir).defaultAgent).toBe("assistant");
  });
});
