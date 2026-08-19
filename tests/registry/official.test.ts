import fs from "node:fs";
import path from "node:path";

import {
  buildRegistryIndex,
  loadModuleFromDirectory,
  parseAndValidateYaml,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { officialRegistryDir } from "../helpers.js";

const officialIds = [
  "agent:chief",
  "agent:coder",
  "agent:project-manager",
  "agent:researcher",
  "agent:reviewer",
  "interface:http",
  "interface:schedule",
  "interface:slack",
  "interface:telegram",
  "interface:terminal",
  "interface:webhook",
  "policy:interface-pairing",
  "policy:least-privilege",
  "policy:memory-write-approval",
  "policy:require-verification",
  "policy:schedule-no-recurse",
  "policy:untrusted-inbound",
  "provider:openai",
  "provider:openai-codex",
  "provider:opencode-go",
  "provider:openrouter",
  "provider:xai",
  "skill:browser-use",
  "skill:memory-hygiene",
  "skill:research",
  "skill:scheduler",
  "skill:software-development",
  "state:memory",
  "state:repository",
  "tool:browser",
  "tool:execution",
  "tool:filesystem",
  "tool:github",
  "tool:mcp",
  "tool:memory",
  "tool:process",
  "tool:scheduler",
  "tool:web",
  "verifier:command",
  "verifier:schema",
] as const;

describe("official registry", () => {
  it("validates every shipped module and matches registry/index.json", () => {
    const result = buildRegistryIndex(officialRegistryDir);
    const ids = [...new Set(result.index.modules.map((entry) => entry.id))].sort();
    expect(ids).toEqual([...officialIds]);
    expect(
      new Set(result.index.modules.map((entry) => `${entry.id}@${entry.version}`)).size,
    ).toBe(result.index.modules.length);

    const published = JSON.parse(
      fs.readFileSync(path.join(officialRegistryDir, "index.json"), "utf8"),
    ) as { modules: Array<{ id: string }> };
    expect([...new Set(published.modules.map((entry) => entry.id))].sort()).toEqual([
      ...officialIds,
    ]);

    for (const entry of result.index.modules) {
      expect(entry.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.compatibility.vibekit).toBe("^1.0.0");
      expect(entry.path.includes("..")).toBe(false);
      const moduleDir = path.join(officialRegistryDir, entry.path);
      const module = loadModuleFromDirectory(officialRegistryDir, moduleDir, entry.checksum);
      expect(module.license).toBeTruthy();
      expect(module.source?.revision).toBeTruthy();
      const kind = module.type === "agent" ? "agent" : "component";
      const validated = parseAndValidateYaml(
        kind,
        fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
      );
      expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
      if (module.type === "agent") {
        const payload = parseAndValidateYaml(
          "agent",
          fs.readFileSync(path.join(moduleDir, "payload/agent.yaml"), "utf8"),
        );
        expect(payload.valid, JSON.stringify(payload.errors)).toBe(true);
        expect(fs.existsSync(path.join(moduleDir, "payload/instructions.md"))).toBe(true);
      }
    }
  });
});
