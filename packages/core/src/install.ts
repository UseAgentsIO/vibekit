import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { satisfiesCompatibility } from "./compatibility.js";
import { sha256Checksum, sha256File } from "./checksum.js";
import { resolveCapabilityProviders } from "./composition.js";
import {
  OFFICIAL_REGISTRY_SOURCE,
  PI_RUNTIME_VERSION,
  STAGING_RELATIVE_PATH,
  VIBEKIT_VERSION,
} from "./constants.js";
import { VibeKitError } from "./errors.js";
import { assertFileTarget } from "./file-targets.js";
import { resolveInstallSet } from "./graph.js";
import type { ModuleId } from "./ids.js";
import { upsertInstalledModule, writeInstalledManifest } from "./installed.js";
import type { LoadedModule } from "./module.js";
import { planFileOwnership, type PlannedFile } from "./ownership.js";
import { applyPackageState, collectPackageDependencies } from "./packages.js";
import { safeResolve } from "./paths.js";
import { resolveInstalledModule } from "./registry-source.js";
import { writeProjectDocument } from "./project.js";
import type { Registry } from "./registry.js";
import { assertModulePayload, resolveModule } from "./registry.js";
import type {
  CompatibilityDeclaration,
  InstalledFileRecord,
  InstalledManifestDocument,
  InstalledModuleDocument,
  PermissionRequest,
  ProjectDocument,
  SecretReference,
} from "./types.js";
import { validateDocument } from "./validate.js";
import { stringifyYaml } from "./yaml.js";

export interface InstallPlan {
  readonly modules: readonly LoadedModule[];
  readonly files: readonly PlannedFile[];
  readonly permissions: readonly PlannedPermission[];
  readonly secrets: readonly SecretReference[];
  readonly recommended: readonly ModuleId[];
  readonly optional: readonly ModuleId[];
  readonly packageDependencies: Readonly<Record<string, string>>;
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
}

export interface PlannedPermission {
  readonly moduleId: ModuleId;
  readonly requests: readonly PermissionRequest[];
  readonly grants?: LoadedModule["permissionGrants"];
}

export interface InstallResult {
  readonly created: readonly string[];
  readonly changed: readonly string[];
  readonly plan: InstallPlan;
}

export interface PlanInstallOptions {
  readonly projectRoot: string;
  readonly registry: Registry;
  readonly roots: readonly ModuleId[];
  readonly project: ProjectDocument;
  readonly manifest: InstalledManifestDocument;
  readonly now?: Date;
  readonly registrySource?: string;
}

export function planInstall(options: PlanInstallOptions): InstallPlan {
  const lookup = (id: ModuleId): LoadedModule | undefined => {
    try {
      return resolveModule(options.registry, id);
    } catch (error) {
      if (error instanceof VibeKitError && error.code === "module_not_found") {
        return undefined;
      }
      throw error;
    }
  };

  const installedIds = new Set<ModuleId>(options.manifest.modules.map((module) => module.id));
  const installedLoaded = loadInstalledModules(options.manifest, options.registry);
  const { resolved, bindings } = resolveInstallWithCapabilities({
    registry: options.registry,
    lookup,
    roots: options.roots,
    installedIds,
    installedLoaded,
    projectBindings: options.project.capabilityBindings,
  });

  const files: PlannedFile[] = [];
  const permissions: PlannedPermission[] = [];
  const secrets: SecretReference[] = [];
  const nextProject = {
    ...structuredClone(options.project),
    capabilityBindings: {
      ...options.project.capabilityBindings,
      ...bindings,
    },
  } as ProjectDocument;
  let nextManifest = options.manifest;
  const installedAt = (options.now ?? new Date()).toISOString();
  const registrySource = options.registrySource ?? options.registry.source ?? OFFICIAL_REGISTRY_SOURCE;

  for (const module of resolved.toInstall) {
    assertModulePayload(module);
    assertCompatible(module, nextProject);
    permissions.push({
      moduleId: module.id,
      requests: module.requestsPermissions,
      grants: module.permissionGrants,
    });
    for (const secret of module.secrets) {
      if (!secrets.some((item) => item.name === secret.name)) {
        secrets.push(secret);
      }
    }
    for (const file of module.files) {
      assertFileTarget(file.source);
      assertFileTarget(file.target);
      files.push({
        moduleId: module.id,
        sourceAbs: path.join(module.absolutePath, file.source),
        targetRel: file.target,
        ownership: file.ownership,
      });
    }
    if (module.configuration) {
      assertFileTarget(module.configuration.target);
    }
    applyProjectSideEffects(nextProject, module);
    nextManifest = upsertInstalledModule(
      nextManifest,
      toInstalledRecord(module, installedAt, registrySource),
    );
  }

  const packageDependencies = collectPackageDependencies(
    uniqueModules([...resolved.toInstall, ...resolved.alreadyInstalled, ...installedLoaded]),
  );

  planFileOwnership(files, options.manifest);
  assertNoExistingConflicts(options.projectRoot, files);

  const projectResult = validateDocument("project", nextProject);
  if (!projectResult.valid) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_invalid",
      message: projectResult.errors[0]?.message ?? "Projected project.yaml is invalid",
      details: { errors: projectResult.errors },
    });
  }

  return {
    modules: resolved.toInstall,
    files,
    permissions,
    secrets,
    recommended: resolved.recommended,
    optional: resolved.optional,
    packageDependencies,
    project: nextProject,
    manifest: nextManifest,
  };
}

