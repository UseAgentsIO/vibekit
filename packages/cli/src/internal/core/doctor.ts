import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
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
import { buildRegistryIndex } from "./registry-index.js";
import { registryForInstalledModule, resolveInstalledModule } from "./registry-source.js";
import { scopeIsImpossible } from "./scope.js";
import type { InstalledManifestDocument, ProjectDocument } from "./types.js";
import { validateFileTarget } from "./file-targets.js";
import { parseAndValidateYaml, validateDocument, validateJsonSchema } from "./validate.js";
import { atomicWriteFile } from "./state/atomic.js";
import { PI_RUNTIME_VERSION, VIBEKIT_VERSION } from "./constants.js";
import { DEFAULT_RUNTIME_RELATIVE_PATH } from "./state/constants.js";
import { buildGeneratedDocument, GENERATED_CONFIG_RELATIVE_PATH } from "./update.js";
import { stringifyYaml } from "./yaml.js";
import { isProductRuntimePackage } from "../runtime-identifiers.js";

export type DoctorSeverity = "error" | "warning";

export interface DoctorFinding {
  readonly severity: DoctorSeverity;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly recommendedAction?: string;
  readonly fixable?: boolean;
}

export type DoctorRepairStatus = "applied" | "refused" | "skipped";

export interface DoctorRepair {
  readonly kind: string;
  readonly path: string;
  readonly status: DoctorRepairStatus;
  readonly message: string;
}

export interface DoctorReleaseSnapshot {
  readonly versions?: Readonly<Record<string, string>>;
  readonly checkedPaths?: readonly string[];
  readonly findings?: readonly DoctorFinding[];
}

export interface DoctorReport {
  readonly findings: readonly DoctorFinding[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly repairs?: readonly DoctorRepair[];
  readonly checkedPaths?: readonly string[];
  readonly versions?: Readonly<Record<string, string>>;
  readonly reportPath?: string;
}

export interface DoctorOptions {
  readonly projectRoot: string;
  readonly registry?: Registry;
  /** Run runtime-layout, release, secret, and lock diagnostics in addition to contract checks. */
  readonly diagnostics?: boolean;
  /** Apply only safe mechanical repairs. This is explicit approval for those repairs. */
  readonly fix?: boolean;
  /** Environment names are used only for boolean secret-presence checks. Values never enter findings. */
  readonly env?: NodeJS.ProcessEnv;
  readonly secretAvailable?: (name: string) => boolean;
  readonly release?: DoctorReleaseSnapshot;
  readonly now?: () => Date;
  /** Persist a redacted report under .vibekit/runtime/diagnostics/doctor.json. */
  readonly persistReport?: boolean;
}

export function runDoctor(options: DoctorOptions): DoctorReport {
  const findings: DoctorFinding[] = [];
  const repairs: DoctorRepair[] = [];
  const checkedPaths: string[] = [
    ".vibekit/project.yaml",
    ".vibekit/installed.json",
  ];
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
    checkInvalidPiExtensions(options.projectRoot, manifest, options.registry, findings);
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

  const diagnostics = options.diagnostics === true || options.fix === true;
  if (diagnostics) {
    if (options.fix === true) {
      applySafeRepairs({
        projectRoot: options.projectRoot,
        project,
        manifest,
        repairs,
        now: options.now,
      });
    }
    checkRuntimeLayout(options.projectRoot, project, manifest, findings, checkedPaths, repairs, options);
    checkRegistryIndex(options.registry, options.projectRoot, findings, checkedPaths, repairs, options.fix === true);
    checkReleaseSnapshot(options.release, findings, checkedPaths);
    if (project && manifest) {
      checkRequiredSecrets(project, manifest, options, findings);
    }
  }

  const normalizedFindings = findings.map(normalizeFinding);
  const report: DoctorReport = {
    findings: normalizedFindings,
    errorCount: normalizedFindings.filter((finding) => finding.severity === "error").length,
    warningCount: normalizedFindings.filter((finding) => finding.severity === "warning").length,
    repairs,
    checkedPaths: [...new Set(checkedPaths)].sort(),
    ...(options.release?.versions !== undefined ? { versions: options.release.versions } : {
      versions: {
        vibekit: VIBEKIT_VERSION,
        pi: PI_RUNTIME_VERSION,
        node: process.versions.node,
      },
    }),
  };
  if (diagnostics && options.persistReport !== false) {
    const reportPath = persistDoctorReport(options.projectRoot, report);
    if (reportPath !== undefined) {
      return { ...report, reportPath };
    }
  }
  return report;
}

export function persistDoctorReport(projectRoot: string, report: DoctorReport): string | undefined {
  const relative = ".vibekit/runtime/diagnostics/doctor.json";
  try {
    // Validate both the containing directory and the report target before any
    // mkdir/rename so a project symlink cannot redirect diagnostic output.
    safeOwnedPath(projectRoot, ".vibekit/runtime");
    safeOwnedPath(projectRoot, ".vibekit/runtime/diagnostics");
    const absolute = safeOwnedPath(projectRoot, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(absolute), 0o700);
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      versions: report.versions ?? {},
      checkedPaths: (report.checkedPaths ?? []).map(redactDiagnosticPath),
      findings: report.findings.map((finding) => ({
        severity: finding.severity,
        code: finding.code,
        message: redactDiagnosticText(finding.message),
        ...(finding.path !== undefined ? { path: redactDiagnosticPath(finding.path) } : {}),
        ...(finding.recommendedAction !== undefined
          ? { recommendedAction: redactDiagnosticText(finding.recommendedAction) }
          : {}),
        ...(finding.fixable !== undefined ? { fixable: finding.fixable } : {}),
      })),
      repairs: (report.repairs ?? []).map((repair) => ({
        kind: repair.kind,
        path: redactDiagnosticPath(repair.path),
        status: repair.status,
        message: redactDiagnosticText(repair.message),
      })),
    };
    atomicWriteFile(absolute, `${JSON.stringify(payload, null, 2)}\n`);
    fs.chmodSync(absolute, 0o600);
    return relative;
  } catch {
    return undefined;
  }
}

