import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readProjectDocument, VibeKitError } from "./internal/core/index.js";
import { isHostIpcAvailable } from "./internal/host/index.js";

import type { ProjectRegistryEntry } from "./contracts.js";

interface ProjectRegistryFile {
  readonly schemaVersion: 1;
  readonly projects: readonly ProjectRegistryEntry[];
}

export function vibekitConfigDir(): string {
  return process.env.VIBEKIT_CONFIG_DIR ?? path.join(os.homedir(), ".config", "vibekit");
}

export function projectRegistryPath(): string {
  return path.join(vibekitConfigDir(), "projects.json");
}

export function readProjectRegistry(): ProjectRegistryEntry[] {
  const file = projectRegistryPath();
  if (!fs.existsSync(file) && !fs.existsSync(`${file}.backup`)) return [];
  const parsed = readRegistryFile(file);
  if (!isRegistryFile(parsed)) {
    const backup = readRegistryFile(`${file}.backup`);
    if (!isRegistryFile(backup)) throw registryInvalid(file);
    writeProjectRegistry(backup.projects);
    return [...backup.projects];
  }
  return [...parsed.projects];
}

export function registerProject(projectRoot: string): ProjectRegistryEntry {
  const canonical = canonicalProjectPath(projectRoot);
  const project = readProjectDocument(canonical);
  const entries = readProjectRegistry();
  const samePath = entries.find((entry) => entry.path === canonical);
  if (samePath !== undefined) {
    if (samePath.projectId !== project.id) {
      throw new VibeKitError({
        category: "conflict",
        code: "project_path_conflict",
        message: `${canonical} is registered as ${samePath.projectId}, not ${project.id}`,
      });
    }
    return samePath;
  }
  const sameId = entries.find((entry) => entry.projectId === project.id);
  if (sameId !== undefined) throw duplicateId(project.id, sameId.path, canonical);
  const entry = { projectId: project.id, path: canonical, registeredAt: new Date().toISOString() };
  writeProjectRegistry([...entries, entry]);
  return entry;
}

export function assertProjectIdentityAvailable(projectId: string, projectRoot: string): void {
  const target = fs.existsSync(projectRoot) ? fs.realpathSync(projectRoot) : path.resolve(projectRoot);
  const owner = readProjectRegistry().find((entry) => entry.projectId === projectId);
  if (owner !== undefined && owner.path !== target) throw duplicateId(projectId, owner.path, target);
}

export async function unregisterProject(projectId: string): Promise<ProjectRegistryEntry> {
  const entries = readProjectRegistry();
  const entry = requireEntry(entries, projectId);
  if (fs.existsSync(entry.path) && await isHostIpcAvailable(entry.path)) {
    throw new VibeKitError({
      category: "resource_busy",
      code: "project_host_running",
      message: `Stop ${projectId} before unregistering it`,
    });
  }
  writeProjectRegistry(entries.filter((candidate) => candidate.projectId !== projectId));
  return entry;
}

export function locateProject(projectId: string, projectRoot: string): ProjectRegistryEntry {
  const entries = readProjectRegistry();
  const old = requireEntry(entries, projectId);
  if (fs.existsSync(old.path)) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_path_exists",
      message: `${projectId} is still present at ${old.path}`,
    });
  }
  const canonical = canonicalProjectPath(projectRoot);
  const project = readProjectDocument(canonical);
  if (project.id !== projectId) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_id_mismatch",
      message: `${canonical} contains ${project.id}, expected ${projectId}`,
    });
  }
  const pathOwner = entries.find((entry) => entry.path === canonical && entry.projectId !== projectId);
  if (pathOwner !== undefined) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_path_conflict",
      message: `${canonical} is already registered as ${pathOwner.projectId}`,
    });
  }
  const replacement = { ...old, path: canonical };
  writeProjectRegistry(entries.map((entry) => entry.projectId === projectId ? replacement : entry));
  return replacement;
}

export function registeredProject(projectId: string): ProjectRegistryEntry {
  return requireEntry(readProjectRegistry(), projectId);
}

function canonicalProjectPath(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  try {
    return fs.realpathSync(resolved);
  } catch {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_path_missing",
      message: `Project path does not exist: ${resolved}`,
    });
  }
}

function writeProjectRegistry(projects: readonly ProjectRegistryEntry[]): void {
  const file = projectRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const contents = `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`;
  writeAtomic(`${file}.backup`, contents);
  writeAtomic(file, contents);
}

function writeAtomic(file: string, contents: string): void {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(temp, contents, { mode: 0o600 }); fs.renameSync(temp, file); fs.chmodSync(file, 0o600); }
  finally { fs.rmSync(temp, { force: true }); }
}

function readRegistryFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return undefined; }
}

function isRegistryFile(value: unknown): value is ProjectRegistryFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { schemaVersion?: unknown; projects?: unknown };
  if (!(candidate.schemaVersion === 1 && Array.isArray(candidate.projects) && candidate.projects.every(
    (entry) => typeof entry === "object" && entry !== null
      && typeof (entry as ProjectRegistryEntry).projectId === "string"
      && typeof (entry as ProjectRegistryEntry).path === "string"
      && path.isAbsolute((entry as ProjectRegistryEntry).path)
      && typeof (entry as ProjectRegistryEntry).registeredAt === "string",
  ))) return false;
  const ids = new Set(candidate.projects.map((entry) => (entry as ProjectRegistryEntry).projectId));
  const paths = new Set(candidate.projects.map((entry) => (entry as ProjectRegistryEntry).path));
  return ids.size === candidate.projects.length && paths.size === candidate.projects.length;
}

function requireEntry(entries: readonly ProjectRegistryEntry[], projectId: string): ProjectRegistryEntry {
  const entry = entries.find((candidate) => candidate.projectId === projectId);
  if (entry === undefined) {
    throw new VibeKitError({ category: "invalid_input", code: "project_not_registered", message: `${projectId} is not registered` });
  }
  return entry;
}

function registryInvalid(file: string): VibeKitError {
  return new VibeKitError({
    category: "configuration_invalid",
    code: "project_registry_invalid",
    message: `Project registry is malformed: ${file}. Repair or remove it before continuing.`,
  });
}

function duplicateId(projectId: string, owner: string, target: string): VibeKitError {
  return new VibeKitError({
    category: "conflict",
    code: "project_id_conflict",
    message: `${projectId} is already registered to ${owner}; ${target} must use a different Project ID`,
  });
}
