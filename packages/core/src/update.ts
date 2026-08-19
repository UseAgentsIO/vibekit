import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import semver from "semver";
import { parse as parseYaml } from "yaml";

import { satisfiesCompatibility } from "./compatibility.js";
import { sha256Checksum, sha256File } from "./checksum.js";
import {
  PI_RUNTIME_VERSION,
  STAGING_RELATIVE_PATH,
  VIBEKIT_VERSION,
} from "./constants.js";
import { VibeKitError } from "./errors.js";
import { assertFileTarget } from "./file-targets.js";
import type { ModuleId } from "./ids.js";
import { planInstall, type InstallPlan } from "./install.js";
import {
  applyPackageState,
  collectPackageDependencies,
  packagesToRemove,
} from "./packages.js";
import {
  getInstalledModule,
  upsertInstalledModule,
  writeInstalledManifest,
} from "./installed.js";
import type { LoadedModule } from "./module.js";
import { planFileOwnership } from "./ownership.js";
import { safeResolve } from "./paths.js";
import { writeProjectDocument } from "./project.js";
import type { Registry, RegistryIndexEntry } from "./registry.js";
import { assertModulePayload, resolveModule } from "./registry.js";
import { assertRegistryMatchesInstallSource, resolveInstalledModule } from "./registry-source.js";
import type {
  CompatibilityDeclaration,
  InstalledFileRecord,
  InstalledManifestDocument,
  InstalledModuleDocument,
  OwnershipMode,
  ProjectDocument,
} from "./types.js";
import { validateDocument } from "./validate.js";
import { stringifyYaml } from "./yaml.js";

export const GENERATED_CONFIG_RELATIVE_PATH = ".vibekit/runtime/generated/config.yaml";

export type ThreeWayDecision =
  | "replace-upstream"
  | "keep-local"
  | "mark-current"
  | "conflict";

export type AnalyzedFileKind = "payload" | "configuration" | "generated";

export interface AnalyzedFile {
  readonly path: string;
  readonly kind: AnalyzedFileKind;
  readonly ownership: OwnershipMode | "configuration";
  readonly decision: ThreeWayDecision;
  readonly baseHash?: string;
  readonly localHash?: string;
  readonly upstreamHash?: string;
  readonly localChanged: boolean;
  readonly upstreamChanged: boolean;
  readonly missingLocal: boolean;
  readonly upstreamSourceAbs?: string;
  readonly upstreamContent?: Buffer;
}

export interface PlannedUpdateWrite {
  readonly path: string;
  readonly contents: Buffer;
}

export interface UpdatePlan {
  readonly id: ModuleId;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly files: readonly AnalyzedFile[];
  readonly conflicts: readonly AnalyzedFile[];
  readonly writes: readonly PlannedUpdateWrite[];
  readonly deletes: readonly string[];
  readonly dependencyPlan?: InstallPlan;
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
  readonly alreadyCurrent: boolean;
  readonly packageDependencies: Readonly<Record<string, string>>;
  readonly packagesToRemove: readonly string[];
}

export interface UpdateResult {
  readonly updated: boolean;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly created: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly plan: UpdatePlan;
}

export interface PlanUpdateOptions {
  readonly projectRoot: string;
  readonly registry: Registry;
  readonly id: ModuleId;
  readonly version?: string;
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
  readonly now?: Date;
  readonly registrySource?: string;
}

export function decideThreeWay(
  baseHash: string | undefined,
  localHash: string | undefined,
  upstreamHash: string | undefined,
): ThreeWayDecision {
  if (localHash === baseHash) {
    return upstreamHash === baseHash ? "mark-current" : "replace-upstream";
  }
  if (upstreamHash === baseHash) {
    return "keep-local";
  }
  if (localHash === upstreamHash) {
    return "mark-current";
  }
  return "conflict";
}

export function isGeneratedPath(target: string): boolean {
  return target.replace(/\\/g, "/").startsWith(".vibekit/runtime/generated/");
}

export function currentEnvironment(): {
  vibekit: string;
  pi: string;
  node: string;
} {
  return {
    vibekit: VIBEKIT_VERSION,
    pi: PI_RUNTIME_VERSION,
    node: process.versions.node,
  };
}