function applySafeRepairs(options: {
  readonly projectRoot: string;
  readonly project: ProjectDocument | undefined;
  readonly manifest: InstalledManifestDocument | undefined;
  readonly repairs: DoctorRepair[];
  readonly now?: () => Date;
}): void {
  for (const relative of [
    DEFAULT_RUNTIME_RELATIVE_PATH,
    ".vibekit/runtime/generated",
    ".vibekit/runtime/diagnostics",
  ] as const) {
    try {
      const directory = safeOwnedPath(options.projectRoot, relative);
      if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory()) {
        options.repairs.push({
          kind: "generated-directory",
          path: relative,
          status: "refused",
          message: "A non-directory already occupies this generated path; it was left unchanged.",
        });
        continue;
      }
      const before = fs.existsSync(directory) ? fs.statSync(directory).mode & 0o777 : undefined;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.chmodSync(directory, 0o700);
      if (before !== 0o700) {
        options.repairs.push({
          kind: "generated-directory",
          path: relative,
          status: "applied",
          message: before === undefined
            ? "Created the generated runtime directory."
            : "Restricted the generated runtime directory to the owner.",
        });
      }
    } catch (error) {
      options.repairs.push({
        kind: "generated-directory",
        path: relative,
        status: "refused",
        message: `Could not repair the generated directory: ${safeErrorMessage(error)}`,
      });
    }
  }

  if (options.manifest !== undefined) {
    try {
      const generatedPath = safeOwnedPath(options.projectRoot, GENERATED_CONFIG_RELATIVE_PATH);
      const expected = stringifyYaml(buildGeneratedDocument(options.manifest, options.projectRoot, []));
      if (!fs.existsSync(generatedPath) || fs.readFileSync(generatedPath, "utf8") !== expected) {
        atomicWriteFile(generatedPath, expected);
        fs.chmodSync(generatedPath, 0o600);
        options.repairs.push({
          kind: "derived-configuration",
          path: GENERATED_CONFIG_RELATIVE_PATH,
          status: "applied",
          message: "Rebuilt generated configuration from the installed manifest and fragments.",
        });
      } else {
        fs.chmodSync(generatedPath, 0o600);
        options.repairs.push({
          kind: "derived-configuration",
          path: GENERATED_CONFIG_RELATIVE_PATH,
          status: "skipped",
          message: "Generated configuration already matches its owned inputs.",
        });
      }
    } catch (error) {
      options.repairs.push({
        kind: "derived-configuration",
        path: GENERATED_CONFIG_RELATIVE_PATH,
        status: "refused",
        message: `Could not rebuild generated configuration: ${safeErrorMessage(error)}`,
      });
    }
  }

  repairRuntimeModes(options.projectRoot, options.repairs);
  repairStaleLocks(options.projectRoot, options.repairs, options.now?.() ?? new Date());
}

