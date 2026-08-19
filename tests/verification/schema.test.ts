import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { afterEach, describe, expect, it } from "vitest";

type RunSchemaVerification = (input: {
  instance: unknown;
  schema: Record<string, unknown> | string;
  cwd: string;
}) => { passed: boolean; errors: string[] };

const verifierDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/verifier-schema/dist/index.js",
);
const { runSchemaVerification } = (await import(pathToFileURL(verifierDist).href)) as {
  runSchemaVerification: RunSchemaVerification;
};

const moduleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/verifier/schema/1.0.0",
);

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function tempCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-schema-"));
  temps.push(dir);
  return dir;
}

const personSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    age: { type: "integer", minimum: 0 },
  },
} as const;

describe("verifier:schema module", () => {
  it("ships a valid component with a package runtime", () => {
    const text = fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8");
    const validated = parseAndValidateYaml("component", text);
    expect(validated.valid, JSON.stringify(validated.errors)).toBe(true);
    expect(validated.data?.id).toBe("verifier:schema");
    expect(validated.data?.providesCapabilities).toEqual(["verification.schema"]);
    expect(validated.data?.runtime).toEqual({
      kind: "package",
      package: "@useagentsio/verifier-schema",
      export: "runSchemaVerification",
    });
    expect(validated.data?.configuration.target).toBe(".vibekit/config/verifiers/schema.yaml");
  });
});

describe("runSchemaVerification", () => {
  it("passes when the instance matches an inline schema", () => {
    const result = runSchemaVerification({
      instance: { name: "Ada", age: 36 },
      schema: personSchema,
      cwd: tempCwd(),
    });
    expect(result).toEqual({ passed: true, errors: [] });
  });

  it("fails when the instance does not match the schema", () => {
    const result = runSchemaVerification({
      instance: { age: -1 },
      schema: personSchema,
      cwd: tempCwd(),
    });
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join("\n")).toMatch(/name|required|age|minimum/i);
  });

  it("loads a relative schema file from cwd", () => {
    const cwd = tempCwd();
    fs.writeFileSync(path.join(cwd, "person.schema.json"), JSON.stringify(personSchema), "utf8");
    const passed = runSchemaVerification({
      instance: { name: "Grace" },
      schema: "person.schema.json",
      cwd,
    });
    expect(passed).toEqual({ passed: true, errors: [] });
    const failed = runSchemaVerification({
      instance: {},
      schema: "person.schema.json",
      cwd,
    });
    expect(failed.passed).toBe(false);
  });

  it("rejects schema paths that escape the working directory", () => {
    const cwd = tempCwd();
    for (const schema of ["../secret.json", "foo/../../etc/passwd", "foo/%2e%2e/bar"]) {
      const result = runSchemaVerification({
        instance: {},
        schema,
        cwd,
      });
      expect(result.passed, schema).toBe(false);
      expect(result.errors.join("\n"), schema).toMatch(/must not|stay inside/i);
    }
  });

  it("rejects absolute schema paths", () => {
    const cwd = tempCwd();
    for (const schema of ["/tmp/schema.json", "C:\\Windows\\schema.json", "file:///tmp/schema.json"]) {
      const result = runSchemaVerification({
        instance: {},
        schema,
        cwd,
      });
      expect(result.passed, schema).toBe(false);
      expect(result.errors.join("\n"), schema).toMatch(/absolute|Windows drive|URL scheme/i);
    }
  });
});