export function findNewestCompatible(
  registry: Registry,
  id: ModuleId,
): RegistryIndexEntry | undefined {
  const actual = currentEnvironment();
  const compatible = registry.index.modules.filter(
    (entry) => entry.id === id && satisfiesCompatibility(entry.compatibility, actual),
  );
  return [...compatible].sort((left, right) => semver.rcompare(left.version, right.version))[0];
}

export function assertCompatibleModule(module: LoadedModule, project: ProjectDocument): void {
  if (!module.compatibility) {
    return;
  }
  const actual = currentEnvironment();
  if (!satisfiesCompatibility(module.compatibility, actual)) {
    throw new VibeKitError({
      category: "compatibility_error",
      code: "module_incompatible",
      message: `Module ${module.id}@${module.version} is incompatible with this environment`,
      details: {
        id: module.id,
        declared: module.compatibility,
        actual,
        projectPi: project.pi.compatibility,
      },
    });
  }
}

export function defaultConfigFor(_module: LoadedModule): Record<string, unknown> {
  return {};
}

export function analyzeInstalledModule(options: {
  readonly projectRoot: string;
  readonly record: InstalledModuleDocument;
  readonly upstream: LoadedModule;
  readonly base?: LoadedModule;
}): AnalyzedFile[] {
  const { projectRoot, record, upstream, base } = options;
  const installedByPath = new Map(record.files.map((file) => [file.path, file]));
  const upstreamByPath = new Map(upstream.files.map((file) => [file.target, file]));
  const baseByPath = new Map((base?.files ?? []).map((file) => [file.target, file]));
  const paths = new Set<string>([
    ...installedByPath.keys(),
    ...upstreamByPath.keys(),
    ...record.configurationPaths,
    ...(upstream.configuration ? [upstream.configuration.target] : []),
    ...(base?.configuration ? [base.configuration.target] : []),
  ]);

  const analyzed: AnalyzedFile[] = [];
  for (const target of [...paths].sort((left, right) => left.localeCompare(right))) {
    const installed = installedByPath.get(target);
    const upstreamFile = upstreamByPath.get(target);
    const isConfig =
      record.configurationPaths.includes(target) ||
      upstream.configuration?.target === target ||
      base?.configuration?.target === target;
    const generated = isGeneratedPath(target) || installed?.ownership === "generated";
    const kind: AnalyzedFileKind = generated ? "generated" : isConfig ? "configuration" : "payload";
    const ownership: OwnershipMode | "configuration" = isConfig
      ? "configuration"
      : (installed?.ownership ?? upstreamFile?.ownership ?? "exclusive");

    const localAbs = path.join(projectRoot, target);
    const localExists = fs.existsSync(localAbs) && fs.statSync(localAbs).isFile();
    const localHash = localExists ? sha256File(localAbs) : undefined;

    let baseHash = installed?.hash;
    let upstreamHash: string | undefined;
    let upstreamSourceAbs: string | undefined;
    let upstreamContent: Buffer | undefined;

    if (kind === "configuration") {
      if (base?.configuration?.target === target) {
        baseHash = sha256Checksum(stringifyYaml(defaultConfigFor(base)));
      } else if (base && base.configuration?.target !== target) {
        baseHash = undefined;
      }
      if (upstream.configuration?.target === target) {
        upstreamContent = Buffer.from(stringifyYaml(defaultConfigFor(upstream)), "utf8");
        upstreamHash = sha256Checksum(upstreamContent);
      }
    } else if (upstreamFile) {
      upstreamSourceAbs = path.join(upstream.absolutePath, upstreamFile.source);
      if (fs.existsSync(upstreamSourceAbs) && fs.statSync(upstreamSourceAbs).isFile()) {
        upstreamContent = fs.readFileSync(upstreamSourceAbs);
        upstreamHash = sha256Checksum(upstreamContent);
      }
    }

    if (baseHash === undefined && kind === "payload") {
      const baseFile = baseByPath.get(target);
      if (baseFile && base) {
        const baseAbs = path.join(base.absolutePath, baseFile.source);
        if (fs.existsSync(baseAbs) && fs.statSync(baseAbs).isFile()) {
          baseHash = sha256File(baseAbs);
        }
      }
    }

    const decision = generated
      ? upstreamHash === undefined && localHash === undefined
        ? "mark-current"
        : "replace-upstream"
      : decideThreeWay(baseHash, localHash, upstreamHash);

    analyzed.push({
      path: target,
      kind,
      ownership,
      decision,
      baseHash,
      localHash,
      upstreamHash,
      localChanged: localHash !== baseHash,
      upstreamChanged: upstreamHash !== baseHash,
      missingLocal: !localExists,
      upstreamSourceAbs,
      upstreamContent,
    });
  }
  return analyzed;
}