function repairRuntimeModes(projectRoot: string, repairs: DoctorRepair[]): void {
  let runtime: string;
  try {
    runtime = safeOwnedPath(projectRoot, DEFAULT_RUNTIME_RELATIVE_PATH);
  } catch (error) {
    repairs.push({
      kind: "owner-only-mode",
      path: DEFAULT_RUNTIME_RELATIVE_PATH,
      status: "refused",
      message: `Runtime path was left unchanged: ${safeErrorMessage(error)}`,
    });
    return;
  }
  if (!fs.existsSync(runtime) || !fs.statSync(runtime).isDirectory()) return;
  const stack = [runtime];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      repairs.push({
        kind: "owner-only-mode",
        path: relativeRuntimePath(projectRoot, current),
        status: "refused",
        message: `Could not inspect runtime contents: ${safeErrorMessage(error)}`,
      });
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = relativeRuntimePath(projectRoot, absolute);
      try {
        if (entry.isDirectory()) {
          const before = fs.statSync(absolute).mode & 0o777;
          fs.chmodSync(absolute, 0o700);
          if (before !== 0o700) {
            repairs.push({
              kind: "owner-only-mode",
              path: relative,
              status: "applied",
              message: "Restricted a runtime-owned directory to the owner.",
            });
          }
          stack.push(absolute);
        } else if (entry.isFile()) {
          const before = fs.statSync(absolute).mode & 0o777;
          fs.chmodSync(absolute, 0o600);
          if (before !== 0o600) {
            repairs.push({
              kind: "owner-only-mode",
              path: relative,
              status: "applied",
              message: "Restricted a runtime-owned file to the owner.",
            });
          }
        }
      } catch (error) {
        repairs.push({
          kind: "owner-only-mode",
          path: relative,
          status: "refused",
          message: `Could not restrict the runtime path: ${safeErrorMessage(error)}`,
        });
      }
    }
  }
}

