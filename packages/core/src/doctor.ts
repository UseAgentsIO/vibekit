import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { NON_MODULE_CAPABILITIES, loadInstalledProviders } from "./authority.js";
import { sha256File } from "./checksum.js";
import { resolveRequiredCapabilities } from "./capabilities.js";
import { detectConflicts, detectCycles } from "./graph.js";
import type { ModuleId } from "./ids.js";
import { readInstalledManifest } from "./installed.js";
import { isAgentDocument, type LoadedModule } from "./module.js";
import { collectInstalledOwnership } from "./ownership.js";
import { safeResolve } from "./paths.js";
import { readProjectDocument } from "./project.js";
import type { Registry } from "./registry.js";
import { resolveInstalledModule } from "./registry-source.js";
import { scopeIsImpossible } from "./scope.js";
import type { InstalledManifestDocument, ProjectDocument } from "./types.js";
import { validateFileTarget } from "./file-targets.js";
import { parseAndValidateYaml, validateDocument, validateJsonSchema } from "./validate.js";

export type DoctorSeverity = "error" | "warning";

export interface DoctorFinding {
  readonly severity: DoctorSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface DoctorReport {
  readonly findings: readonly DoctorFinding[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export function runDoctor(options: {
  readonly projectRoot: string;
  readonly registry?: Registry;
}): DoctorReport {
  const findings: DoctorFinding[] = [];
  let project: ProjectDocument | undefined;
  let manifest: InstalledManifestDocument | undefined;

  try {
    project = readProjectDocument(options.projectRoot);
    const validated = validateDocument("project", project);
    if (!validated.valid) {
      for (const error of validated.errors) {
        findings.push({
          severity: "error",
          code: "project_schema",
          message: error.message,
          path: error.path,
        });
      }
    }
  } catch (error) {
    findings.push(toFinding(error, "project_schema"));
  }

  try {
    manifest = readInstalledManifest(options.projectRoot);
    const validated = validateDocument("installed", manifest);
    if (!validated.valid) {
      for (const error of validated.errors) {
        findings.push({
          severity: "error",
          code: "installed_schema",
          message: error.message,
          path: error.path,
        });
      }
    }
  } catch (error) {
    findings.push(toFinding(error, "installed_schema"));
  }

  if (project && project.schemaVersion !== 1 && project.schemaVersion !== 2) {
    findings.push({
      severity: "error",
      code: "schema_version",
      message: `Unsupported project schemaVersion ${project.schemaVersion}`,
    });
  }
  if (manifest && manifest.schemaVersion !== 1) {
    findings.push({
      severity: "error",
      code: "schema_version",
      message: `Unsupported installed schemaVersion ${manifest.schemaVersion}`,
    });
  }

  if (manifest) {
    checkOwnership(manifest, findings);
    checkInstalledFiles(options.projectRoot, manifest, findings);
    checkInstalledIntegrity(options.projectRoot, manifest, findings);
  }

  if (manifest && project) {
    checkAgentReferences(project, manifest, findings);
    checkDelegationGraph(project, findings);
    checkDependencies(manifest, options.registry, findings);
    checkCapabilityBindings(project, manifest, options.registry, findings);
    checkEnabledInterfaces(project, manifest, findings);
    checkAgentCapabilities(options.projectRoot, project, manifest, options.registry, findings);
    checkComponentConfigs(options.projectRoot, manifest, options.registry, findings);
    checkRuntimePackages(options.projectRoot, manifest, options.registry, findings);
    checkGrantScopes(options.projectRoot, manifest, options.registry, findings);
  }

  return {
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
}

function checkOwnership(
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const seen = new Map<string, ModuleId>();
  for (const module of manifest.modules) {
    for (const file of module.files) {
      const target = validateFileTarget(file.path);
      if (!target.valid) {
        findings.push({
          severity: "error",
          code: "file_target_invalid",
          message: target.errors[0]?.message ?? "Invalid file target",
          path: file.path,
        });
      }
      if (file.ownership !== "exclusive") {
        continue;
      }
      const owner = seen.get(file.path);
      if (owner && owner !== module.id) {
        findings.push({
          severity: "error",
          code: "duplicate_exclusive_ownership",
          message: `${file.path} is owned by both ${owner} and ${module.id}`,
          path: file.path,
        });
      } else {
        seen.set(file.path, module.id);
      }
    }
  }
  collectInstalledOwnership(manifest);
}

function checkInstalledFiles(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const ids = new Set<string>();
  for (const module of manifest.modules) {
    if (ids.has(module.id)) {
      findings.push({
        severity: "error",
        code: "duplicate_module_id",
        message: `Duplicate installed Module ${module.id}`,
      });
    }
    ids.add(module.id);
    if (module.schemaVersion !== 1) {
      findings.push({
        severity: "error",
        code: "schema_version",
        message: `Unsupported schemaVersion on ${module.id}`,
      });
    }
    for (const file of module.files) {
      try {
        const abs = safeResolve(projectRoot, file.path);
        if (!fs.existsSync(abs)) {
          findings.push({
            severity: "error",
            code: "installed_file_missing",
            message: `Installed file ${file.path} for ${module.id} is missing`,
            path: file.path,
          });
          continue;
        }
        if (isInstalledAgentDocument(module.id, file.path)) {
          checkAgentDocument(abs, file.path, findings);
        }
      } catch (error) {
        findings.push(toFinding(error, "file_target_invalid"));
      }
    }
  }
}

function checkInstalledIntegrity(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  for (const module of manifest.modules) {
    for (const file of module.files) {
      const abs = path.join(projectRoot, file.path);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== file.hash) {
        findings.push({
          severity: "warning",
          code: "installed_hash_mismatch",
          message: `File ${file.path} does not match the recorded hash for ${module.id}`,
          path: file.path,
        });
      }
    }
  }
}

function checkDependencies(
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  const installed = new Set(manifest.modules.map((module) => module.id));
  const loaded: LoadedModule[] = [];
  const edges = new Map<ModuleId, ModuleId[]>();

  for (const record of manifest.modules) {
    let module: LoadedModule;
    try {
      module = resolveInstalledModule(record, selected);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "registry_source_unavailable",
        message:
          error instanceof Error
            ? `Installed module ${record.id}@${record.version} could not be resolved from ${record.registrySource}: ${error.message}`
            : `Installed module ${record.id}@${record.version} could not be resolved from ${record.registrySource}`,
      });
      continue;
    }
    loaded.push(module);
    edges.set(module.id, [...module.requiredDependencies]);
    for (const dep of module.requiredDependencies) {
      if (!installed.has(dep)) {
        findings.push({
          severity: "error",
          code: "required_dependency_missing",
          message: `${module.id} requires ${dep}, which is not installed`,
        });
      }
    }
  }

  const cycles = detectCycles(edges);
  for (const cycle of cycles) {
    findings.push({
      severity: "error",
      code: "dependency_cycle",
      message: `Dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  for (const conflict of detectConflicts(loaded)) {
    if (installed.has(conflict.left) && installed.has(conflict.right)) {
      findings.push({
        severity: "error",
        code: "module_conflict",
        message: `${conflict.left} conflicts with ${conflict.right}`,
      });
    }
  }
}

function checkAgentReferences(
  project: ProjectDocument,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const installed = new Set(manifest.modules.map((module) => module.id));
  for (const [binding, spec] of Object.entries(project.agentBindings)) {
    if (!installed.has(spec.definition)) {
      findings.push({
        severity: "error",
        code: "agent_binding_missing",
        message: `Agent binding "${binding}" references ${spec.definition}, which is not installed`,
      });
    }
    const allowed = project.delegation[binding];
    if (allowed === undefined) {
      findings.push({
        severity: "warning",
        code: "delegation_binding_missing",
        message: `Agent binding "${binding}" has no Project delegation entry`,
      });
    }
  }
}

function checkCapabilityBindings(
  project: ProjectDocument,
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  const installed = new Set(manifest.modules.map((module) => module.id));
  for (const [capability, providerId] of Object.entries(project.capabilityBindings)) {
    if (!installed.has(providerId)) {
      findings.push({
        severity: "error",
        code: "capability_provider_missing",
        message: `capabilityBindings.${capability} references ${providerId}, which is not installed`,
      });
      continue;
    }
    const record = manifest.modules.find((module) => module.id === providerId);
    if (record === undefined) {
      continue;
    }
    try {
      const loaded = resolveInstalledModule(record, selected);
      if (!loaded.providesCapabilities.includes(capability)) {
        findings.push({
          severity: "error",
          code: "capability_provider_invalid",
          message: `${providerId} does not provide ${capability}`,
        });
      }
    } catch (error) {
      findings.push({
        severity: "error",
        code: "capability_provider_unresolved",
        message:
          error instanceof Error
            ? `Could not resolve ${providerId} for ${capability}: ${error.message}`
            : `Could not resolve ${providerId} for ${capability}`,
      });
    }
  }
}

function checkEnabledInterfaces(
  project: ProjectDocument,
  manifest: InstalledManifestDocument,
  findings: DoctorFinding[],
): void {
  const installed = new Set(manifest.modules.map((module) => module.id));
  for (const [name, binding] of Object.entries(project.interfaceBindings ?? {})) {
    if (!binding.enabled) {
      continue;
    }
    if (!installed.has(binding.definition)) {
      findings.push({
        severity: "error",
        code: "interface_not_installed",
        message: `Enabled Interface binding "${name}" references ${binding.definition}, which is not installed`,
      });
      continue;
    }
    const record = manifest.modules.find((module) => module.id === binding.definition);
    if (record === undefined) {
      continue;
    }
    try {
      const loaded = resolveInstalledModule(record);
      if (loaded.document.type === "agent") {
        findings.push({
          severity: "error",
          code: "interface_not_executable",
          message: `${binding.definition} is not an Interface Module`,
        });
        continue;
      }
      const runtime = loaded.document.runtime;
      if (runtime?.kind !== "interface" || runtime.package === undefined || runtime.export === undefined) {
        findings.push({
          severity: "error",
          code: "interface_not_executable",
          message: `${binding.definition} is enabled but has no executable Interface runtime`,
        });
      }
    } catch (error) {
      findings.push({
        severity: "error",
        code: "interface_unresolved",
        message:
          error instanceof Error
            ? `Could not resolve Interface ${binding.definition}: ${error.message}`
            : `Could not resolve Interface ${binding.definition}`,
      });
    }
  }
}

function checkDelegationGraph(project: ProjectDocument, findings: DoctorFinding[]): void {
  const edges = new Map<string, string[]>();
  for (const [binding, targets] of Object.entries(project.delegation)) {
    edges.set(binding, [...targets]);
    if (project.agentBindings[binding] === undefined) {
      findings.push({
        severity: "error",
        code: "delegation_binding_unknown",
        message: `Delegation graph references unknown binding "${binding}"`,
      });
    }
    for (const target of targets) {
      if (project.agentBindings[target] === undefined) {
        findings.push({
          severity: "error",
          code: "delegation_target_missing",
          message: `Delegation ${binding} → ${target} has no Agent binding`,
        });
      }
    }
  }
  for (const cycle of detectStringCycles(edges)) {
    findings.push({
      severity: "error",
      code: "delegation_cycle",
      message: `Delegation cycle: ${cycle.join(" -> ")}`,
    });
  }
}

function detectStringCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(node: string, stack: string[]): void {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push(start >= 0 ? [...stack.slice(start), node] : [...stack, node]);
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      visit(next, stack);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of edges.keys()) {
    visit(node, []);
  }
  return cycles;
}

function isInstalledAgentDocument(moduleId: string, filePath: string): boolean {
  return moduleId.startsWith("agent:") && /(^|\/)agent\.yaml$/.test(filePath.replaceAll("\\", "/"));
}

function checkAgentDocument(abs: string, relative: string, findings: DoctorFinding[]): void {
  const validated = parseAndValidateYaml("agent", fs.readFileSync(abs, "utf8"));
  if (validated.valid) {
    return;
  }
  findings.push({
    severity: "error",
    code: "agent_schema",
    message: validated.errors[0]?.message ?? "Installed Agent document is invalid",
    path: relative,
  });
}

function checkAgentCapabilities(
  projectRoot: string,
  project: ProjectDocument,
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  const providers = loadInstalledProviders(projectRoot);
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, selected);
    } catch {
      continue;
    }
    if (!isAgentDocument(loaded.document)) {
      continue;
    }
    const required = loaded.document.capabilities.requires.filter(
      (capability) => !NON_MODULE_CAPABILITIES.has(capability),
    );
    const resolutions = resolveRequiredCapabilities(required, {
      projectBindings: project.capabilityBindings,
      installedProviders: providers,
    });
    for (const resolution of resolutions) {
      if (resolution.status === "resolved") {
        continue;
      }
      findings.push({
        severity: "error",
        code: resolution.reason === "ambiguous" ? "capability_ambiguous" : "capability_unresolved",
        message:
          resolution.reason === "ambiguous"
            ? `${loaded.id} requires ${resolution.capability}, which is provided by several Modules`
            : `${loaded.id} requires ${resolution.capability}, which is not provided by the installed composition`,
      });
    }
  }
}

function checkComponentConfigs(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, selected);
    } catch {
      continue;
    }
    const configuration = loaded.configuration;
    if (configuration === undefined) {
      continue;
    }
    const configAbs = path.join(projectRoot, configuration.target);
    if (!fs.existsSync(configAbs) || !fs.statSync(configAbs).isFile()) {
      continue;
    }
    const schemaAbs = path.join(loaded.absolutePath, configuration.schema);
    if (!fs.existsSync(schemaAbs)) {
      findings.push({
        severity: "warning",
        code: "config_schema_missing",
        message: `${loaded.id} is missing ${configuration.schema}`,
        path: configuration.schema,
      });
      continue;
    }
    let data: unknown;
    try {
      data = parseYaml(fs.readFileSync(configAbs, "utf8"));
    } catch (error) {
      findings.push({
        severity: "error",
        code: "config_invalid",
        message:
          error instanceof Error
            ? `${configuration.target} is not valid YAML: ${error.message}`
            : `${configuration.target} is not valid YAML`,
        path: configuration.target,
      });
      continue;
    }
    let schema: object;
    try {
      schema = JSON.parse(fs.readFileSync(schemaAbs, "utf8")) as object;
    } catch {
      findings.push({
        severity: "error",
        code: "config_schema_invalid",
        message: `${loaded.id} config.schema.json is not valid JSON`,
        path: configuration.schema,
      });
      continue;
    }
    const validated = validateJsonSchema(schema, data ?? {});
    if (!validated.valid) {
      findings.push({
        severity: "error",
        code: "config_invalid",
        message: `${configuration.target} does not match ${loaded.id} config.schema.json: ${validated.errors[0]?.message ?? "invalid"}`,
        path: configuration.target,
      });
    }
  }
}

function checkRuntimePackages(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  const requireFrom = path.join(projectRoot, "package.json");
  const resolver = fs.existsSync(requireFrom) ? createRequire(requireFrom) : undefined;
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, selected);
    } catch {
      continue;
    }
    if (loaded.document.type === "agent") {
      continue;
    }
    const runtime = loaded.document.runtime;
    if (
      runtime === undefined ||
      runtime.available === false ||
      runtime.kind === "config-only" ||
      runtime.kind === "pi-builtin"
    ) {
      continue;
    }
    if (runtime.package === undefined || runtime.package.length === 0) {
      findings.push({
        severity: "error",
        code: "runtime_package_missing",
        message: `${loaded.id} is executable but missing runtime.package`,
      });
      continue;
    }
    if (runtime.export === undefined || runtime.export.length === 0) {
      findings.push({
        severity: "error",
        code: "runtime_export_missing",
        message: `${loaded.id} is executable but missing runtime.export`,
      });
      continue;
    }
    if (resolver === undefined) {
      findings.push({
        severity: "error",
        code: "runtime_package_unresolved",
        message: `${loaded.id} runtime package ${runtime.package} cannot resolve; package.json is missing`,
      });
      continue;
    }
    const declared = packageDeclares(projectRoot, runtime.package);
    let resolvedPackagePath: string;
    try {
      resolvedPackagePath = resolver.resolve(runtime.package);
    } catch {
      findings.push({
        severity: declared ? "warning" : "error",
        code: "runtime_package_unresolved",
        message: `${loaded.id} runtime package ${runtime.package} cannot resolve from the Project`,
      });
      continue;
    }

    try {
      const loadedPkg = resolver(resolvedPackagePath);
      if (loadedPkg !== null && typeof loadedPkg === "object") {
        if ((loadedPkg as Record<string, unknown>)[runtime.export] === undefined) {
          findings.push({
            severity: "error",
            code: "runtime_export_missing",
            message: `${loaded.id} runtime package ${runtime.package} does not export ${runtime.export}`,
          });
        }
      }
    } catch {
      try {
        const text = fs.readFileSync(resolvedPackagePath, "utf8");
        const exportRegex = new RegExp(
          `\\b(export\\s+(?:(?:async\\s+)?function|const|let|var|class)\\s+${runtime.export}\\b|export\\s*\\{[^}]*\\b${runtime.export}\\b|exports\\.${runtime.export}\\b|module\\.exports\\s*=\\s*\\{[^}]*\\b${runtime.export}\\b)`,
        );
        if (!exportRegex.test(text)) {
          findings.push({
            severity: "error",
            code: "runtime_export_missing",
            message: `${loaded.id} runtime package ${runtime.package} does not export ${runtime.export}`,
          });
        }
      } catch {
        // resolution succeeded; ignore static read errors
      }
    }
  }
}

function checkGrantScopes(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  selected: Registry | undefined,
  findings: DoctorFinding[],
): void {
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, selected);
    } catch {
      continue;
    }
    if (!isAgentDocument(loaded.document)) {
      continue;
    }
    const grants = [
      ...loaded.document.permissions.allow,
      ...loaded.document.permissions.deny,
    ];
    for (const grant of grants) {
      const paths = grant.scope?.paths ?? [];
      for (const pattern of paths) {
        if (pattern.includes("\0") || pattern.startsWith("/") || pattern.includes("..")) {
          findings.push({
            severity: "error",
            code: "grant_scope_unsafe",
            message: `${loaded.id} grant for ${grant.capability} includes an unsafe path ${pattern}`,
          });
        }
      }
      const commands = grant.scope?.commands ?? [];
      for (const cmd of commands) {
        if (cmd.includes("\0")) {
          findings.push({
            severity: "error",
            code: "grant_scope_unsafe",
            message: `${loaded.id} grant for ${grant.capability} includes an unsafe command specifier`,
          });
        }
      }
      const branches = grant.scope?.branches ?? [];
      for (const branch of branches) {
        if (branch.includes("\0") || branch.startsWith("/") || branch.includes("..")) {
          findings.push({
            severity: "error",
            code: "grant_scope_unsafe",
            message: `${loaded.id} grant for ${grant.capability} includes an unsafe branch specifier ${branch}`,
          });
        }
      }
      const resources = grant.scope?.resources ?? [];
      for (const res of resources) {
        if (res.includes("\0")) {
          findings.push({
            severity: "error",
            code: "grant_scope_unsafe",
            message: `${loaded.id} grant for ${grant.capability} includes an unsafe resource specifier`,
          });
        }
      }
      if (scopeIsImpossible(grant.scope, grant.capability)) {
        findings.push({
          severity: "error",
          code: "grant_scope_impossible",
          message: `${loaded.id} grant for ${grant.capability} has an empty effective scope`,
        });
      }
    }
  }
}

function packageDeclares(projectRoot: string, packageName: string): boolean {
  const packagePath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return false;
  }
  try {
    const body = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return body.dependencies?.[packageName] !== undefined || body.devDependencies?.[packageName] !== undefined;
  } catch {
    return false;
  }
}

function toFinding(error: unknown, code: string): DoctorFinding {
  if (error instanceof Error) {
    return { severity: "error", code, message: error.message };
  }
  return { severity: "error", code, message: "Unknown doctor error" };
}
