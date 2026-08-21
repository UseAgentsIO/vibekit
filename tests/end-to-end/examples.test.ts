import fs from "node:fs";
import path from "node:path";

import {
  loadRegistry,
  OFFICIAL_REGISTRY_SOURCE,
  parseAndValidateJson,
  parseAndValidateYaml,
  readInstalledManifest,
  readProjectDocument,
  resolveInstalledModule,
  resolveInstalledModuleRuntime,
  runDoctor,
  validateFileTarget,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { bindInstalledTools, VibeKitHost } from "@useagentsio/host";
import { createFakeInterface } from "@useagentsio/interface-sdk";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

const HQ_README = path.resolve("docs/examples/headquarters/README.md");

describe("maintained example Projects", () => {
  it("headquarters create output stays internally coherent", async () => {
    const dir = makeTempDir("vibekit-example-hq-");
    const created = await runCli([
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
    expect(created.exitCode, created.stderr + created.stdout).toBe(0);

    const project = readProjectDocument(dir);
    const projectCheck = parseAndValidateYaml(
      "project",
      fs.readFileSync(path.join(dir, ".vibekit/project.yaml"), "utf8"),
    );
    expect(projectCheck.valid, JSON.stringify(projectCheck.errors)).toBe(true);

    const manifest = readInstalledManifest(dir);
    const installedCheck = parseAndValidateJson(
      "installed",
      fs.readFileSync(path.join(dir, ".vibekit/installed.json"), "utf8"),
    );
    expect(installedCheck.valid, JSON.stringify(installedCheck.errors)).toBe(true);

    const doctor = runDoctor({
      projectRoot: dir,
      registry: loadRegistry(officialRegistryDir, OFFICIAL_REGISTRY_SOURCE),
    });
    expect(doctor.errorCount, JSON.stringify(doctor.findings, null, 2)).toBe(0);

    const ids = manifest.modules.map((module) => module.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "agent:chief",
        "agent:coder",
        "agent:project-manager",
        "agent:reviewer",
        "agent:researcher",
        "agent:personal",
        "provider:openai",
        "interface:telegram",
        "policy:interface-pairing",
        "policy:untrusted-inbound",
      ]),
    );
    for (const record of manifest.modules) {
      expect(record.registrySource, record.id).toBe(OFFICIAL_REGISTRY_SOURCE);
      const loaded = resolveInstalledModule(record);
      expect(loaded.id).toBe(record.id);
      expect(loaded.version).toBe(record.version);
      for (const file of record.files) {
        expect(validateFileTarget(file.path).valid, file.path).toBe(true);
        expect(path.isAbsolute(file.path)).toBe(false);
        expect(file.path.includes("..")).toBe(false);
      }
    }

    expect(project.defaultAgent).toBe("chief");
    expect(project.agentBindings.chief?.definition).toBe("agent:chief");
    expect(project.agentBindings.personal?.definition).toBe("agent:personal");
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/chief/agent.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".vibekit/agents/personal/agent.yaml"))).toBe(true);
    expect(project.delegation.chief).toEqual([
      "project-manager",
      "coder",
      "reviewer",
      "researcher",
      "personal",
    ]);

    const telegram = project.interfaceBindings?.["telegram-main"];
    expect(telegram?.enabled).toBe(true);
    expect(telegram?.definition).toBe("interface:telegram");
    const telegramRecord = manifest.modules.find((module) => module.id === "interface:telegram");
    expect(telegramRecord).toBeDefined();
    const telegramRuntime = resolveInstalledModuleRuntime(telegramRecord!);
    expect(telegramRuntime?.kind).toBe("interface");
    expect(telegramRuntime?.package).toBe("vibekit:interface-telegram");
    expect(telegramRuntime?.export).toBe("createTelegramInterface");

    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(false);

    for (const relative of [
      ".vibekit/project.yaml",
      ".vibekit/installed.json",
      ".vibekit/config/interfaces/telegram.yaml",
    ]) {
      const text = fs.readFileSync(path.join(dir, relative), "utf8");
      expect(text, relative).not.toMatch(/\bsk-[A-Za-z0-9]{10,}\b/);
      expect(text, relative).not.toMatch(/\bghp_[A-Za-z0-9]{20,}\b/);
      expect(text, relative).not.toMatch(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/);
      expect(text, relative).not.toMatch(/\bBearer\s+[A-Za-z0-9._\-+=/]+\b/i);
    }

    const readme = fs.readFileSync(HQ_README, "utf8");
    expect(readme).toContain("Chief");
    expect(readme).toContain("Personal");
    expect(readme).toContain("Telegram");
    expect(readme).not.toMatch(/file:\/\//);
    expect(readme).not.toContain("orchestrator");
    expect(readme).not.toContain("subagent");
  });

  it("headquarters Host smoke binds Telegram via the testing seam and shuts down", async () => {
    const dir = makeTempDir("vibekit-example-hq-host-");
    const created = await runCli([
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
    expect(created.exitCode, created.stderr + created.stdout).toBe(0);

    const host = await VibeKitHost.start({
      projectRoot: dir,
      factories: {
        "interface:telegram": { create: createFakeInterface },
      },
      runTurn: async (request) => ({
        task: {
          schemaVersion: 1,
          id: "task_550e8400-e29b-41d4-a716-446655440091",
          projectId: request.project.id,
          objective: request.message.text,
          context: { references: [] },
          constraints: [],
          acceptanceCriteria: [],
          requiredCapabilities: [],
          assignedAgent: "agent:chief",
          claimedBy: null,
          scope: { paths: [], resources: [] },
          dependencies: [],
          priority: "normal",
          delivery: { mode: "apply" },
          authorization: { state: "standing" },
          status: "open",
          revision: 1,
          createdAt: request.message.timestamp,
          updatedAt: request.message.timestamp,
        },
        runId: "run_550e8400-e29b-41d4-a716-446655440091",
        text: "ok",
        cancelled: false,
        events: [],
        sessionPath: request.conversation.sessionPath,
      }),
    });
    expect(host.project.defaultAgent).toBe("chief");
    const health = await host.health();
    expect(health.interfaces["telegram-main"]).toEqual({ ok: true, connected: true });

    const tools = await bindInstalledTools(dir, { resolveSecret: () => "" });
    expect(tools.map((tool) => tool.moduleId)).not.toEqual(
      expect.arrayContaining(["tool:web", "tool:scheduler", "tool:memory"]),
    );

    await host.stop();
  });

  it("checked-in Headquarters Project validates against the official registry", () => {
    const source = path.resolve("docs/examples/headquarters");
    const dir = makeTempDir("vibekit-example-hq-checked-in-");
    expect(fs.existsSync(path.join(source, "package.json"))).toBe(false);
    fs.cpSync(source, dir, {
      recursive: true,
      filter: (entry) => !entry.includes(`${path.sep}node_modules${path.sep}`),
    });
    const project = readProjectDocument(dir);
    expect(project.defaultAgent).toBe("chief");
    expect(project.state.backend).toBe("state:repository");
    expect(project.capabilityBindings["schedule.write"]).toBe("tool:scheduler");
    expect(project.capabilityBindings["agent.delegate"]).toBeUndefined();
    expect(project.capabilityBindings["schedule.manage"]).toBeUndefined();

    const manifest = readInstalledManifest(dir);
    expect(manifest.modules.every((module) => module.registrySource === "official")).toBe(true);
    const expectedVersions = new Map([
      ["state:memory", "1.2.0"],
      ["tool:filesystem", "1.1.0"],
      ["tool:memory", "1.3.0"],
      ["tool:scheduler", "1.1.0"],
      ["tool:web", "1.1.0"],
    ]);
    for (const [id, version] of expectedVersions) {
      expect(manifest.modules.find((module) => module.id === id)?.version, id).toBe(version);
    }
    const doctor = runDoctor({
      projectRoot: dir,
      registry: loadRegistry(officialRegistryDir, OFFICIAL_REGISTRY_SOURCE),
    });
    expect(doctor.errorCount, JSON.stringify(doctor.findings, null, 2)).toBe(0);
    for (const relative of [
      ".pi/extensions/filesystem/index.ts",
      ".pi/extensions/memory/index.ts",
      ".pi/extensions/scheduler/index.ts",
      ".pi/extensions/web/index.ts",
    ]) {
      expect(fs.existsSync(path.join(dir, relative)), relative).toBe(false);
    }
  });
});
