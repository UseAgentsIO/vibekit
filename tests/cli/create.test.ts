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
    expect(project.data?.agentBindings?.coder?.definition).toBe("agent:coder");
    expect(project.data?.interfaceBindings?.["terminal-main"]?.definition).toBe("interface:terminal");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/agent.yaml"))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(JSON.stringify(pkg.dependencies)).not.toContain("workspace:");
    expect(pkg.dependencies["@useagentsio/cli"]).toMatch(/^\^/);
    const createdProject = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(createdProject.data?.capabilityBindings?.["source.read"]).toBe("tool:filesystem");
    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    const ids = installed.data?.modules.map((module) => module.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["tool:filesystem", "tool:execution"]));
  });

  it("installs multiple Agents and uses Chief as the default front door", async () => {
    const dir = makeTempDir("vibekit-create-agents-");
    const result = await runCli([
      "create",
      dir,
      "--agent",
      "coder",
      "--agent",
      "reviewer",
      "--agent",
      "chief",
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
    expect(result.stdout).toMatch(/Agents: chief, coder, reviewer/);
    expect(result.stdout).toMatch(/Default agent: chief/);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid, JSON.stringify(project.errors)).toBe(true);
    expect(project.data?.defaultAgent).toBe("chief");
    expect(Object.keys(project.data?.agentBindings ?? {}).sort()).toEqual([
      "chief",
      "coder",
      "reviewer",
    ]);
    expect(project.data?.delegation?.chief).toEqual(["coder", "reviewer"]);
    expect(project.data?.interfaceBindings?.["terminal-main"]?.defaultAgent).toBe("chief");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/reviewer/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/chief/agent.yaml"))).toBe(true);
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

  it("does not auto-install optional catalog Components", async () => {
    const dir = makeTempDir("vibekit-create-optional-");
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
    expect(created.exitCode, created.stderr).toBe(0);
    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    const ids = new Set<string>(installed.data?.modules.map((module) => module.id) ?? []);
    for (const optional of [
      "state:memory",
      "tool:memory",
      "interface:http",
      "interface:webhook",
      "interface:schedule",
      "interface:slack",
      "interface:telegram",
      "tool:web",
      "tool:browser",
      "tool:mcp",
      "tool:process",
      "tool:scheduler",
      "policy:interface-pairing",
      "policy:untrusted-inbound",
      "policy:memory-write-approval",
      "policy:schedule-no-recurse",
      "skill:memory-hygiene",
      "skill:browser-use",
      "skill:scheduler",
      "verifier:schema",
    ]) {
      expect(ids.has(optional), optional).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, ".vibekit/state/memory.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".vibekit/state/schedules"))).toBe(false);
  });

  it("scaffolds the headquarters example with Telegram and Personal", async () => {
    const dir = makeTempDir("vibekit-create-hq-");
    const result = await runCli([
      "create",
      dir,
      "--example",
      "headquarters",
      "--provider",
      "openai",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Example: headquarters/);
    expect(result.stdout).toMatch(/TELEGRAM_BOT_TOKEN is not set/);

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.valid, JSON.stringify(project.errors)).toBe(true);
    expect(project.data?.defaultAgent).toBe("chief");
    expect(project.data?.agentBindings?.personal?.definition).toBe("agent:personal");
    expect(project.data?.delegation?.chief).toEqual(["personal"]);
    expect(project.data?.interfaceBindings?.["telegram-main"]?.definition).toBe(
      "interface:telegram",
    );
    expect(project.data?.policies).toEqual(
      expect.arrayContaining(["policy:interface-pairing", "policy:untrusted-inbound"]),
    );

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    const ids = installed.data?.modules.map((module) => module.id) ?? [];
    expect(ids).toContain("agent:chief");
    expect(ids).toContain("agent:personal");
    expect(ids).toContain("interface:telegram");
    expect(ids).toContain("policy:interface-pairing");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/personal/agent.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".vibekit/config/interfaces/telegram.yaml"), "utf8")).toMatch(
      /optionalStart: true/,
    );
  });
});
