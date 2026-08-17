import { VibeKitError } from "./errors.js";

export const MODULE_TYPES = [
  "provider",
  "tool",
  "skill",
  "interface",
  "state",
  "policy",
  "verifier",
  "agent",
] as const;

export type ModuleType = (typeof MODULE_TYPES)[number];

export const MODULE_TYPE_SET: ReadonlySet<string> = new Set(MODULE_TYPES);

export const RUNTIME_ID_KINDS = [
  "task",
  "run",
  "result",
  "decision",
  "approval",
  "verification",
  "event",
  "claim",
] as const;

export type RuntimeIdKind = (typeof RUNTIME_ID_KINDS)[number];

export const RUNTIME_ID_KIND_SET: ReadonlySet<string> = new Set(RUNTIME_ID_KINDS);

export type ModuleId = `${ModuleType}:${string}`;
export type ProjectId = `project:${string}`;
export type RuntimeId = `${RuntimeIdKind}_${string}`;

export interface ParsedModuleId {
  readonly type: ModuleType;
  readonly name: string;
}

export interface ParsedProjectId {
  readonly slug: string;
}

export interface ParsedRuntimeId {
  readonly kind: RuntimeIdKind;
  readonly uuid: string;
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalidId(kind: string, value: unknown, message: string): VibeKitError {
  return new VibeKitError({
    category: "invalid_input",
    code: `${kind}_id_invalid`,
    message,
    details: { kind, value },
  });
}

export function isModuleType(value: string): value is ModuleType {
  return MODULE_TYPE_SET.has(value);
}

export function isRuntimeIdKind(value: string): value is RuntimeIdKind {
  return RUNTIME_ID_KIND_SET.has(value);
}

export function isModuleName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

export function parseModuleId(value: string): ParsedModuleId {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidId("module", value, "Module ID must be a non-empty string");
  }
  if (value !== value.toLowerCase()) {
    throw invalidId("module", value, "Module ID must be lowercase");
  }
  if (/\s/.test(value)) {
    throw invalidId("module", value, "Module ID must not contain spaces");
  }
  const separator = value.indexOf(":");
  if (separator <= 0) {
    throw invalidId("module", value, "Module ID must be <type>:<name>");
  }
  if (value.indexOf(":", separator + 1) !== -1) {
    throw invalidId("module", value, "Module ID must contain exactly one colon");
  }
  const type = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (!isModuleType(type)) {
    throw invalidId("module", value, `Unknown module type "${type}"`);
  }
  if (name.length === 0) {
    throw invalidId("module", value, "Module ID name must not be empty");
  }
  if (!NAME_PATTERN.test(name)) {
    throw invalidId(
      "module",
      value,
      "Module ID name must be lowercase letters, numbers, and hyphens",
    );
  }
  return { type, name };
}

export function formatModuleId(type: ModuleType, name: string): ModuleId {
  if (!isModuleType(type)) {
    throw invalidId("module", `${type}:${name}`, `Unknown module type "${type}"`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw invalidId(
      "module",
      `${type}:${name}`,
      "Module ID name must be lowercase letters, numbers, and hyphens",
    );
  }
  return `${type}:${name}`;
}

export function isModuleId(value: unknown): value is ModuleId {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseModuleId(value);
    return true;
  } catch {
    return false;
  }
}

export function assertModuleId(value: unknown): asserts value is ModuleId {
  if (typeof value !== "string") {
    throw invalidId("module", value, "Module ID must be a non-empty string");
  }
  parseModuleId(value);
}

export function parseProjectId(value: string): ParsedProjectId {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidId("project", value, "Project ID must be a non-empty string");
  }
  if (value !== value.toLowerCase()) {
    throw invalidId("project", value, "Project ID must be lowercase");
  }
  if (/\s/.test(value)) {
    throw invalidId("project", value, "Project ID must not contain spaces");
  }
  if (!value.startsWith("project:")) {
    throw invalidId("project", value, "Project ID must be project:<slug>");
  }
  const slug = value.slice("project:".length);
  if (slug.length === 0) {
    throw invalidId("project", value, "Project ID slug must not be empty");
  }
  if (!NAME_PATTERN.test(slug)) {
    throw invalidId(
      "project",
      value,
      "Project ID slug must be lowercase letters, numbers, and hyphens",
    );
  }
  return { slug };
}

export function formatProjectId(slug: string): ProjectId {
  if (!NAME_PATTERN.test(slug)) {
    throw invalidId(
      "project",
      `project:${slug}`,
      "Project ID slug must be lowercase letters, numbers, and hyphens",
    );
  }
  return `project:${slug}`;
}

export function isProjectId(value: unknown): value is ProjectId {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseProjectId(value);
    return true;
  } catch {
    return false;
  }
}

export function assertProjectId(value: unknown): asserts value is ProjectId {
  if (typeof value !== "string") {
    throw invalidId("project", value, "Project ID must be a non-empty string");
  }
  parseProjectId(value);
}

export function parseRuntimeId(value: string): ParsedRuntimeId {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidId("runtime", value, "Runtime ID must be a non-empty string");
  }
  if (value !== value.toLowerCase()) {
    throw invalidId("runtime", value, "Runtime ID must be lowercase");
  }
  if (/\s/.test(value)) {
    throw invalidId("runtime", value, "Runtime ID must not contain spaces");
  }
  const separator = value.indexOf("_");
  if (separator <= 0) {
    throw invalidId("runtime", value, "Runtime ID must be <kind>_<uuid>");
  }
  const kind = value.slice(0, separator);
  const uuid = value.slice(separator + 1);
  if (!isRuntimeIdKind(kind)) {
    throw invalidId("runtime", value, `Unknown runtime ID kind "${kind}"`);
  }
  if (!UUID_PATTERN.test(uuid)) {
    throw invalidId("runtime", value, "Runtime ID must use a lowercase UUID");
  }
  return { kind, uuid };
}

export function formatRuntimeId(kind: RuntimeIdKind, uuid: string): RuntimeId {
  if (!isRuntimeIdKind(kind)) {
    throw invalidId("runtime", `${kind}_${uuid}`, `Unknown runtime ID kind "${kind}"`);
  }
  if (!UUID_PATTERN.test(uuid)) {
    throw invalidId("runtime", `${kind}_${uuid}`, "Runtime ID must use a lowercase UUID");
  }
  return `${kind}_${uuid}`;
}

export function isRuntimeId(value: unknown): value is RuntimeId {
  if (typeof value !== "string") {
    return false;
  }
  try {
    parseRuntimeId(value);
    return true;
  } catch {
    return false;
  }
}

export function isRuntimeIdOf(kind: RuntimeIdKind, value: unknown): boolean {
  if (!isRuntimeId(value)) {
    return false;
  }
  return parseRuntimeId(value).kind === kind;
}

export function assertRuntimeId(value: unknown): asserts value is RuntimeId {
  if (typeof value !== "string") {
    throw invalidId("runtime", value, "Runtime ID must be a non-empty string");
  }
  parseRuntimeId(value);
}

export function assertRuntimeIdOf(
  kind: RuntimeIdKind,
  value: unknown,
): asserts value is RuntimeId {
  const parsed = typeof value === "string" ? parseRuntimeId(value) : null;
  if (parsed === null) {
    throw invalidId("runtime", value, "Runtime ID must be a non-empty string");
  }
  if (parsed.kind !== kind) {
    throw invalidId(
      "runtime",
      value,
      `Expected ${kind}_<uuid> but received ${parsed.kind}_<uuid>`,
    );
  }
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