function repairStaleLocks(projectRoot: string, repairs: DoctorRepair[], now: Date): void {
  const hostRelative = ".vibekit/runtime/host.lock";
  let hostPath: string;
  try {
    hostPath = safeOwnedPath(projectRoot, hostRelative);
  } catch (error) {
    repairs.push({
      kind: "stale-lock",
      path: hostRelative,
      status: "refused",
      message: `The Host lock path was left unchanged: ${safeErrorMessage(error)}`,
    });
    return;
  }
  if (fs.existsSync(hostPath)) {
    try {
      const raw = fs.readFileSync(hostPath, "utf8").trim();
      const pid = Number(raw);
      if (!Number.isInteger(pid) || pid <= 0) {
        repairs.push({
          kind: "stale-lock",
          path: hostRelative,
          status: "refused",
          message: "The Host lock does not contain a valid PID, so it was left unchanged.",
        });
      } else if (!pidAlive(pid)) {
        fs.unlinkSync(hostPath);
        repairs.push({
          kind: "stale-lock",
          path: hostRelative,
          status: "applied",
          message: "Removed a Host lock whose owner process is no longer alive.",
        });
      } else {
        repairs.push({
          kind: "stale-lock",
          path: hostRelative,
          status: "skipped",
          message: "The Host lock belongs to a live process and was left unchanged.",
        });
      }
    } catch (error) {
      repairs.push({
        kind: "stale-lock",
        path: hostRelative,
        status: "refused",
        message: `Could not inspect the Host lock: ${safeErrorMessage(error)}`,
      });
    }
  }

  const locksRelative = ".vibekit/runtime/locks";
  let locksPath: string;
  try {
    locksPath = safeOwnedPath(projectRoot, locksRelative);
  } catch (error) {
    repairs.push({
      kind: "stale-lock",
      path: locksRelative,
      status: "refused",
      message: `Runtime lock directory was left unchanged: ${safeErrorMessage(error)}`,
    });
    return;
  }
  if (!fs.existsSync(locksPath) || !fs.statSync(locksPath).isDirectory()) return;
  for (const entry of fs.readdirSync(locksPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const relative = `${locksRelative}/${entry.name}`;
    const absolute = path.join(locksPath, entry.name);
    let expiresAt: string | undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as unknown;
      expiresAt = parsed !== null && typeof parsed === "object"
        ? (parsed as { expiresAt?: unknown }).expiresAt as string | undefined
        : undefined;
      if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
        throw new Error("lock has no valid expiresAt");
      }
    } catch (error) {
      repairs.push({
        kind: "stale-lock",
        path: relative,
        status: "refused",
        message: `The State lock is malformed and was left unchanged: ${safeErrorMessage(error)}`,
      });
      continue;
    }
    if (Date.parse(expiresAt!) <= now.getTime()) {
      try {
        fs.unlinkSync(absolute);
        repairs.push({
          kind: "stale-lock",
          path: relative,
          status: "applied",
          message: "Removed an expired runtime State lock.",
        });
      } catch (error) {
        repairs.push({
          kind: "stale-lock",
          path: relative,
          status: "refused",
          message: `Could not remove the expired State lock: ${safeErrorMessage(error)}`,
        });
      }
    } else {
      repairs.push({
        kind: "stale-lock",
        path: relative,
        status: "skipped",
        message: "The State lock lease is active and was left unchanged.",
      });
    }
  }
}

