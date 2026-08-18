import fs from "node:fs";
import path from "node:path";

import {
  buildRegistryIndex,
  parseAndValidateYaml,
  readInstalledManifest,
  readProjectDocument,
} from "@useagentsio/core";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

const OFFICIAL_AGENTS = [
  "coder",
  "reviewer",
  "researcher",
  "project-manager",
  "chief",
] as const;

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("official catalog install", () => {
  it.each(OFFICIAL_AGENTS)("adds agent %s with --yes and passes doctor", (name) => {
    const dir = initProject();
    const added = addAgent(dir, name);
    expect(added.exitCode, added.stderr + added.stdout).toBe(0);
    expect(added.stdout).toContain(`agent:${name}@1.0.0`);
    expect(fs.existsSync(path.join(dir, `.vibekit/agents/${name}/agent.yaml`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `.vibekit/agents/${name}/instructions.md`))).toBe(true);

    const agent = parseAndValidateYaml(
      "agent",
      fs.readFileSync(path.join(dir, `.vibekit/agents/${name}/agent.yaml`), "utf8"),
    );
    expect(agent.valid, JSON.stringify(agent.errors)).toBe(true);

    const doctor = runCli(["doctor", "--dir", dir, "--registry", officialRegistryDir]);
    expect(doctor.exitCode, doctor.stderr + doctor.stdout).toBe(0);
    expect(doctor.stdout).toMatch(/doctor: ok/);
  });

  it("installs every official Agent into one Project and passes doctor", () => {
    const dir = initProject();
    for (const name of OFFICIAL_AGENTS) {
      const added = addAgent(dir, name);
      expect(added.exitCode, added.stderr + added.stdout).toBe(0);
    }

    const project = readProjectDocument(dir);
    expect(Object.keys(project.agentBindings).sort()).toEqual([...OFFICIAL_AGENTS].sort());
    for (const name of OFFICIAL_AGENTS) {
      expect(project.agentBindings[name]?.definition).toBe(`agent:${name}`);
      expect(fs.statSync(path.join(dir, `.vibekit/agents/${name}/agent.yaml`)).isFile()).toBe(true);
    }

    const installed = readInstalledManifest(dir);
    const ids = installed.modules.map((module) => module.id);
    expect(ids).toEqual(
      expect.arrayContaining(OFFICIAL_AGENTS.map((name) => `agent:${name}`)),
    );

    const doctor = runCli(["doctor", "--dir", dir, "--registry", officialRegistryDir]);
    expect(doctor.exitCode, doctor.stderr + doctor.stdout).toBe(0);
    expect(doctor.stdout).toMatch(/doctor: ok/);
  });

  it("keeps installed Agent files locally editable", () => {
    const dir = initProject();
    expect(addAgent(dir, "coder").exitCode).toBe(0);
    const instructions = path.join(dir, ".vibekit/agents/coder/instructions.md");
    const original = fs.readFileSync(instructions, "utf8");
    fs.writeFileSync(instructions, `${original}\n# local edit\n`, "utf8");
    expect(fs.readFileSync(instructions, "utf8")).toContain("# local edit");

    const doctor = runCli(["doctor", "--dir", dir, "--registry", officialRegistryDir]);
    expect(doctor.exitCode, doctor.stderr + doctor.stdout).toBe(0);
    expect(doctor.stdout).toContain("installed_hash_mismatch");
  });

  it("matches catalog IDs to registry/index.json", () => {
    const built = buildRegistryIndex(officialRegistryDir);
    const builtIds = built.index.modules.map((entry) => entry.id).sort();
    const published = JSON.parse(
      fs.readFileSync(path.join(officialRegistryDir, "index.json"), "utf8"),
    ) as { modules: Array<{ id: string }> };
    const publishedIds = published.modules.map((entry) => entry.id).sort();
    expect(publishedIds).toEqual(builtIds);
    expect(publishedIds).toEqual(
      expect.arrayContaining(OFFICIAL_AGENTS.map((name) => `agent:${name}`)),
    );
  });
});

function initProject(): string {
  const dir = makeTempDir("vibekit-catalog-");
  temps.push(dir);
  const result = runCli(["init", dir, "--registry", officialRegistryDir]);
  expect(result.exitCode, result.stderr).toBe(0);
  return dir;
}

function addAgent(dir: string, name: string) {
  return runCli([
    "add",
    "agent",
    name,
    "--yes",
    "--dir",
    dir,
    "--registry",
    officialRegistryDir,
  ]);
}