export function planUpdate(options: PlanUpdateOptions): UpdatePlan {
  const record = getInstalledModule(options.manifest, options.id);
  if (record === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_not_installed",
      message: `${options.id} is not installed`,
      details: { id: options.id },
    });
  }
  assertRegistryMatchesInstallSource(record, options.registry);

  const selected = options.version
    ? resolveSelectedVersion(options.registry, options.id, options.version)
    : findNewestCompatible(options.registry, options.id);
  if (selected === undefined) {
    throw new VibeKitError({
      category: "compatibility_error",
      code: "no_compatible_version",
      message: `No compatible registry version of ${options.id} is available`,
      details: { id: options.id, installed: record.version },
    });
  }

  const upstream = resolveModule(options.registry, options.id, selected.version);
  assertModulePayload(upstream);
  assertCompatibleModule(upstream, options.project);

  const base = tryResolveModule(options.registry, options.id, record.version);
  const files = analyzeInstalledModule({
    projectRoot: options.projectRoot,
    record,
    upstream,
    base,
  });
  const conflicts = files.filter((file) => file.decision === "conflict");
  if (conflicts.length > 0) {
    return {
      id: options.id,
      fromVersion: record.version,
      toVersion: upstream.version,
      files,
      conflicts,
      writes: [],
      deletes: [],
      project: options.project,
      manifest: options.manifest,
      alreadyCurrent: false,
      packageDependencies: {},
      packagesToRemove: [],
    };
  }

  planFileOwnership(
    upstream.files.map((file) => ({
      moduleId: options.id,
      sourceAbs: path.join(upstream.absolutePath, file.source),
      targetRel: file.target,
      ownership: file.ownership,
    })),
    options.manifest,
  );

  let project = options.project;
  let manifest = options.manifest;
  let dependencyPlan: InstallPlan | undefined;
  const installedIds = new Set(manifest.modules.map((module) => module.id));
  const missingRoots = upstream.requiredDependencies.filter((dep) => !installedIds.has(dep));
  if (missingRoots.length > 0) {
    dependencyPlan = planInstall({
      projectRoot: options.projectRoot,
      registry: options.registry,
      roots: missingRoots,
      project,
      manifest,
      now: options.now,
      registrySource: options.registrySource ?? record.registrySource,
    });
    project = dependencyPlan.project;
    manifest = dependencyPlan.manifest;
  }

  const writes: PlannedUpdateWrite[] = [];
  const deletes: string[] = [];
  const nextFiles: InstalledFileRecord[] = [];

  for (const file of files) {
    if (file.kind === "generated") {
      continue;
    }
    if (file.decision === "replace-upstream") {
      if (file.upstreamContent !== undefined) {
        writes.push({ path: file.path, contents: file.upstreamContent });
        if (file.kind === "payload") {
          nextFiles.push({
            path: file.path,
            hash: file.upstreamHash ?? sha256Checksum(file.upstreamContent),
            ownership: file.ownership === "configuration" ? "exclusive" : file.ownership,
          });
        }
      } else if (!file.missingLocal) {
        deletes.push(file.path);
      }
      continue;
    }
    if (file.kind === "payload") {
      if (file.missingLocal && file.decision === "keep-local") {
        continue;
      }
      const ownership = file.ownership === "configuration" ? "exclusive" : file.ownership;
      const hash = file.upstreamHash ?? file.baseHash;
      if (hash !== undefined && (file.upstreamHash !== undefined || file.decision === "keep-local")) {
        nextFiles.push({ path: file.path, hash, ownership });
      }
    }
  }

  if (dependencyPlan) {
    for (const file of dependencyPlan.files) {
      writes.push({
        path: file.targetRel,
        contents: fs.readFileSync(file.sourceAbs),
      });
    }
    for (const module of dependencyPlan.modules) {
      if (!module.configuration) {
        continue;
      }
      const dest = module.configuration.target;
      if (writes.some((write) => write.path === dest)) {
        continue;
      }
      if (fs.existsSync(path.join(options.projectRoot, dest))) {
        continue;
      }
      writes.push({
        path: dest,
        contents: Buffer.from(stringifyYaml(defaultConfigFor(module)), "utf8"),
      });
    }
  }

  const configurationPaths = upstream.configuration ? [upstream.configuration.target] : [];
  const installedAt = (options.now ?? new Date()).toISOString();
  const nextRecord = toUpdatedRecord({
    module: upstream,
    previous: record,
    files: nextFiles,
    configurationPaths,
    installedAt,
    registrySource: options.registrySource ?? record.registrySource,
  });
  manifest = upsertInstalledModule(manifest, nextRecord);

  const previousPackages = collectInstalledPackageDependencies(options.manifest, options.registry);
  const nextPackages = collectInstalledPackageDependencies(manifest, options.registry);
  const removedPackages = packagesToRemove(previousPackages, nextPackages);
  const packageChanged =
    removedPackages.length > 0 ||
    Object.keys(nextPackages).some((name) => previousPackages[name] !== nextPackages[name]);

  const generated = buildGeneratedDocument(manifest, options.projectRoot, writes);
  writes.push({
    path: GENERATED_CONFIG_RELATIVE_PATH,
    contents: Buffer.from(stringifyYaml(generated), "utf8"),
  });

  const mutatingWrites = writes.filter((write) => write.path !== GENERATED_CONFIG_RELATIVE_PATH);
  const alreadyCurrent =
    record.version === upstream.version &&
    mutatingWrites.length === 0 &&
    deletes.length === 0 &&
    !packageChanged;

  return {
    id: options.id,
    fromVersion: record.version,
    toVersion: upstream.version,
    files,
    conflicts,
    writes: alreadyCurrent ? [] : writes,
    deletes,
    dependencyPlan,
    project,
    manifest,
    alreadyCurrent,
    packageDependencies: nextPackages,
    packagesToRemove: removedPackages,
  };
}