function checkRuntimeLayout(
  projectRoot: string,
  _project: ProjectDocument | undefined,
  manifest: InstalledManifestDocument | undefined,
  findings: DoctorFinding[],
  checkedPaths: string[],
  _repairs: readonly DoctorRepair[],
  options: DoctorOptions,
): void {
  const runtimePaths = [
    DEFAULT_RUNTIME_RELATIVE_PATH,
    ".vibekit/runtime/generated",
    ".vibekit/runtime/diagnostics",
  ];
  for (const relative of runtimePaths) {
    checkedPaths.push(relative);
    let absolute: string;
    try {
      absolute = safeOwnedPath(projectRoot, relative);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "runtime_path_unsafe",
        message: `${relative} points outside the Project or through a symlink and was not auto-fixed: ${safeErrorMessage(error)}`,
        path: relative,
        fixable: false,
      });
      continue;
    }
    if (!fs.existsSync(absolute)) {
      findings.push({
        severity: "warning",
        code: "generated_directory_missing",
        message: `Generated runtime directory ${relative} is missing`,
        path: relative,
        fixable: true,
      });
    } else if (!fs.statSync(absolute).isDirectory()) {
      findings.push({
        severity: "error",
        code: "generated_directory_invalid",
        message: `${relative} exists but is not a directory`,
        path: relative,
        fixable: false,
      });
    }
  }

  if (manifest !== undefined) {
    checkedPaths.push(GENERATED_CONFIG_RELATIVE_PATH);
    let generatedPath: string;
    try {
      generatedPath = safeOwnedPath(projectRoot, GENERATED_CONFIG_RELATIVE_PATH);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "runtime_path_unsafe",
        message: `${GENERATED_CONFIG_RELATIVE_PATH} points outside the Project or through a symlink and was not auto-fixed: ${safeErrorMessage(error)}`,
        path: GENERATED_CONFIG_RELATIVE_PATH,
        fixable: false,
      });
      generatedPath = "";
    }
    let expected: string | undefined;
    try {
      expected = stringifyYaml(buildGeneratedDocument(manifest, projectRoot, []));
    } catch {
      expected = undefined;
    }
    if (generatedPath !== "" && expected !== undefined && (!fs.existsSync(generatedPath) || fs.readFileSync(generatedPath, "utf8") !== expected)) {
      findings.push({
        severity: "warning",
        code: "derived_configuration_stale",
        message: `${GENERATED_CONFIG_RELATIVE_PATH} does not match the installed manifest and configuration fragments`,
        path: GENERATED_CONFIG_RELATIVE_PATH,
        fixable: true,
      });
    }
  }

  checkRuntimeModes(projectRoot, findings, checkedPaths);
  checkRuntimeLocks(projectRoot, findings, checkedPaths, options.now?.() ?? new Date());
}

function checkRuntimeModes(projectRoot: string, findings: DoctorFinding[], checkedPaths: string[]): void {
  let runtime: string;
  try {
    runtime = safeOwnedPath(projectRoot, DEFAULT_RUNTIME_RELATIVE_PATH);
  } catch {
    return;
  }
  if (!fs.existsSync(runtime) || !fs.statSync(runtime).isDirectory()) return;
  const stack = [runtime];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = relativeRuntimePath(projectRoot, absolute);
      checkedPaths.push(relative);
      try {
        const mode = fs.statSync(absolute).mode & 0o777;
        const expected = entry.isDirectory() ? 0o700 : entry.isFile() ? 0o600 : mode;
        if (mode !== expected) {
          findings.push({
            severity: "warning",
            code: "owner_only_mode",
            message: `${relative} is mode ${mode.toString(8)}; runtime-owned paths must be owner-only`,
            path: relative,
            fixable: entry.isDirectory() || entry.isFile(),
          });
        }
        if (entry.isDirectory()) stack.push(absolute);
      } catch {
        // The path is still recorded above; inaccessible paths are diagnosed by their parent.
      }
    }
  }
}

