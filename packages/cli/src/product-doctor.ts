import {
  readInstalledManifest,
  readProjectDocument,
  resolveInstalledModule,
  runDoctor,
  type DoctorFinding,
  type DoctorOptions,
  type DoctorReport,
} from "./internal/core/index.js";
import { loadInterfaceFactory } from "./internal/host/index.js";
import {
  importProductRuntime,
  isProductRuntimePackage,
} from "./internal/runtime-identifiers.js";

interface BundledRuntime {
  readonly id: string;
  readonly packageName: string;
  readonly exportName: string;
}

/**
 * Core Doctor resolves optional runtime packages from the Project's
 * package.json. The product package deliberately owns its first-party
 * runtime packages, so the CLI validates those packages from its own module
 * graph at the release boundary and leaves all Project-owned dependencies to
 * Core Doctor.
 */
export async function runProductDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const base = runDoctor(options);
  const bundled = await inspectBundledRuntimes(options);
  const interfaces = options.diagnostics === true
    ? []
    : await inspectDefaultInterfaces(options.projectRoot);
  const findings = [
    ...base.findings.filter((finding) => !isBundledProjectResolution(finding, bundled)),
    ...bundled.flatMap((runtime) => runtime.findings),
    ...interfaces,
  ];
  return {
    ...base,
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
}

async function inspectDefaultInterfaces(projectRoot: string): Promise<readonly DoctorFinding[]> {
  let project;
  try {
    project = readProjectDocument(projectRoot);
  } catch {
    return [];
  }
  const findings: DoctorFinding[] = [];
  for (const [bindingName, binding] of Object.entries(project.interfaceBindings ?? {})) {
    if (!binding.enabled) {
      continue;
    }
    try {
      await loadInterfaceFactory(binding.definition, undefined, projectRoot);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : "";
      findings.push({
        severity: "error",
        code: "interface_load_failed",
        message: `Default Interface ${bindingName} (${binding.definition}) could not load from the installed product${reason}`,
        path: binding.definition,
        recommendedAction:
          "Reinstall @useagentsio/vibekit from a fresh product artifact, then rerun vibekit create.",
      });
    }
  }
  return findings;
}

interface BundledRuntimeCheck extends BundledRuntime {
  readonly findings: readonly DoctorFinding[];
}

async function inspectBundledRuntimes(options: DoctorOptions): Promise<readonly BundledRuntimeCheck[]> {
  let manifest;
  try {
    manifest = readInstalledManifest(options.projectRoot);
  } catch {
    return [];
  }

  const runtimes = new Map<string, BundledRuntime>();
  for (const record of manifest.modules) {
    let loaded;
    try {
      loaded = resolveInstalledModule(record, options.registry);
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
      runtime.kind === "pi-builtin" ||
      runtime.package === undefined ||
      runtime.package.length === 0 ||
      runtime.export === undefined ||
      runtime.export.length === 0 ||
      !isProductRuntimePackage(runtime.package)
    ) {
      continue;
    }
    const key = `${loaded.id}\u0000${runtime.package}\u0000${runtime.export}`;
    runtimes.set(key, {
      id: loaded.id,
      packageName: runtime.package,
      exportName: runtime.export,
    });
  }

  const checks: BundledRuntimeCheck[] = [];
  for (const runtime of runtimes.values()) {
    checks.push({
      ...runtime,
      findings: await verifyBundledRuntime(runtime),
    });
  }
  return checks;
}

async function verifyBundledRuntime(runtime: BundledRuntime): Promise<readonly DoctorFinding[]> {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await importProductRuntime(runtime.packageName)) ?? {};
    if (Object.keys(loaded).length === 0) throw new Error("internal runtime is unavailable");
  } catch (error) {
    const reason = error instanceof Error ? ` (${error.message})` : "";
    return [
      {
        severity: "error",
        code: "runtime_package_unresolved",
        message:
          `${runtime.id} bundled runtime package ${runtime.packageName} is unavailable from the installed CLI artifact${reason}`,
        recommendedAction:
          `Reinstall @useagentsio/vibekit from a fresh product artifact, then rerun vibekit doctor.`,
      },
    ];
  }
  if (loaded[runtime.exportName] === undefined) {
    return [
      {
        severity: "error",
        code: "runtime_export_missing",
        message:
          `${runtime.id} bundled runtime package ${runtime.packageName} does not export ${runtime.exportName}`,
        recommendedAction:
          `Reinstall @useagentsio/vibekit from a fresh product artifact, then rerun vibekit doctor.`,
      },
    ];
  }
  return [];
}

function isBundledProjectResolution(
  finding: DoctorFinding,
  bundled: readonly BundledRuntimeCheck[],
): boolean {
  if (finding.code !== "runtime_package_unresolved") {
    return false;
  }
  return bundled.some(
    (runtime) =>
      finding.message.startsWith(`${runtime.id} runtime package ${runtime.packageName} `),
  );
}
