import { describe, expect, it } from "vitest";

import {
  parseAndValidateJson,
  parseAndValidateYaml,
  validateDocument,
  type DocumentKind,
} from "@useagentsio/core";

import { readFixture } from "../helpers.js";

const validCases: ReadonlyArray<readonly [string, DocumentKind]> = [
  ["component-tool-github.yaml", "component"],
  ["agent-coder.yaml", "agent"],
  ["project.yaml", "project"],
  ["task.yaml", "task"],
  ["result.yaml", "result"],
  ["decision.yaml", "decision"],
  ["approval.yaml", "approval"],
  ["verification.yaml", "verification"],
  ["registry-entry.yaml", "registry-entry"],
  ["secret-reference.yaml", "secret"],
];

const validJsonCases: ReadonlyArray<readonly [string, DocumentKind]> = [
  ["event.json", "event"],
  ["installed.json", "installed"],
  ["installed-module.json", "installed-module"],
];

describe("valid fixtures", () => {
  it.each(validCases)("validates %s as %s", (fileName, kind) => {
    const result = parseAndValidateYaml(kind, readFixture("valid", fileName));
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
  });

  it.each(validJsonCases)("validates %s as %s", (fileName, kind) => {
    const result = parseAndValidateJson(kind, readFixture("valid", fileName));
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("accepts the component fixture as a generic module", () => {
    const result = parseAndValidateYaml(
      "module",
      readFixture("valid", "component-tool-github.yaml"),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts the agent fixture as a generic module", () => {
    const result = parseAndValidateYaml("module", readFixture("valid", "agent-coder.yaml"));
    expect(result.valid).toBe(true);
  });
});

describe("invalid fixtures", () => {
  it("rejects an uppercase module ID", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "uppercase-module-id.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === "/id")).toBe(true);
  });

  it("rejects a module ID containing a space", () => {
    const result = parseAndValidateYaml("component", readFixture("invalid", "space-in-id.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === "/id")).toBe(true);
  });

  it("rejects a missing schemaVersion", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "missing-schema-version.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes("schemaVersion")),
    ).toBe(true);
  });

  it("rejects unsupported schemaVersion 2", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "schema-version-2.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.path === "/schemaVersion" || error.message.includes("1"),
      ),
    ).toBe(true);
  });

  it("rejects an absolute file target", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "absolute-file-target.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.includes("/files"))).toBe(true);
  });

  it("rejects a path-traversal file target", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "path-traversal-target.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.includes("/files"))).toBe(true);
  });

  it("rejects an inline secret value field", () => {
    const result = parseAndValidateYaml(
      "component",
      readFixture("invalid", "inline-secret-value.yaml"),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message.includes("additional property 'value'")),
    ).toBe(true);
  });
});

describe("validateDocument structured errors", () => {
  it("returns path and message without throwing", () => {
    const result = validateDocument("task", { schemaVersion: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) {
      expect(typeof error.path).toBe("string");
      expect(typeof error.message).toBe("string");
    }
  });

  it("returns a structured YAML parse error", () => {
    const result = parseAndValidateYaml("task", ":\n  -");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("/");
    expect(result.errors[0]?.message.length).toBeGreaterThan(0);
  });

  it("returns a structured JSON parse error", () => {
    const result = parseAndValidateJson("event", "{");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("/");
  });
});