function checkRuntimeLocks(
  projectRoot: string,
  findings: DoctorFinding[],
  checkedPaths: string[],
  now: Date,
): void {
  const hostRelative = ".vibekit/runtime/host.lock";
  let hostPath: string;
  try {
    hostPath = safeOwnedPath(projectRoot, hostRelative);
  } catch {
    return;
  }
  if (fs.existsSync(hostPath)) {
    checkedPaths.push(hostRelative);
    try {
      const pid = Number(fs.readFileSync(hostPath, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 0) {
        findings.push({
          severity: "error",
          code: "host_lock_invalid",
          message: "Host lock does not contain a valid process ID and was not auto-fixed",
          path: hostRelative,
          fixable: false,
        });
      } else if (pidAlive(pid)) {
        findings.push({
          severity: "warning",
          code: "host_lock_active",
          message: `Host lock belongs to live process ${pid}; stop that Host before repairing it`,
          path: hostRelative,
          fixable: false,
        });
      } else {
        findings.push({
          severity: "warning",
          code: "host_lock_stale",
          message: "Host lock belongs to a process that is no longer alive",
          path: hostRelative,
          fixable: true,
        });
      }
    } catch {
      findings.push({
        severity: "error",
        code: "host_lock_invalid",
        message: "Host lock could not be read and was not auto-fixed",
        path: hostRelative,
        fixable: false,
      });
    }
  }

  const locksRelative = ".vibekit/runtime/locks";
  let locksPath: string;
  try {
    locksPath = safeOwnedPath(projectRoot, locksRelative);
  } catch {
    return;
  }
  if (!fs.existsSync(locksPath) || !fs.statSync(locksPath).isDirectory()) return;
  for (const entry of fs.readdirSync(locksPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const relative = `${locksRelative}/${entry.name}`;
    checkedPaths.push(relative);
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(locksPath, entry.name), "utf8")) as unknown;
      const expiresAt = parsed !== null && typeof parsed === "object"
        ? (parsed as { expiresAt?: unknown }).expiresAt
        : undefined;
      if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) throw new Error("malformed lock");
      if (Date.parse(expiresAt) <= now.getTime()) {
        findings.push({
          severity: "warning",
          code: "state_lock_stale",
          message: "Runtime State lock lease has expired",
          path: relative,
          fixable: true,
        });
      } else {
        findings.push({
          severity: "warning",
          code: "state_lock_active",
          message: "Runtime State lock lease is active and was left unchanged",
          path: relative,
          fixable: false,
        });
      }
    } catch {
      findings.push({
        severity: "error",
        code: "state_lock_corrupt",
        message: "Runtime State lock is malformed and was left unchanged",
        path: relative,
        fixable: false,
      });
    }
  }
}

function checkRegistryIndex(
  registry: Registry | undefined,
  projectRoot: string,
  findings: DoctorFinding[],
  checkedPaths: string[],
  repairs: DoctorRepair[],
  fix: boolean,
): void {
  if (registry === undefined) return;
  const indexPath = path.join(registry.root, "index.json");
  const relative = path.relative(projectRoot, indexPath).replaceAll(path.sep, "/");
  checkedPaths.push(relative.length > 0 ? relative : "index.json");
  try {
    const built = buildRegistryIndex(registry.root).index;
    const expected = `${JSON.stringify(built, null, 2)}\n`;
    const actual = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : undefined;
    if (actual === expected) return;
    const registryRelative = path.relative(projectRoot, registry.root);
    const insideProject = registryRelative === "" || (!registryRelative.startsWith("..") && !path.isAbsolute(registryRelative));
    if (fix && insideProject) {
      try {
        const safeIndex = safeOwnedPath(projectRoot, relative);
        atomicWriteFile(safeIndex, expected);
        fs.chmodSync(safeIndex, 0o600);
        repairs.push({
          kind: "generated-index",
          path: relative,
          status: "applied",
          message: "Regenerated the local registry index from its module directories.",
        });
      } catch (error) {
        findings.push({
          severity: "error",
          code: "registry_path_unsafe",
          message: `Registry index was not auto-fixed because its path is unsafe: ${safeErrorMessage(error)}`,
          path: relative,
          fixable: false,
        });
      }
      return;
    }
    findings.push({
      severity: "warning",
      code: "registry_index_stale",
      message: "Registry index.json does not match its module directories",
      path: relative,
      fixable: insideProject,
      recommendedAction: insideProject
        ? "Run vibekit doctor --fix or pnpm registry:index from the registry owner checkout, then rerun vibekit doctor."
        : "Run pnpm registry:index in the registry owner checkout, then rerun vibekit doctor.",
    });
  } catch (error) {
    findings.push({
      severity: "error",
      code: "registry_index_unavailable",
      message: `Registry index could not be verified: ${safeErrorMessage(error)}`,
      path: relative,
      fixable: false,
      recommendedAction: "Repair the registry source and regenerate index.json with pnpm registry:index, then rerun vibekit doctor.",
    });
  }
}

