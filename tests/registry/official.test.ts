import fs from "node:fs";
import path from "node:path";

import {
  buildRegistryIndex,
  loadModuleFromDirectory,
  parseAndValidateYaml,
} from "@vibekit/core";
import { describe, expect, it } from "vitest";

import { officialRegistryDir } from "../helpers.js";

const officialIds = [
  "agent:chief",
  "agent:coder",
  "agent:project-manager",
  "agent:researcher",
  "agent:reviewer",
  "interface:terminal",
  "policy:least-privilege",
  "policy:require-verification",
  "provider:openai",
  "skill:research",
  "skill:software-development",
  "state:repository",
  "tool:execution",
  "tool:filesystem",
  "tool:github",
  "verifier:command",
] as const;

describe("official registry", () => {
  it("validates every shipped module and matches registry/index.json", () => {
    const result = buildRegistryIndex(officialRegistryDir);
    const ids = result.index.modules.map((entry) => entry.id).sort();
    expect(ids).toEqual([...officialIds]);
    expect(new Set(ids).size).toBe(ids.length);

    const published = JSON.parse(
      fs.readFileSync(path.join(officialRegistryDir, "index.json"), "utf8"),
    ) as { modules: Array<{ id: string }> };
    expect(published.modules.map((entry) => entry.id).sort()).toEqual([...officialIds]);

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