export function applyInstall(options: {
  readonly projectRoot: string;
  readonly plan: InstallPlan;
}): InstallResult {
  const stagingRoot = path.join(
    options.projectRoot,
    STAGING_RELATIVE_PATH,
    randomUUID(),
  );
  const created: string[] = [];
  const changed: string[] = [];
  const backups = new Map<string, Buffer>();
  const createdDirs: string[] = [];

  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    for (const file of options.plan.files) {
      const staged = path.join(stagingRoot, file.targetRel);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.copyFileSync(file.sourceAbs, staged);
    }

    validateStagedPlan(stagingRoot, options.plan);

    for (const file of options.plan.files) {
      const dest = safeResolve(options.projectRoot, file.targetRel);
      const staged = path.join(stagingRoot, file.targetRel);
      if (fs.existsSync(dest)) {
        if (fs.statSync(dest).isDirectory()) {
          throw new VibeKitError({
            category: "conflict",
            code: "existing_file_conflict",
            message: `Installation target ${file.targetRel} already exists as a directory`,
            details: { path: file.targetRel, moduleId: file.moduleId },
          });
        }
        const existing = fs.readFileSync(dest);
        const next = fs.readFileSync(staged);
        if (Buffer.compare(existing, next) === 0) {
          continue;
        }
        throw new VibeKitError({
          category: "conflict",
          code: "existing_file_conflict",
          message: `Refusing to overwrite existing file ${file.targetRel}`,
          details: { path: file.targetRel, moduleId: file.moduleId },
        });
      }
      ensureParentDirs(dest, options.projectRoot, createdDirs);
      fs.copyFileSync(staged, dest);
      created.push(file.targetRel);
    }

    for (const module of options.plan.modules) {
      if (!module.configuration) {
        continue;
      }
      const dest = safeResolve(options.projectRoot, module.configuration.target);
      if (!fs.existsSync(dest)) {
        ensureParentDirs(dest, options.projectRoot, createdDirs);
        fs.writeFileSync(dest, stringifyYaml(defaultConfigFor(module)), "utf8");
        created.push(module.configuration.target);
      }
    }

    const projectPath = path.join(options.projectRoot, ".vibekit/project.yaml");
    const nextProjectText = stringifyYaml(options.plan.project);
    if (fs.existsSync(projectPath)) {
      const previous = fs.readFileSync(projectPath);
      if (previous.toString("utf8") !== nextProjectText) {
        backups.set(".vibekit/project.yaml", previous);
        writeProjectDocument(options.projectRoot, options.plan.project);
        changed.push(".vibekit/project.yaml");
      }
    } else {
      writeProjectDocument(options.projectRoot, options.plan.project);
      created.push(".vibekit/project.yaml");
    }

    const installedPath = path.join(options.projectRoot, ".vibekit/installed.json");
    if (fs.existsSync(installedPath)) {
      backups.set(".vibekit/installed.json", fs.readFileSync(installedPath));
    }
    writeInstalledManifest(options.projectRoot, options.plan.manifest);
    if (!changed.includes(".vibekit/installed.json") && !created.includes(".vibekit/installed.json")) {
      changed.push(".vibekit/installed.json");
    }

    applyPackageState({
      projectRoot: options.projectRoot,
      dependencies: options.plan.packageDependencies,
      tracker: { created, changed, backups },
    });

    return { created, changed, plan: options.plan };
  } catch (error) {
    rollback(options.projectRoot, created, backups);
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
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

function validateStagedPlan(stagingRoot: string, plan: InstallPlan): void {
  for (const file of plan.files) {
    const staged = path.join(stagingRoot, file.targetRel);
    if (!fs.existsSync(staged)) {
      throw new VibeKitError({
        category: "internal_error",
        code: "staging_file_missing",
        message: `Staged file missing: ${file.targetRel}`,
      });
    }
    assertFileTarget(file.targetRel);
  }
  const projectResult = validateDocument("project", plan.project);
  if (!projectResult.valid) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_invalid",
      message: projectResult.errors[0]?.message ?? "Staged project.yaml is invalid",
      details: { errors: projectResult.errors },
    });
  }
  const manifestResult = validateDocument("installed", plan.manifest);
  if (!manifestResult.valid) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "installed_manifest_invalid",
      message: manifestResult.errors[0]?.message ?? "Staged installed.json is invalid",
      details: { errors: manifestResult.errors },
    });
  }
}