export function applyUpdate(options: {
  readonly projectRoot: string;
  readonly plan: UpdatePlan;
}): UpdateResult {
  if (options.plan.conflicts.length > 0) {
    const paths = options.plan.conflicts.map((file) => file.path);
    throw new VibeKitError({
      category: "conflict",
      code: "update_conflict",
      message: `Update of ${options.plan.id} stopped; conflicting files: ${paths.join(", ")}`,
      details: { id: options.plan.id, files: paths },
    });
  }

  if (options.plan.alreadyCurrent) {
    return {
      updated: false,
      fromVersion: options.plan.fromVersion,
      toVersion: options.plan.toVersion,
      created: [],
      changed: [],
      removed: [],
      plan: options.plan,
    };
  }

  const applied = applyStagedChanges({
    projectRoot: options.projectRoot,
    writes: options.plan.writes,
    deletes: options.plan.deletes,
    project: options.plan.project,
    manifest: options.plan.manifest,
    packageDependencies: options.plan.packageDependencies,
    packagesToRemove: options.plan.packagesToRemove,
  });

  return {
    updated: true,
    fromVersion: options.plan.fromVersion,
    toVersion: options.plan.toVersion,
    created: applied.created,
    changed: applied.changed,
    removed: applied.removed,
    plan: options.plan,
  };
}