function checkReleaseSnapshot(
  release: DoctorReleaseSnapshot | undefined,
  findings: DoctorFinding[],
  checkedPaths: string[],
): void {
  if (release === undefined) return;
  for (const relative of release.checkedPaths ?? []) checkedPaths.push(relative);
  for (const finding of release.findings ?? []) findings.push(finding);
}

function checkRequiredSecrets(
  project: ProjectDocument,
  manifest: InstalledManifestDocument,
  options: DoctorOptions,
  findings: DoctorFinding[],
): void {
  const available = options.secretAvailable ?? ((name: string) => {
    const env = options.env ?? process.env;
    return typeof env[name] === "string" && env[name]!.length > 0;
  });
  const seen = new Set<string>();
  const enabledInterfaces = new Set(
    Object.values(project.interfaceBindings ?? {})
      .filter((binding) => binding.enabled)
      .map((binding) => binding.definition),
  );
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, options.registry);
    } catch {
      continue;
    }
    // Provider credentials are classified by the live probe. Disabled Interfaces
    // and inactive Tool credentials are intentionally not required during Doctor.
    if (loaded.document.type !== "interface" || !enabledInterfaces.has(record.id)) continue;
    for (const secret of loaded.document.secrets ?? []) {
      if (secret.required !== true || seen.has(secret.name)) continue;
      seen.add(secret.name);
      let present = false;
      try {
        present = available(secret.name);
      } catch {
        present = false;
      }
      if (!present) {
        findings.push({
          severity: "error",
          code: "secret_missing",
          message: `Required secret ${secret.name} for ${record.id} is not available`,
          path: ".vibekit/runtime/diagnostics/doctor.json",
          fixable: false,
        });
      }
    }
  }
}

function normalizeFinding(finding: DoctorFinding): DoctorFinding {
  return {
    ...finding,
    recommendedAction: finding.recommendedAction ?? recommendedActionFor(finding),
  };
}

function recommendedActionFor(finding: DoctorFinding): string {
  if (finding.fixable === true) return "Run vibekit doctor --fix, then rerun vibekit doctor.";
  if (finding.code.startsWith("pi_") && finding.path !== undefined) {
    return `Run vibekit update for the Module that owns ${finding.path}, then rerun vibekit doctor.`;
  }
  const actions: Record<string, string> = {
    project_schema: "Repair .vibekit/project.yaml using a valid Project document, then rerun vibekit doctor.",
    installed_schema: "Repair .vibekit/installed.json with the owning install or update command, then rerun vibekit doctor.",
    installed_file_missing: "Restore the missing owned file with vibekit update or remove the broken Module explicitly.",
    installed_hash_mismatch: "Review the local edit with vibekit diff before choosing update, keep-local, or removal.",
    host_lock_active: "Stop the live Host cleanly, then rerun vibekit doctor --fix.",
    host_lock_invalid: "Confirm no Host is running, remove the malformed lock manually, then rerun vibekit doctor.",
    state_lock_active: "Wait for or release the active State operation, then rerun vibekit doctor.",
    state_lock_corrupt: "Stop State operations, inspect the malformed lock, and remove it only after confirming ownership.",
    secret_missing: "Set the named deployment or environment secret without printing its value, then rerun vibekit doctor.",
    runtime_package_unresolved: "Install the recorded runtime package for this Project, then rerun vibekit doctor.",
    runtime_export_missing: "Install the matching runtime package release or update the Module from its registry source.",
  };
  return actions[finding.code] ?? "Review this finding and apply the smallest safe repair before rerunning vibekit doctor.";
}

function relativeRuntimePath(projectRoot: string, absolute: string): string {
  const relative = path.relative(projectRoot, absolute).replaceAll(path.sep, "/");
  return relative.length > 0 ? relative : DEFAULT_RUNTIME_RELATIVE_PATH;
}