function assertCompatible(module: LoadedModule, project: ProjectDocument): void {
  if (!module.compatibility) {
    return;
  }
  const actual = {
    vibekit: VIBEKIT_VERSION,
    pi: PI_RUNTIME_VERSION,
    node: process.versions.node,
  };
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

function applyProjectSideEffects(project: ProjectDocument, module: LoadedModule): void {
  const mutable = project as unknown as {
    agentBindings: Record<string, { definition: ModuleId }>;
    delegation: Record<string, readonly string[]>;
    policies: ModuleId[];
    verification: { default: ModuleId[] };
    state: { backend: ModuleId; path: string; tracking: ProjectDocument["state"]["tracking"] };
    capabilityBindings: Record<string, ModuleId>;
  };
  if (module.type === "agent") {
    mutable.agentBindings[module.name] = { definition: module.id };
    if (mutable.delegation[module.name] === undefined) {
      mutable.delegation[module.name] = [];
    }
  }
  if (module.type === "policy" && !mutable.policies.includes(module.id)) {
    mutable.policies.push(module.id);
  }
  if (module.type === "verifier" && !mutable.verification.default.includes(module.id)) {
    mutable.verification.default.push(module.id);
  }
  if (module.type === "state" && module.id === "state:repository") {
    mutable.state.backend = module.id;
  }
}

function toInstalledRecord(
  module: LoadedModule,
  installedAt: string,
  registrySource: string,
): InstalledModuleDocument {
  const files: InstalledFileRecord[] = module.files.map((file) => ({
    path: file.target,
    hash: sha256File(path.join(module.absolutePath, file.source)),
    ownership: file.ownership,
  }));
  const configurationPaths = module.configuration ? [module.configuration.target] : [];
  const compatibility: CompatibilityDeclaration = module.compatibility ?? {
    vibekit: `^${VIBEKIT_VERSION}`,
    pi: `>=${PI_RUNTIME_VERSION}`,
  };
  return {
    schemaVersion: 1,
    id: module.id,
    version: module.version,
    registrySource,
    sourceRevision: module.source?.revision ?? "unspecified",
    integrityChecksum: module.checksum ?? sha256Checksum(`${module.id}@${module.version}`),
    installedAt,
    dependencies: [...module.requiredDependencies],
    files,
    configurationPaths,
    compatibility,
  };
}

function defaultConfigFor(_module: LoadedModule): Record<string, unknown> {
  return {};
}

function assertNoExistingConflicts(projectRoot: string, files: readonly PlannedFile[]): void {
  for (const file of files) {
    const dest = safeResolve(projectRoot, file.targetRel);
    if (!fs.existsSync(dest)) {
      continue;
    }
    if (fs.statSync(dest).isDirectory()) {
      throw new VibeKitError({
        category: "conflict",
        code: "existing_file_conflict",
        message: `Installation target ${file.targetRel} already exists as a directory`,
        details: { path: file.targetRel, moduleId: file.moduleId },
      });
    }
    const existing = fs.readFileSync(dest);
    const next = fs.readFileSync(file.sourceAbs);
    if (Buffer.compare(existing, next) !== 0) {
      throw new VibeKitError({
        category: "conflict",
        code: "existing_file_conflict",
        message: `Refusing to overwrite existing file ${file.targetRel}`,
        details: { path: file.targetRel, moduleId: file.moduleId },
      });
    }
  }
}

function resolveInstallWithCapabilities(options: {
  readonly registry: Registry;
  readonly lookup: (id: ModuleId) => LoadedModule | undefined;
  readonly roots: readonly ModuleId[];
  readonly installedIds: ReadonlySet<ModuleId>;
  readonly installedLoaded: readonly LoadedModule[];
  readonly projectBindings: Readonly<Record<string, ModuleId>>;
}): {
  resolved: ReturnType<typeof resolveInstallSet>;
  bindings: Readonly<Record<string, ModuleId>>;
} {
  let roots = [...options.roots];
  let resolved = resolveInstallSet(roots, options.lookup, options.installedIds);
  let bindings: Readonly<Record<string, ModuleId>> = options.projectBindings;
  for (let round = 0; round < 8; round += 1) {
    const available = uniqueModules([
      ...resolved.toInstall,
      ...resolved.alreadyInstalled,
      ...options.installedLoaded,
    ]);
    const extra = resolveCapabilityProviders({
      registry: options.registry,
      lookup: options.lookup,
      agents: available.filter((module) => module.type === "agent"),
      available,
      projectBindings: bindings,
    });
    bindings = extra.bindings;
    const missing = extra.extraRoots.filter((id) => !roots.includes(id) && !options.installedIds.has(id));
    if (missing.length === 0) {
      return { resolved, bindings };
    }
    roots = [...roots, ...missing];
    resolved = resolveInstallSet(roots, options.lookup, options.installedIds);
  }
  return { resolved, bindings };
}

function loadInstalledModules(
  manifest: InstalledManifestDocument,
  registry: Registry,
): LoadedModule[] {
  const loaded: LoadedModule[] = [];
  for (const record of manifest.modules) {
    try {
      loaded.push(resolveInstalledModule(record, registry));
    } catch {
      continue;
    }
  }
  return loaded;
}

function uniqueModules(modules: readonly LoadedModule[]): LoadedModule[] {
  const seen = new Set<ModuleId>();
  const result: LoadedModule[] = [];
  for (const module of modules) {
    if (seen.has(module.id)) {
      continue;
    }
    seen.add(module.id);
    result.push(module);
  }
  return result;
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
