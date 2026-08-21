import fs from "node:fs";

import {
  parseAndValidateYaml,
  validateDocument,
  type DocumentKind,
  type DocumentTypeMap,
} from "../core/index.js";

import { configurationInvalid } from "./fail.js";

export function readValidatedYaml<K extends DocumentKind>(
  kind: K,
  filePath: string,
  codes: { readonly missing: string; readonly invalid: string },
): DocumentTypeMap[K] {
  if (!fs.existsSync(filePath)) {
    throw configurationInvalid(codes.missing, `${kind} document not found`, { path: filePath });
  }
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw configurationInvalid(codes.invalid, `Unable to read ${kind} document`, {
      path: filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return parseValidatedYaml(kind, text, codes.invalid, { path: filePath });
}

export function parseValidatedYaml<K extends DocumentKind>(
  kind: K,
  text: string,
  invalidCode: string,
  details?: Readonly<Record<string, unknown>>,
): DocumentTypeMap[K] {
  const result = parseAndValidateYaml(kind, text);
  if (!result.valid || result.data === undefined) {
    throw configurationInvalid(
      invalidCode,
      result.errors[0]?.message ?? `${kind} document is invalid`,
      { ...details, errors: result.errors },
    );
  }
  return result.data;
}

export function assertValidDocument<K extends DocumentKind>(
  kind: K,
  data: unknown,
  invalidCode: string,
): DocumentTypeMap[K] {
  const result = validateDocument(kind, data);
  if (!result.valid || result.data === undefined) {
    throw configurationInvalid(
      invalidCode,
      result.errors[0]?.message ?? `${kind} document is invalid`,
      { errors: result.errors },
    );
  }
  return result.data;
}
