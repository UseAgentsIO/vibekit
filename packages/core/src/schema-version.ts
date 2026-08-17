import { VibeKitError } from "./errors.js";

export const CURRENT_SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;

export function isSchemaVersion(value: unknown): value is SchemaVersion {
  return value === CURRENT_SCHEMA_VERSION;
}

export function assertSchemaVersion(value: unknown): asserts value is SchemaVersion {
  if (value === undefined || value === null) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "schema_version_missing",
      message: "schemaVersion is required",
    });
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "schema_version_invalid",
      message: "schemaVersion must be an integer",
      details: { value },
    });
  }
  if (value !== CURRENT_SCHEMA_VERSION) {
    throw new VibeKitError({
      category: "compatibility_error",
      code: "schema_version_unsupported",
      message: `Unsupported schemaVersion ${value}; expected ${CURRENT_SCHEMA_VERSION}`,
      details: { value, expected: CURRENT_SCHEMA_VERSION },
    });
  }
}
