import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type { ErrorObject, Options, ValidateFunction } from "ajv";

interface AjvInstance {
  compile(schema: object): ValidateFunction;
}

interface AjvConstructor {
  new (options?: Options): AjvInstance;
}

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as AjvConstructor;

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;
const URL_SCHEME = /^(?:file|https?|ftp):/i;

export const SCHEMA_VERIFIER_ID = "verifier:schema" as const;

export interface SchemaVerificationInput {
  readonly instance: unknown;
  readonly schema: Record<string, unknown> | string;
  readonly cwd: string;
}

export interface SchemaVerificationResult {
  readonly passed: boolean;
  readonly errors: string[];
}

export function runSchemaVerification(input: {
  instance: unknown;
  schema: Record<string, unknown> | string;
  cwd: string;
}): { passed: boolean; errors: string[] } {
  const loaded = loadSchema(input.schema, input.cwd);
  if (loaded.errors.length > 0 || loaded.schema === undefined) {
    return { passed: false, errors: loaded.errors };
  }

  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(loaded.schema);
    if (validate(input.instance) === true) {
      return { passed: true, errors: [] };
    }
    return { passed: false, errors: formatAjvErrors(validate.errors) };
  } catch (error) {
    return {
      passed: false,
      errors: [error instanceof Error ? error.message : "Schema compilation failed"],
    };
  }
}

function loadSchema(
  schema: Record<string, unknown> | string,
  cwd: string,
): { schema?: Record<string, unknown>; errors: string[] } {
  if (isSchemaObject(schema)) {
    return { schema, errors: [] };
  }
  if (typeof schema !== "string") {
    return { errors: ["Schema must be an object or a relative path"] };
  }

  const pathError = schemaPathError(schema);
  if (pathError !== undefined) {
    return { errors: [pathError] };
  }
  if (typeof cwd !== "string" || cwd.trim() === "") {
    return { errors: ["Working directory is required"] };
  }

  const root = path.resolve(cwd);
  const resolved = path.resolve(root, schema);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { errors: ["Schema path must stay inside the working directory"] };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { errors: [`Schema file not found: ${schema}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch (error) {
    return {
      errors: [error instanceof Error ? error.message : "Schema file is not valid JSON"],
    };
  }
  if (!isSchemaObject(parsed)) {
    return { errors: ["Schema file must contain a JSON object"] };
  }
  return { schema: parsed, errors: [] };
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaPathError(target: string): string | undefined {
  if (target.length === 0) {
    return "Schema path must be a non-empty relative path";
  }
  if (target.includes("\0") || target.includes("%00")) {
    return "Schema path must not contain a null byte";
  }
  if (target.startsWith("/") || target.startsWith("\\")) {
    return "Schema path must not be an absolute path";
  }
  if (WINDOWS_DRIVE.test(target)) {
    return "Schema path must not be a Windows drive path";
  }
  if (UNC_PREFIX.test(target) || target.startsWith("//")) {
    return "Schema path must not be a UNC path";
  }
  if (URL_SCHEME.test(target)) {
    return "Schema path must not use a URL scheme";
  }
  if (target.startsWith("~")) {
    return "Schema path must not expand a home directory";
  }
  if (/%2e/i.test(target)) {
    return "Schema path must not contain encoded path segments";
  }

  const normalized = target.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) {
    return "Schema path must not contain '..'";
  }
  const posix = path.posix.normalize(normalized);
  if (posix.startsWith("..") || path.posix.isAbsolute(posix)) {
    return "Schema path must stay inside the working directory";
  }
  return undefined;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return ["instance does not match schema"];
  }
  return errors.map((error) => {
    const at = error.instancePath === "" ? "/" : error.instancePath;
    return `${at}: ${error.message ?? "validation failed"}`;
  });
}