function safeOwnedPath(projectRoot: string, relative: string): string {
  const root = path.resolve(projectRoot);
  const absolute = safeResolve(projectRoot, relative);
  let current = absolute;
  while (current !== root) {
    if (fs.existsSync(current)) {
      const currentRelative = path.relative(root, current) || ".";
      safeResolve(projectRoot, currentRelative);
    }
    current = path.dirname(current);
  }
  return absolute;
}

function redactDiagnosticPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (path.isAbsolute(normalized)) {
    return path.basename(normalized);
  }
  // A path.relative() result can still disclose an absolute external path as
  // ../../../Users/...; keep the report useful without preserving that host
  // directory structure.
  if (normalized === ".." || normalized.startsWith("../")) {
    return `[external]/${path.basename(normalized)}`;
  }
  return normalized;
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, (match) => {
      const separator = match.match(/\s*[:=]\s*/)?.[0] ?? "=";
      return `${match.slice(0, match.indexOf(separator))}${separator}[redacted]`;
    })
    .replace(/\b(?:sk|pk)-[A-Za-z0-9][A-Za-z0-9*_/-]{4,}/gi, "[redacted]")
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

function safeErrorMessage(error: unknown): string {
  return redactDiagnosticText(error instanceof Error ? error.message : String(error));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function checkInvalidPiExtensions(
  projectRoot: string,
  manifest: InstalledManifestDocument,
  registry: Registry | undefined,
  findings: DoctorFinding[],
): void {
  for (const record of manifest.modules) {
    let loaded: LoadedModule;
    try {
      loaded = resolveInstalledModule(record, registry);
    } catch {
      continue;
    }
    for (const file of loaded.files) {
      const target = file.target.replaceAll("\\", "/");
      if (!target.startsWith(".pi/extensions/")) {
        continue;
      }
      const sourceAbs = path.join(loaded.absolutePath, file.source);
      if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
        continue;
      }
      const source = fs.readFileSync(sourceAbs, "utf8");
      if (isPiExtensionFactorySource(source)) {
        continue;
      }
      const installed = record.files.find((candidate) => candidate.path === target);
      if (installed === undefined) {
        continue;
      }
      const absolute = safeResolve(projectRoot, installed.path);
      if (!fs.existsSync(absolute)) {
        continue;
      }
      const correctedVersion = correctedVersionFor(record, registry);
      const updateAction = correctedVersion
        ? `Run vibekit update ${record.id} (to ${correctedVersion})`
        : `Run vibekit update ${record.id} after installing its corrected registry version`;
      const code = isKnownInvalidPiBuiltinPath(record.id, record.version, target)
        ? "pi_builtin_extension_stub"
        : "pi_extension_stub";
      findings.push({
        severity: "error",
        code,
        message:
          `${record.id}@${record.version} owns invalid Pi extension ${target}. ` +
          `${updateAction} to remove the unchanged file transactionally; if it was edited, the update will stop with a conflict for this exact path.`,
        path: target,
      });
    }
  }
}

function isPiExtensionFactorySource(source: string): boolean {
  return /\bexport\s+default\s+(?:(?:async)\s+)?function\b|\bexport\s+default\s+(?:(?:async)\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(
    source,
  );
}

function correctedVersionFor(
  record: InstalledManifestDocument["modules"][number],
  selected: Registry | undefined,
): string | undefined {
  try {
    const source = registryForInstalledModule(record, selected);
    return source.index.modules
      .filter((entry) => entry.id === record.id && entry.version !== record.version)
      .sort((left, right) => semver.rcompare(left.version, right.version))[0]?.version;
  } catch {
    return undefined;
  }
}

function isKnownInvalidPiBuiltinPath(moduleId: string, version: string, filePath: string): boolean {
  if (version !== "1.0.0") {
    return false;
  }
  return (
    (moduleId === "tool:execution" && filePath === ".pi/extensions/execution/index.ts") ||
    (moduleId === "tool:filesystem" && filePath === ".pi/extensions/filesystem/index.ts")
  );
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
    if (isProductRuntimePackage(runtime.package)) {
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
