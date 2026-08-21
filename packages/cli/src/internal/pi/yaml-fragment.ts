import fs from "node:fs";

import { parse as parseYaml } from "yaml";

import { configurationInvalid } from "./fail.js";

export function readYamlObject(
  filePath: string,
  invalidCode: string,
): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw configurationInvalid(invalidCode, `Unable to read configuration fragment`, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (error) {
    throw configurationInvalid(invalidCode, `Configuration fragment is not valid YAML`, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (data === undefined || data === null) {
    return {};
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw configurationInvalid(invalidCode, `Configuration fragment must be a mapping`, {
      path: filePath,
    });
  }
  return data as Record<string, unknown>;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function readObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
