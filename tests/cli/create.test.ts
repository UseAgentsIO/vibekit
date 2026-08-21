import fs from "node:fs";
import path from "node:path";

import {
  loadInstalledProviders,
  parseAndValidateJson,
  parseAndValidateYaml,
  resolveEffectiveAuthority,
  type TaskDocument,
} from "@useagentsio/core";
import { createGuardedBuiltinTools } from "@useagentsio/pi";
import {
  createMemoryStore,
  createMemoryTool,
  isSqliteAvailable,
} from "../../packages/cli/src/internal/state/memory/index.js";
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
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(false);
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
      "personal",
      "project-manager",
      "researcher",
      "reviewer",
    ]);
    expect(project.data?.delegation?.chief).toEqual([
      "project-manager",
      "coder",
      "reviewer",
      "researcher",
      "personal",
    ]);
    expect(project.data?.interfaceBindings?.["terminal-main"]?.defaultAgent).toBe("chief");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/coder/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/reviewer/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/chief/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(false);
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

  it("uses one useful general Agent and installs only its required composition by default", async () => {
    const dir = makeTempDir("vibekit-create-useful-default-");
    const result = await runCli([
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

    const project = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(project.data?.defaultAgent).toBe("assistant");
    expect(Object.keys(project.data?.agentBindings ?? {})).toEqual(["assistant"]);
    expect(project.data?.capabilityBindings).toEqual(
      expect.objectContaining({
        "source.read": "tool:filesystem",
        "source.write": "tool:filesystem",
        "command.execute": "tool:execution",
        "web.search": "tool:web",
        "memory.read": "tool:memory",
        "memory.write": "tool:memory",
      }),
    );

    const installed = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    const ids = new Set(installed.data?.modules.map((module) => module.id) ?? []);
    expect(ids).toEqual(
      new Set([
        "agent:assistant",
        "interface:terminal",
        "policy:least-privilege",
        "provider:openai",
        "state:memory",
        "state:repository",
        "tool:execution",
        "tool:filesystem",
        "tool:memory",
        "tool:web",
      ]),
    );
    expect(fs.existsSync(path.join(dir, ".vibekit/config/state/memory.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/config/tools/memory.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/state/memory.sqlite"))).toBe(false);
  });

  it("proves the default Agent can write a scoped file, execute a scoped command, and retain memory", async () => {
    if (!isSqliteAvailable()) {
      return;
    }
    const dir = makeTempDir("vibekit-create-useful-task-");
    const result = await runCli([
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

    const projectResult = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    const agentResult = parseAndValidateYaml(
      "agent",
      fs.readFileSync(path.join(dir, ".vibekit/agents/assistant/agent.yaml"), "utf8"),
    );
    expect(projectResult.valid, JSON.stringify(projectResult.errors)).toBe(true);
    expect(agentResult.valid, JSON.stringify(agentResult.errors)).toBe(true);
    if (projectResult.data === undefined || agentResult.data === undefined) {
      throw new Error("default Project or Agent could not be parsed");
    }

    const task = {
      schemaVersion: 1,
      id: "task_550e8400-e29b-41d4-a716-446655440099",
      projectId: projectResult.data.id,
      objective: "Record a project note and remember the decision.",
      context: { references: [] },
      constraints: [],
      acceptanceCriteria: ["The note can be read back and the decision can be searched."],
      requiredCapabilities: [],
      assignedAgent: "agent:assistant",
      claimedBy: null,
      scope: { paths: ["notes.txt"], resources: ["git status"] },
      dependencies: [],
      priority: "normal",
      delivery: { mode: "apply" },
      authorization: { state: "standing" },
      status: "open",
      revision: 1,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    } as TaskDocument;
    const authority = resolveEffectiveAuthority({
      project: projectResult.data,
      agent: agentResult.data,
      task,
      installedProviders: loadInstalledProviders(dir),
    });
    expect(authority.capabilities).toEqual(
      expect.arrayContaining([
        "source.read",
        "source.write",
        "command.execute",
        "web.search",
        "memory.read",
        "memory.write",
      ]),
    );

    const guarded = Object.fromEntries(
      createGuardedBuiltinTools({
        cwd: dir,
        authority,
        project: projectResult.data,
        task,
      }).map((tool) => [tool.name, tool]),
    );
    await guarded.write?.execute({ path: "notes.txt", content: "A scoped VibeKit note." });
    await expect(guarded.read?.execute({ path: "notes.txt" })).resolves.toBe(
      "A scoped VibeKit note.",
    );
    await expect(guarded.bash?.execute({ command: "git status" })).resolves.toMatchObject({
      exitCode: expect.any(Number),
    });

    const store = createMemoryStore({ projectRoot: dir });
    try {
      const memory = createMemoryTool({ projectRoot: dir, store });
      await expect(
        memory.execute(
          { action: "store", target: "notes", content: "The scoped note is complete." },
          { grantedCapabilities: authority.capabilities },
        ),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        memory.execute(
          { action: "search", target: "notes", query: "scoped note" },
          { grantedCapabilities: authority.capabilities },
        ),
      ).resolves.toMatchObject({
        ok: true,
        entries: [expect.objectContaining({ content: "The scoped note is complete." })],
      });
    } finally {
      store.close();
    }
    expect(projectResult.data.state.backend).toBe("state:repository");
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
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
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
    ]).finally(() => {
      if (telegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = telegramToken;
    });
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
    expect(project.data?.delegation?.chief).toEqual([
      "project-manager",
      "coder",
      "reviewer",
      "researcher",
      "personal",
    ]);
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
