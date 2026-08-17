import { describe, expect, it } from "vitest";

import {
  VibeKitError,
  assertModuleId,
  assertProjectId,
  assertRuntimeId,
  formatModuleId,
  formatProjectId,
  formatRuntimeId,
  isModuleId,
  isProjectId,
  isRuntimeId,
  isRuntimeIdOf,
  parseModuleId,
  parseProjectId,
  parseRuntimeId,
} from "@vibekit/core";

describe("module IDs", () => {
  it("parses and formats valid IDs", () => {
    expect(parseModuleId("tool:github")).toEqual({ type: "tool", name: "github" });
    expect(formatModuleId("agent", "project-manager")).toBe("agent:project-manager");
    expect(isModuleId("policy:require-review")).toBe(true);
    expect(() => assertModuleId("verifier:command")).not.toThrow();
  });

  it.each([
    ["Tool:github", "uppercase"],
    ["tool:GitHub", "uppercase name"],
    ["tool:git hub", "space"],
    ["github", "missing type"],
    ["tool:", "empty name"],
    [":github", "missing type token"],
    ["block:github", "unknown type"],
    ["orchestrator:chief", "unknown type"],
    ["subagent:coder", "unknown type"],
    ["tool:git:hub", "extra colon"],
    ["", "empty string"],
  ])("rejects %s (%s)", (value) => {
    expect(isModuleId(value)).toBe(false);
    expect(() => parseModuleId(value)).toThrow(VibeKitError);
    try {
      parseModuleId(value);
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).category).toBe("invalid_input");
    }
  });
});

describe("project IDs", () => {
  it("parses project:<slug>", () => {
    expect(parseProjectId("project:example-app")).toEqual({ slug: "example-app" });
    expect(formatProjectId("example-app")).toBe("project:example-app");
    expect(isProjectId("project:example-app")).toBe(true);
    expect(() => assertProjectId("project:example-app")).not.toThrow();
  });

  it.each(["project:Example", "example-app", "project:", "PROJECT:example-app"])(
    "rejects %s",
    (value) => {
      expect(isProjectId(value)).toBe(false);
      expect(() => parseProjectId(value)).toThrow(VibeKitError);
    },
  );
});

describe("runtime IDs", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";

  it("parses prefixed UUIDs", () => {
    expect(parseRuntimeId(`task_${uuid}`)).toEqual({ kind: "task", uuid });
    expect(formatRuntimeId("run", uuid)).toBe(`run_${uuid}`);
    expect(isRuntimeId(`result_${uuid}`)).toBe(true);
    expect(isRuntimeIdOf("claim", `claim_${uuid}`)).toBe(true);
    expect(() => assertRuntimeId(`event_${uuid}`)).not.toThrow();
  });

  it.each([
    [`TASK_${uuid}`, "uppercase prefix"],
    [uuid, "missing prefix"],
    ["task_not-a-uuid", "invalid uuid"],
    ["job_550e8400-e29b-41d4-a716-446655440000", "unknown kind"],
    ["task_", "empty uuid"],
  ])("rejects %s (%s)", (value) => {
    expect(isRuntimeId(value)).toBe(false);
    expect(() => parseRuntimeId(value)).toThrow(VibeKitError);
  });
});
