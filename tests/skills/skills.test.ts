import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSafeFileTarget, parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

const registryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../registry");

const SKILLS = [
  {
    id: "skill:memory-hygiene",
    name: "memory-hygiene",
    capability: "skill.memory-hygiene",
    recommended: ["tool:memory"] as const,
    phrases: ["never persist", "not Task", "preferences", "consolidate"],
  },
  {
    id: "skill:browser-use",
    name: "browser-use",
    capability: "skill.browser-use",
    recommended: ["tool:browser"] as const,
    phrases: ["snapshot", "untrusted", "blind", "credentials"],
  },
  {
    id: "skill:scheduler",
    name: "scheduler",
    capability: "skill.scheduler",
    recommended: ["tool:scheduler", "interface:schedule"] as const,
    phrases: ["self-contained", "[SILENT]", "pin", "recurse"],
  },
] as const;

function skillDir(name: string): string {
  return path.join(registryRoot, "components/skill", name, "1.0.0");
}

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(match, "SKILL.md must start with YAML frontmatter").toBeTruthy();
  const body = match?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(body)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(body)?.[1]?.trim();
  return { name, description };
}

describe("optional skill modules", () => {
  it.each(SKILLS)("$id module.yaml is a valid component", (skill) => {
    const text = fs.readFileSync(path.join(skillDir(skill.name), "module.yaml"), "utf8");
    const validated = parseAndValidateYaml("component", text);
    expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    expect(validated.data?.id).toBe(skill.id);
    expect(validated.data?.providesCapabilities).toEqual([skill.capability]);
    expect(validated.data?.requires.recommended).toEqual([...skill.recommended]);
    expect(validated.data?.requestsPermissions).toEqual([]);
    expect(validated.data?.files[0]?.target).toBe(`.pi/skills/${skill.name}/SKILL.md`);
    expect(isSafeFileTarget(validated.data?.files[0]?.target ?? "")).toBe(true);
  });

  it.each(SKILLS)("$id SKILL.md is a procedure, not authority", (skill) => {
    const text = fs.readFileSync(path.join(skillDir(skill.name), "payload/SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(text);
    expect(frontmatter.name).toBe(skill.name);
    expect(frontmatter.description?.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/does not grant/);
    for (const phrase of skill.phrases) {
      expect(text.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});
