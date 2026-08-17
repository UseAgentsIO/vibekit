import fs from "node:fs";
import path from "node:path";

import { sha256Checksum, sha256File } from "./checksum.js";
import { VibeKitError } from "./errors.js";
import { parseModuleId, type ModuleId } from "./ids.js";
import { getInstalledModule } from "./installed.js";
import type { LoadedModule } from "./module.js";
import type { Registry } from "./registry.js";
import type { InstalledManifestDocument, InstalledModuleDocument, ProjectDocument } from "./types.js";
import { stringifyYaml } from "./yaml.js";
import {
  GENERATED_CONFIG_RELATIVE_PATH,
  applyStagedChanges,
  buildGeneratedDocument,
  defaultConfigFor,
  isGeneratedPath,
  tryResolveModule,
  type PlannedUpdateWrite,
} from "./update.js";

export interface KeptModule {
  readonly id: ModuleId;
  readonly reason: string;
}

export interface RemovePlan {
  readonly id: ModuleId;
  readonly modulesToRemove: readonly ModuleId[];
  readonly filesToRemove: readonly string[];
  readonly keptShared: readonly KeptModule[];
  readonly modified: readonly string[];
  readonly dependents: readonly ModuleId[];
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
  readonly writes: readonly PlannedUpdateWrite[];
}

export interface RemoveResult {
  readonly removed: readonly ModuleId[];
  readonly deleted: readonly string[];
  readonly kept: readonly ModuleId[];
  readonly created: readonly string[];
  readonly changed: readonly string[];
  readonly plan: RemovePlan;
}

export interface PlanRemoveOptions {
  readonly projectRoot: string;
  readonly registry: Registry;
  readonly id: ModuleId;
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
}

export function planRemove(options: PlanRemoveOptions): RemovePlan {
  const record = getInstalledModule(options.manifest, options.id);
  if (record === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_not_installed",
      message: `${options.id} is not installed`,
      details: { id: options.id },
    });
  }

  const dependents = findDependents(options.manifest, options.id);
  if (dependents.length > 0) {
    throw new VibeKitError({
      category: "conflict",
      code: "module_in_use",
      message: `Cannot remove ${options.id}; required by ${dependents.join(", ")}`,
      details: { id: options.id, dependents },
    });
  }

  const modulesToRemove = collectRemovableModules(options.manifest, options.id);
  const removeSet = new Set(modulesToRemove);
  const remaining = options.manifest.modules.filter((module) => !removeSet.has(module.id));
  const keptShared = collectKeptShared(options.manifest, options.id, removeSet);

  const filesToRemove: string[] = [];
  const modified: string[] = [];
  const stillOwned = collectOwnedPaths(remaining);

  for (const moduleId of modulesToRemove) {
    const installed = getInstalledModule(options.manifest, moduleId);
    if (installed === undefined) {
      continue;
    }
    const base = tryResolveModule(options.registry, installed.id, installed.version);
    for (const file of installed.files) {
      if (file.ownership === "generated" || isGeneratedPath(file.path)) {
        continue;
      }
      if (stillOwned.has(file.path)) {
        continue;
      }
      const abs = path.join(options.projectRoot, file.path);
      if (!fs.existsSync(abs)) {
        filesToRemove.push(file.path);
        continue;
      }
      if (!fs.statSync(abs).isFile()) {
        modified.push(file.path);
        continue;
      }
      if (sha256File(abs) !== file.hash) {
        modified.push(file.path);
        continue;
      }
      filesToRemove.push(file.path);
    }
    for (const configPath of installed.configurationPaths) {
      if (isGeneratedPath(configPath) || stillOwned.has(configPath)) {
        continue;
      }
      const abs = path.join(options.projectRoot, configPath);
      if (!fs.existsSync(abs)) {
        filesToRemove.push(configPath);
        continue;
      }
      if (!fs.statSync(abs).isFile()) {
        modified.push(configPath);
        continue;
      }
      if (isConfigModified(abs, base)) {
        modified.push(configPath);
        continue;
      }
      filesToRemove.push(configPath);
    }
  }

  if (modified.length > 0) {
    return {
      id: options.id,
      modulesToRemove,
      filesToRemove: [],
      keptShared,
      modified,
      dependents,
      project: options.project,
      manifest: options.manifest,
      writes: [],
    };
  }

  const nextModules = remaining;
  const nextManifest: InstalledManifestDocument = {
    schemaVersion: 1,
    modules: nextModules,
  };
  const nextProject = revertProjectSideEffects(options.project, modulesToRemove);
  const generated = buildGeneratedDocument(nextManifest, options.projectRoot, []);
  const writes: PlannedUpdateWrite[] = [
    {
      path: GENERATED_CONFIG_RELATIVE_PATH,
      contents: Buffer.from(stringifyYaml(generated), "utf8"),
    },
  ];

  return {
    id: options.id,
    modulesToRemove,
    filesToRemove: uniqueSorted(filesToRemove),
    keptShared,
    modified,
    dependents,
    project: nextProject,
    manifest: nextManifest,
    writes,
  };
}

