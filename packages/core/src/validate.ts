import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ErrorObject, Options, ValidateFunction } from "ajv";
import { parse as parseYaml } from "yaml";

interface AjvInstance {
  addSchema(schema: object, key?: string): AjvInstance;
  compile(schema: object): ValidateFunction;
}

interface AjvConstructor {
  new (options?: Options): AjvInstance;
}

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as AjvConstructor;
const addFormats = require("ajv-formats") as (ajv: AjvInstance) => AjvInstance;

import { VibeKitError } from "./errors.js";
import type {
  DocumentKind,
  DocumentTypeMap,
  ValidationError,
  ValidationResult,
} from "./types.js";
import { DOCUMENT_KINDS } from "./types.js";

const SCHEMA_FILES: Record<Exclude<DocumentKind, "secret">, string> = {
  module: "module.schema.json",
  component: "component.schema.json",
  agent: "agent.schema.json",
  project: "project.schema.json",
  "registry-entry": "registry-entry.schema.json",
  "installed-module": "installed-module.schema.json",
  installed: "installed.schema.json",
  task: "task.schema.json",
  result: "result.schema.json",
  decision: "decision.schema.json",
  approval: "approval.schema.json",
  verification: "verification.schema.json",
  event: "event.schema.json",
};

let cachedAjv: AjvInstance | undefined;
const compiled = new Map<DocumentKind, ValidateFunction>();

export function getSchemasDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../schemas"),
    path.resolve(here, "../../schemas"),
    path.resolve(here, "../../../schemas"),
  ];
  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "module.schema.json")),
  );
  if (!found) {
    throw new VibeKitError({
      category: "internal_error",
      code: "schemas_not_found",
      message: "Unable to locate the VibeKit JSON Schema directory",
      details: { candidates },
    });
  }
  return found;
}

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function validateDocument<K extends DocumentKind>(
  kind: K,
  data: unknown,
): ValidationResult<DocumentTypeMap[K]> {
  if (!isDocumentKind(kind)) {
    return {
      valid: false,
      errors: [{ path: "/", message: `Unknown document kind "${String(kind)}"` }],
    };
  }
  const validate = getValidator(kind);
  const valid = validate(data) === true;
  if (valid) {
    return { valid: true, errors: [], data: data as DocumentTypeMap[K] };
  }
  return { valid: false, errors: formatAjvErrors(validate.errors) };
}

export function parseAndValidateYaml<K extends DocumentKind>(
  kind: K,
  text: string,
): ValidationResult<DocumentTypeMap[K]> {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message: error instanceof Error ? error.message : "YAML parse error",
        },
      ],
    };
  }
  if (data === undefined || data === null) {
    return {
      valid: false,
      errors: [{ path: "/", message: "Document is empty" }],
    };
  }
  return validateDocument(kind, data);
}

export function parseAndValidateJson<K extends DocumentKind>(
  kind: K,
  text: string,
): ValidationResult<DocumentTypeMap[K]> {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: "/",
          message: error instanceof Error ? error.message : "JSON parse error",
        },
      ],
    };
  }
  return validateDocument(kind, data);
}

function getValidator(kind: DocumentKind): ValidateFunction {
  const existing = compiled.get(kind);
  if (existing) {
    return existing;
  }
  const ajv = getAjv();
  const validator =
    kind === "secret"
      ? ajv.compile({ $ref: "module.schema.json#/definitions/secretReference" })
      : ajv.compile({ $ref: SCHEMA_FILES[kind] });
  compiled.set(kind, validator);
  return validator;
}

function getAjv(): AjvInstance {
  if (cachedAjv) {
    return cachedAjv;
  }
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateFormats: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  const directory = getSchemasDirectory();
  for (const fileName of Object.values(SCHEMA_FILES)) {
    const raw = fs.readFileSync(path.join(directory, fileName), "utf8");
    const schema = JSON.parse(raw) as { $id?: string };
    ajv.addSchema(schema);
  }
  cachedAjv = ajv;
  return ajv;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  if (!errors || errors.length === 0) {
    return [{ path: "/", message: "validation failed" }];
  }
  return errors.map((error) => ({
    path: error.instancePath === "" ? "/" : error.instancePath,
    message: formatAjvMessage(error),
  }));
}

function formatAjvMessage(error: ErrorObject): string {
  if (error.keyword === "required" && hasParam(error, "missingProperty")) {
    return `must have required property '${String(error.params.missingProperty)}'`;
  }
  if (error.keyword === "additionalProperties" && hasParam(error, "additionalProperty")) {
    return `must NOT have additional property '${String(error.params.additionalProperty)}'`;
  }
  if (error.keyword === "const" && hasParam(error, "allowedValue")) {
    return `must be equal to ${JSON.stringify(error.params.allowedValue)}`;
  }
  return error.message ?? "validation failed";
}

function hasParam(error: ErrorObject, key: string): boolean {
  return Boolean(error.params && typeof error.params === "object" && key in error.params);
}