export function rebuildGeneratedConfiguration(
  projectRoot: string,
  manifest: InstalledManifestDocument,
): string {
  const document = buildGeneratedDocument(manifest, projectRoot, []);
  const dest = safeResolve(projectRoot, GENERATED_CONFIG_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = stringifyYaml(document);
  fs.writeFileSync(dest, text, "utf8");
  return GENERATED_CONFIG_RELATIVE_PATH;
}

export function applyStagedChanges(options: {
  readonly projectRoot: string;
  readonly writes: readonly PlannedUpdateWrite[];
  readonly deletes: readonly string[];
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
  readonly packageDependencies?: Readonly<Record<string, string>>;
  readonly packagesToRemove?: readonly string[];
}): {
  created: string[];
  changed: string[];
  removed: string[];
} {
  const stagingRoot = path.join(options.projectRoot, STAGING_RELATIVE_PATH, randomUUID());
  const created: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const backups = new Map<string, Buffer>();
  const createdDirs: string[] = [];

  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    for (const write of options.writes) {
      assertFileTarget(write.path);
      const staged = path.join(stagingRoot, write.path);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, write.contents);
    }

    const projectResult = validateDocument("project", options.project);
    if (!projectResult.valid) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "project_invalid",
        message: projectResult.errors[0]?.message ?? "Projected project.yaml is invalid",
        details: { errors: projectResult.errors },
      });
    }
    const manifestResult = validateDocument("installed", options.manifest);
    if (!manifestResult.valid) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "installed_manifest_invalid",
        message: manifestResult.errors[0]?.message ?? "Staged installed.json is invalid",
        details: { errors: manifestResult.errors },
      });
    }

    for (const write of options.writes) {
      const dest = safeResolve(options.projectRoot, write.path);
      const staged = path.join(stagingRoot, write.path);
      if (fs.existsSync(dest)) {
        if (fs.statSync(dest).isDirectory()) {
          throw new VibeKitError({
            category: "conflict",
            code: "existing_file_conflict",
            message: `Installation target ${write.path} already exists as a directory`,
            details: { path: write.path },
          });
        }
        const previous = fs.readFileSync(dest);
        const next = fs.readFileSync(staged);
        if (Buffer.compare(previous, next) === 0) {
          continue;
        }
        backups.set(write.path, previous);
        fs.copyFileSync(staged, dest);
        changed.push(write.path);
      } else {
        ensureParentDirs(dest, options.projectRoot, createdDirs);
        fs.copyFileSync(staged, dest);
        created.push(write.path);
      }
    }

    for (const relative of options.deletes) {
      const dest = safeResolve(options.projectRoot, relative);
      if (!fs.existsSync(dest)) {
        continue;
      }
      if (fs.statSync(dest).isFile()) {
        backups.set(relative, fs.readFileSync(dest));
        fs.rmSync(dest, { force: true });
        removed.push(relative);
      }
    }

    const projectPath = path.join(options.projectRoot, ".vibekit/project.yaml");
    const nextProjectText = stringifyYaml(options.project);
    if (fs.existsSync(projectPath)) {
      const previous = fs.readFileSync(projectPath);
      if (previous.toString("utf8") !== nextProjectText) {
        backups.set(".vibekit/project.yaml", previous);
        writeProjectDocument(options.projectRoot, options.project);
        if (!changed.includes(".vibekit/project.yaml") && !created.includes(".vibekit/project.yaml")) {
          changed.push(".vibekit/project.yaml");
        }
      }
    } else {
      writeProjectDocument(options.projectRoot, options.project);
      created.push(".vibekit/project.yaml");
    }

    const installedPath = path.join(options.projectRoot, ".vibekit/installed.json");
    if (fs.existsSync(installedPath)) {
      const previous = fs.readFileSync(installedPath);
      backups.set(".vibekit/installed.json", previous);
    }
    writeInstalledManifest(options.projectRoot, options.manifest);
    if (!changed.includes(".vibekit/installed.json") && !created.includes(".vibekit/installed.json")) {
      changed.push(".vibekit/installed.json");
    }

    if (
      options.packageDependencies !== undefined ||
      (options.packagesToRemove !== undefined && options.packagesToRemove.length > 0)
    ) {
      applyPackageState({
        projectRoot: options.projectRoot,
        dependencies: options.packageDependencies ?? {},
        remove: options.packagesToRemove ?? [],
        tracker: { created, changed, backups },
      });
    }

    return { created, changed, removed };
  } catch (error) {
    rollback(options.projectRoot, created, backups);
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export function tryResolveModule(
  registry: Registry,
  id: ModuleId,
  version: string,
): LoadedModule | undefined {
  try {
    return resolveModule(registry, id, version);
  } catch (error) {
    if (
      error instanceof VibeKitError &&
      (error.code === "module_not_found" || error.code === "module_version_not_found")
    ) {
      return undefined;
    }
    throw error;
  }
}

function resolveSelectedVersion(
  registry: Registry,
  id: ModuleId,
  version: string,
): RegistryIndexEntry {
  const match = registry.index.modules.find((entry) => entry.id === id && entry.version === version);
  if (match === undefined) {
    throw new VibeKitError({
      category: "unavailable",
      code: "module_version_not_found",
      message: `Module ${id}@${version} is not in the registry`,
      details: { id, version },
    });
  }
  return match;
}

export function collectInstalledPackageDependencies(
  manifest: InstalledManifestDocument,
  registry?: Registry,
): Record<string, string> {
  const modules: LoadedModule[] = [];
  for (const record of manifest.modules) {
    try {
      modules.push(resolveInstalledModule(record, registry));
    } catch {
      continue;
    }
  }
  return collectPackageDependencies(modules);
}

function toUpdatedRecord(options: {
  readonly module: LoadedModule;
  readonly previous: InstalledModuleDocument;
  readonly files: readonly InstalledFileRecord[];
  readonly configurationPaths: readonly string[];
  readonly installedAt: string;
  readonly registrySource: string;
}): InstalledModuleDocument {
  const compatibility: CompatibilityDeclaration = options.module.compatibility ?? {
    vibekit: `^${VIBEKIT_VERSION}`,
    pi: `>=${PI_RUNTIME_VERSION}`,
  };
  return {
    schemaVersion: 1,
    id: options.module.id,
    version: options.module.version,
    registrySource: options.registrySource,
    sourceRevision: options.module.source?.revision ?? options.previous.sourceRevision,
    integrityChecksum:
      options.module.checksum ?? sha256Checksum(`${options.module.id}@${options.module.version}`),
    installedAt: options.installedAt,
    dependencies: [...options.module.requiredDependencies],
    files: [...options.files].sort((left, right) => left.path.localeCompare(right.path)),
    configurationPaths: [...options.configurationPaths],
    compatibility,
  };
}

export function buildGeneratedDocument(
  manifest: InstalledManifestDocument,
  projectRoot: string,
  writes: readonly PlannedUpdateWrite[],
): Record<string, unknown> {
  const writeMap = new Map(writes.map((write) => [write.path, write.contents]));
  const modules: Array<Record<string, unknown>> = [];
  for (const record of manifest.modules) {
    for (const fragment of record.configurationPaths) {
      if (isGeneratedPath(fragment)) {
        continue;
      }
      const written = writeMap.get(fragment);
      const abs = path.join(projectRoot, fragment);
      let text: string | undefined;
      if (written !== undefined) {
        text = written.toString("utf8");
      } else if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        text = fs.readFileSync(abs, "utf8");
      }
      modules.push({
        id: record.id,
        fragment,
        config: parseFragment(text),
      });
    }
  }
  return {
    schemaVersion: 1,
    generated: true,
    modules,
  };
}

function parseFragment(text: string | undefined): unknown {
  if (text === undefined) {
    return {};
  }
  try {
    const parsed = parseYaml(text);
    if (parsed === undefined || parsed === null) {
      return {};
    }
    return parsed;
  } catch {
    return { invalid: true };
  }
}

function rollback(
  projectRoot: string,
  created: readonly string[],
  backups: Map<string, Buffer>,
): void {
  for (const relative of [...created].reverse()) {
    const abs = path.join(projectRoot, relative);
    fs.rmSync(abs, { force: true, recursive: true });
  }
  for (const [relative, contents] of backups) {
    const abs = path.join(projectRoot, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
}

function ensureParentDirs(dest: string, projectRoot: string, createdDirs: string[]): void {
  const parent = path.dirname(dest);
  const relative = path.relative(projectRoot, parent);
  if (relative === "" || relative.startsWith("..")) {
    return;
  }
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
    createdDirs.push(relative);
  }
}