export function applyRemove(options: {
  readonly projectRoot: string;
  readonly plan: RemovePlan;
}): RemoveResult {
  if (options.plan.modified.length > 0) {
    throw new VibeKitError({
      category: "conflict",
      code: "remove_modified",
      message: `Removal of ${options.plan.id} stopped; modified files: ${options.plan.modified.join(", ")}`,
      details: { id: options.plan.id, files: options.plan.modified },
    });
  }

  const applied = applyStagedChanges({
    projectRoot: options.projectRoot,
    writes: options.plan.writes,
    deletes: options.plan.filesToRemove,
    project: options.plan.project,
    manifest: options.plan.manifest,
  });

  return {
    removed: options.plan.modulesToRemove,
    deleted: applied.removed,
    kept: options.plan.keptShared.map((item) => item.id),
    created: applied.created,
    changed: applied.changed,
    plan: options.plan,
  };
}

function findDependents(manifest: InstalledManifestDocument, id: ModuleId): ModuleId[] {
  return manifest.modules
    .filter((module) => module.id !== id && module.dependencies.includes(id))
    .map((module) => module.id)
    .sort((left, right) => left.localeCompare(right));
}

function collectRemovableModules(
  manifest: InstalledManifestDocument,
  root: ModuleId,
): ModuleId[] {
  const byId = new Map(manifest.modules.map((module) => [module.id, module]));
  const remove = new Set<ModuleId>([root]);
  let changed = true;
  while (changed) {
    changed = false;
    const remaining = manifest.modules.filter((module) => !remove.has(module.id));
    const requiredByRemaining = new Set(remaining.flatMap((module) => module.dependencies));
    for (const id of [...remove]) {
      const record = byId.get(id);
      if (record === undefined) {
        continue;
      }
      for (const dep of record.dependencies) {
        if (!byId.has(dep) || remove.has(dep) || requiredByRemaining.has(dep)) {
          continue;
        }
        remove.add(dep);
        changed = true;
      }
    }
  }
  return [...remove].sort((left, right) => left.localeCompare(right));
}

function collectKeptShared(
  manifest: InstalledManifestDocument,
  root: ModuleId,
  removeSet: ReadonlySet<ModuleId>,
): KeptModule[] {
  const rootRecord = getInstalledModule(manifest, root);
  if (rootRecord === undefined) {
    return [];
  }
  const remaining = manifest.modules.filter((module) => !removeSet.has(module.id));
  const kept: KeptModule[] = [];
  for (const dep of rootRecord.dependencies) {
    if (removeSet.has(dep)) {
      continue;
    }
    const users = remaining.filter((module) => module.dependencies.includes(dep)).map((module) => module.id);
    if (users.length > 0) {
      kept.push({
        id: dep,
        reason: `still required by ${users.join(", ")}`,
      });
    }
  }
  return kept.sort((left, right) => left.id.localeCompare(right.id));
}

function collectOwnedPaths(modules: readonly InstalledModuleDocument[]): Set<string> {
  const paths = new Set<string>();
  for (const module of modules) {
    for (const file of module.files) {
      paths.add(file.path);
    }
    for (const configPath of module.configurationPaths) {
      paths.add(configPath);
    }
  }
  return paths;
}

function isConfigModified(abs: string, base: LoadedModule | undefined): boolean {
  const actual = sha256File(abs);
  if (base === undefined) {
    return true;
  }
  const expected = sha256Checksum(stringifyYaml(defaultConfigFor(base)));
  return actual !== expected;
}

function revertProjectSideEffects(
  project: ProjectDocument,
  removed: readonly ModuleId[],
): ProjectDocument {
  const removeSet = new Set(removed);
  const agentBindings = { ...project.agentBindings };
  const delegation = { ...project.delegation };
  for (const id of removed) {
    const { type, name } = parseModuleId(id);
    if (type === "agent") {
      delete agentBindings[name];
      delete delegation[name];
    }
  }
  const capabilityBindings = Object.fromEntries(
    Object.entries(project.capabilityBindings).filter(([, provider]) => !removeSet.has(provider)),
  );
  const next: ProjectDocument = {
    ...project,
    agentBindings,
    delegation,
    capabilityBindings,
    policies: project.policies.filter((id) => !removeSet.has(id)),
    verification: {
      ...project.verification,
      default: project.verification.default.filter((id) => !removeSet.has(id)),
    },
    state: {
      ...project.state,
      backend: removeSet.has(project.state.backend) ? "state:repository" : project.state.backend,
    },
  };
  return next;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
