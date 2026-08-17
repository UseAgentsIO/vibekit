import fs from "node:fs";
import path from "node:path";

import {
  buildRegistryIndex,
  loadModuleFromDirectory,
  parseAndValidateYaml,
} from "@vibekit/core";
import { describe, expect, it } from "vitest";

import { officialRegistryDir } from "../helpers.js";

const requiredIds = [
  "agent:coder",
  "policy:least-privilege",
  "policy:require-verification",
  "skill:software-development",
  "state:repository",
  "tool:execution",
  "tool:filesystem",
  "verifier:command",
];

describe("official registry", () => {
  it("validates every shipped module and builds an index", () => {
    const result = buildRegistryIndex(officialRegistryDir);
    const ids = result.index.modules.map((entry) => entry.id).sort();
    expect(ids).toEqual(expect.arrayContaining(requiredIds));
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of result.index.modules) {
      expect(entry.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.compatibility.vibekit).toBe("^1.0.0");
      expect(entry.path.includes("..")).toBe(false);
      const module = loadModuleFromDirectory(
        officialRegistryDir,
        path.join(officialRegistryDir, entry.path),
        entry.checksum,
      );
      expect(module.license).toBeTruthy();
      expect(module.source?.revision).toBeTruthy();
      const kind = module.type === "agent" ? "agent" : "component";
      const validated = parseAndValidateYaml(
        kind,
        fs.readFileSync(path.join(officialRegistryDir, entry.path, "module.yaml"), "utf8"),
      );
      expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    }
  });
});
