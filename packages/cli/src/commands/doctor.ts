import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  inboundIsUntrusted,
  pairingRequired,
  persistDoctorReport,
  readInstalledManifest,
  readProjectDocument,
  resolveInstalledModule,
  sha256File,
  type DoctorFinding,
  type DoctorReleaseSnapshot,
  type DoctorReport,
  type ProjectDocument,
  type Registry,
} from "../internal/core/index.js";
import {
  probeProvider,
  secretNameForProvider,
  type ProviderProbeResult,
} from "../internal/pi/index.js";
import {
  loadBindingConfig,
  loadInterfaceFactory,
  readDeploymentSecrets,
} from "../internal/host/index.js";
import type { InterfaceServices, RunningInterface } from "../internal/interfaces/sdk/index.js";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";
import { runProductDoctor } from "../product-doctor.js";

export async function runDoctorCommand(flags: GlobalFlags, out: OutputBuffer): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  let registry;
  let registrySource = "official";
  let registryError: unknown;
  let registryUnavailable = false;
  try {
    const selected = resolveRegistrySelection(flags.registry);
    registry = selected.registry;
    registrySource = selected.source;
  } catch (error) {
    registry = undefined;
    registryError = error;
    registryUnavailable = true;
  }
  const project = readProjectSafely(projectRoot);
  const deployment = project === undefined ? {} : readDeploymentSecrets(project.id);
  const env = { ...process.env, ...deployment };
  const release = buildReleaseSnapshot(registrySource, registry);
  const base = await runProductDoctor({
    projectRoot,
    registry,
    diagnostics: true,
    fix: flags.fix,
    env,
    secretAvailable: (name) => typeof env[name] === "string" && env[name]!.length > 0,
    release,
    persistReport: false,
  });
  const liveFindings = await collectLiveDiagnostics({
    projectRoot,
    project,
    registry,
    flags,
    env,
  });
  const findings = [
    ...(!registryUnavailable
      ? []
      : [withRecommendedAction({
        severity: "error" as const,
        code: "registry_unavailable",
        message: `The selected registry could not be loaded: ${redact(registryError)}`,
        fixable: false,
      })]),
    ...base.findings,
    ...liveFindings.map(withRecommendedAction),
  ];
  const report: DoctorReport = {
    ...base,
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
  };
  const reportPath = persistDoctorReport(projectRoot, report);
  const finalReport = reportPath === undefined ? report : { ...report, reportPath };
  printDoctor(finalReport, out);
  return finalReport.errorCount === 0 ? 0 : 1;
}

export function printDoctor(report: DoctorReport, out: OutputBuffer): void {
  if (report.findings.length === 0) {
    out.log("doctor: ok");
    return;
  }
  out.log(
    report.errorCount === 0
      ? "doctor: ok"
      : `doctor: ${report.errorCount} error(s), ${report.warningCount} warning(s)`,
  );
  for (const finding of report.findings) {
    const location = finding.path ? ` (${finding.path})` : "";
    out.log(`  ${finding.severity} ${finding.code}${location}: ${finding.message}`);
    if (finding.recommendedAction) {
      out.log(`    action: ${finding.recommendedAction}`);
    }
  }
  for (const repair of report.repairs ?? []) {
    out.log(`  repair ${repair.status} ${repair.kind} (${repair.path}): ${repair.message}`);
  }
  if (report.reportPath) {
    out.log(`  report: ${report.reportPath}`);
  }
}

function readProjectSafely(projectRoot: string): ProjectDocument | undefined {
  try {
    return readProjectDocument(projectRoot);
  } catch {
    return undefined;
  }
}

async function collectLiveDiagnostics(options: {
  readonly projectRoot: string;
  readonly project: ProjectDocument | undefined;
  readonly registry: Registry | undefined;
  readonly flags: GlobalFlags;
  readonly env: NodeJS.ProcessEnv;
}): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const model = configuredModel(options.project, options.flags);
  let providerResult: ProviderProbeResult;
  if (model === undefined) {
    providerResult = {
      provider: "",
      model: "",
      status: "model_unavailable",
      message: "No usable Project model is configured",
    };
  } else {
    const apiKeyName = secretNameForProvider(model.provider);
    providerResult = await probeProvider({
      provider: model.provider,
      model: model.id,
      apiKey: options.env[apiKeyName],
      env: Object.fromEntries(
        Object.entries(options.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
    });
  }
  if (providerResult.status !== "ok") {
    findings.push(providerFinding(providerResult));
  }

  if (options.project !== undefined && options.registry !== undefined) {
    findings.push(...await checkEnabledInterfaces({
      projectRoot: options.projectRoot,
      project: options.project,
      registry: options.registry,
      env: options.env,
    }));
  }
  return findings;
}

function configuredModel(
  project: ProjectDocument | undefined,
  flags: GlobalFlags,
): { provider: string; id: string } | undefined {
  const provider = flags.provider ?? project?.defaults?.model?.provider;
  const id = flags.model ?? project?.defaults?.model?.id;
  if (typeof provider !== "string" || provider.trim().length === 0 || typeof id !== "string" || id.trim().length === 0) {
    return undefined;
  }
  return { provider, id };
}

function providerFinding(result: ProviderProbeResult): DoctorFinding {
  const code = {
    ok: "provider_probe_ok",
    missing_credentials: "provider_missing_credentials",
    provider_rejection: "provider_rejected",
    network_failure: "provider_network_failure",
    model_unavailable: "model_unavailable",
  }[result.status];
  const route = result.provider.length > 0 && result.model.length > 0
    ? `${result.provider}/${result.model}`
    : "the configured Project model";
  return {
    severity: "warning",
    code,
    message: result.status === "ok"
      ? `Provider probe succeeded for ${route}`
      : `Provider probe for ${route} classified as ${result.status}${result.message ? `: ${redact(result.message)}` : ""}`,
    recommendedAction: result.status === "ok"
      ? "No repair is required; rerun the probe after changing provider or model settings."
      : providerAction(result.status),
    fixable: false,
  };
}

function providerAction(status: ProviderProbeResult["status"]): string {
  switch (status) {
    case "missing_credentials":
      return "Set the provider's deployment or environment credential without printing its value, then rerun vibekit doctor.";
    case "provider_rejection":
      return "Verify the credential, account access, endpoint, and model permissions with the provider, then rerun vibekit doctor.";
    case "network_failure":
      return "Check the provider endpoint, DNS, firewall, and proxy settings, then rerun vibekit doctor.";
    case "model_unavailable":
      return "Choose a model present in Pi's current catalog or update the Project model configuration explicitly.";
    case "ok":
      return "No repair is required; rerun the probe after changing provider or model settings.";
  }
}

async function checkEnabledInterfaces(options: {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly registry: Registry;
  readonly env: NodeJS.ProcessEnv;
}): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  let manifest;
  try {
    manifest = readInstalledManifest(options.projectRoot);
  } catch {
    return findings;
  }
  const bindings = options.project.interfaceBindings ?? {};
  for (const [name, binding] of Object.entries(bindings)) {
    if (!binding.enabled) continue;
    const record = manifest.modules.find((item) => item.id === binding.definition);
    if (record === undefined) continue;
    let loaded;
    try {
      loaded = resolveInstalledModule(record, options.registry);
    } catch {
      continue;
    }
    let factory;
    try {
      factory = await loadInterfaceFactory(binding.definition, undefined, options.projectRoot);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "interface_load_failed",
        message: `Enabled Interface ${name} could not be loaded: ${redact(error)}`,
        path: binding.definition,
        recommendedAction: "Install the recorded Interface runtime package or update the Interface from its recorded registry source, then rerun vibekit doctor.",
        fixable: false,
      });
      continue;
    }

    const config = diagnosticInterfaceConfig(options.projectRoot, options.project, name, binding.definition, binding.config);
    const services = diagnosticServices(options.env);
    let running: RunningInterface | undefined;
    try {
      running = await factory.create(config, services);
      if (isNetworkInterface(binding.definition)) {
        findings.push({
          severity: "warning",
          code: "interface_network_start_skipped",
          message: `Loaded enabled Interface ${name}; its external transport was not contacted during Doctor`,
          path: binding.definition,
          recommendedAction: "Start the Host after credentials and endpoint settings are confirmed, then verify the Interface health status.",
          fixable: false,
        });
      } else {
        await running.start();
        const health = await running.health();
        if (!health.ok) {
          findings.push({
            severity: "error",
            code: "interface_start_failed",
            message: `Enabled Interface ${name} loaded but did not report healthy local startup`,
            path: binding.definition,
            recommendedAction: "Fix the Interface's local configuration or runtime package, then rerun vibekit doctor.",
            fixable: false,
          });
        }
      }
    } catch (error) {
      findings.push({
        severity: "error",
        code: "interface_start_failed",
        message: `Enabled Interface ${name} failed local startup: ${redact(error)}`,
        path: binding.definition,
        recommendedAction: "Fix the Interface's local configuration or runtime package, then rerun vibekit doctor.",
        fixable: false,
      });
    } finally {
      await running?.stop().catch(() => undefined);
    }
  }
  return findings;
}

function diagnosticInterfaceConfig(
  projectRoot: string,
  project: ProjectDocument,
  bindingName: string,
  definition: string,
  configPath: string | undefined,
): Record<string, unknown> {
  const fragment = loadBindingConfig(projectRoot, configPath);
  const suffix = definition.split(":")[1] ?? "";
  return {
    ...fragment,
    projectRoot,
    interfaceBinding: bindingName,
    knownInterfaces: Object.keys(project.interfaceBindings ?? {}),
    pairingRequired: pairingRequired(project),
    inboundUntrusted: inboundIsUntrusted(project),
    ...(suffix === "terminal" ? { interactive: false } : {}),
    ...(suffix === "http" || suffix === "webhook" ? { port: 0 } : {}),
    ...(suffix === "schedule"
      ? { tickMs: 0, jobsPath: path.join(projectRoot, ".vibekit/runtime/diagnostics/doctor-schedule.json") }
      : {}),
  };
}

function diagnosticServices(env: NodeJS.ProcessEnv): InterfaceServices {
  return {
    async submit() {},
    async cancel() { return false; },
    async approve() {},
    resolveSecret(name: string) {
      const value = env[name];
      if (typeof value !== "string" || value.length === 0) throw new Error(`Missing secret ${name}`);
      return value;
    },
    log: { info() {}, warn() {}, error() {} },
  };
}

function isNetworkInterface(definition: string): boolean {
  return new Set(["interface:slack", "interface:telegram"]).has(definition);
}

function withRecommendedAction(finding: DoctorFinding): DoctorFinding {
  return {
    ...finding,
    recommendedAction: finding.recommendedAction ?? "Review this finding and apply the smallest safe repair before rerunning vibekit doctor.",
  };
}

function redact(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*([:=])\s*[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\b(?:sk|pk)-[A-Za-z0-9][A-Za-z0-9*_/-]{4,}/gi, "[redacted]")
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

function buildReleaseSnapshot(source: string, registry: Registry | undefined): DoctorReleaseSnapshot {
  const findings: DoctorFinding[] = [];
  const checkedPaths: string[] = [];
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageManifest = findExisting([
    path.join(here, "../package.json"),
    path.join(here, "../../package.json"),
  ]);
  const packageVersions: Record<string, string> = {};
  if (packageManifest !== undefined) {
    const product = readJson(packageManifest);
    if (typeof product?.version === "string") packageVersions.product = product.version;
    const workspaceRoot = path.resolve(path.dirname(packageManifest), "../..");
    const rootPackage = findExisting([path.join(workspaceRoot, "package.json")]);
    const root = rootPackage === undefined ? undefined : readJson(rootPackage);
    if (typeof root?.version === "string") packageVersions.root = root.version;
    const productPath = path.relative(workspaceRoot, packageManifest).replaceAll(path.sep, "/");
    checkedPaths.push(productPath);
    if (packageVersions.product !== undefined && packageVersions.root !== undefined && packageVersions.product !== packageVersions.root) {
      findings.push({
        severity: "error",
        code: "release_package_mismatch",
        message: `${product?.name ?? "The product artifact"} is ${packageVersions.product}, but the workspace release is ${packageVersions.root}`,
        path: productPath,
        fixable: false,
        recommendedAction: "Synchronize the workspace and single product version at the authorized release boundary, then rebuild the product.",
      });
    }
    checkBundledRegistryAndSchemas(
      workspaceRoot,
      path.dirname(packageManifest),
      source,
      registry,
      checkedPaths,
      findings,
    );
    checkBuiltinExports(workspaceRoot, here, checkedPaths, findings);
  }
  const piManifest = findPackageManifest("@earendil-works/pi-coding-agent", here);
  if (piManifest !== undefined) {
    const pi = readJson(piManifest);
    if (typeof pi?.version === "string") packageVersions["pi-sdk"] = pi.version;
    checkedPaths.push(path.relative(path.resolve(here, "../.."), piManifest).replaceAll(path.sep, "/"));
  }
  return { versions: packageVersions, checkedPaths, findings };
}

function checkBundledRegistryAndSchemas(
  workspaceRoot: string,
  packageRoot: string,
  source: string,
  registry: Registry | undefined,
  checkedPaths: string[],
  findings: DoctorFinding[],
): void {
  const bundled = findExisting([
    path.join(workspaceRoot, "packages/cli/registry/index.json"),
    path.join(workspaceRoot, "registry/index.json"),
    path.join(packageRoot, "registry/index.json"),
  ]);
  if (bundled !== undefined) {
    checkedPaths.push(path.relative(workspaceRoot, bundled).replaceAll(path.sep, "/"));
  } else if (source === "official") {
    findings.push({
      severity: "error",
      code: "bundled_registry_missing",
      message: "The official registry is not bundled with this runtime",
      path: "registry/index.json",
      fixable: false,
      recommendedAction: "Install or rebuild the matching product artifact with its official registry, then rerun vibekit doctor.",
    });
  }
  if (source === "official" && registry !== undefined && bundled !== undefined) {
    const selected = path.join(registry.root, "index.json");
    checkedPaths.push(path.relative(workspaceRoot, selected).replaceAll(path.sep, "/"));
    if (fs.existsSync(selected) && sha256File(selected) !== sha256File(bundled)) {
      findings.push({
        severity: "error",
        code: "bundled_registry_mismatch",
        message: "The installed/bundled registry index differs from the official registry source",
        path: "packages/cli/registry/index.json",
        fixable: false,
        recommendedAction: "Regenerate the official index and refresh CLI publish staging, then rebuild the product.",
      });
    }
  }
  const sourceSchemas = path.join(workspaceRoot, "schemas");
  const bundledSchemas = findExisting([
    path.join(workspaceRoot, "packages/cli/schemas"),
    path.join(packageRoot, "schemas"),
  ]);
  if (fs.existsSync(sourceSchemas) && bundledSchemas !== undefined) {
    for (const name of fs.readdirSync(sourceSchemas)) {
      if (!name.endsWith(".json")) continue;
      const sourcePath = path.join(sourceSchemas, name);
      const bundledPath = path.join(bundledSchemas, name);
      checkedPaths.push(path.relative(workspaceRoot, sourcePath).replaceAll(path.sep, "/"));
      checkedPaths.push(path.relative(workspaceRoot, bundledPath).replaceAll(path.sep, "/"));
      if (!fs.existsSync(bundledPath) || sha256File(sourcePath) !== sha256File(bundledPath)) {
        findings.push({
          severity: "error",
          code: "bundled_schema_mismatch",
          message: `Bundled schema ${name} differs from the source schema`,
          path: `packages/cli/schemas/${name}`,
          fixable: false,
        recommendedAction: "Refresh product publish staging from schemas/ and rebuild the product artifact.",
        });
      }
    }
  } else if (source === "official" && bundledSchemas === undefined) {
    findings.push({
      severity: "error",
      code: "bundled_schemas_missing",
      message: "The runtime does not contain bundled Core schemas",
      path: "schemas",
      fixable: false,
      recommendedAction: "Install or rebuild the matching product artifact with Core schemas, then rerun vibekit doctor.",
    });
  } else if (source === "official" && bundledSchemas !== undefined) {
    for (const name of ["project.schema.json", "module.schema.json", "installed.schema.json"]) {
      const bundledPath = path.join(bundledSchemas, name);
      checkedPaths.push(path.relative(workspaceRoot, bundledPath).replaceAll(path.sep, "/"));
      if (!fs.existsSync(bundledPath)) {
        findings.push({
          severity: "error",
          code: "bundled_schema_missing",
          message: `Bundled Core schema ${name} is missing`,
          path: path.relative(workspaceRoot, bundledPath).replaceAll(path.sep, "/"),
          fixable: false,
          recommendedAction: "Install or rebuild the matching product artifact with the complete Core schema set, then rerun vibekit doctor.",
        });
      }
    }
  }
}

function checkBuiltinExports(
  workspaceRoot: string,
  here: string,
  checkedPaths: string[],
  findings: DoctorFinding[],
): void {
  const candidates = [
    path.join(workspaceRoot, "packages/cli/dist/internal/pi/index.js"),
    path.join(workspaceRoot, "packages/cli/src/internal/pi/index.ts"),
    path.join(here, "../internal/pi/index.js"),
    path.join(here, "../internal/pi/index.ts"),
  ];
  const entry = findExisting(candidates);
  if (entry === undefined) {
    findings.push({
      severity: "error",
      code: "builtin_exports_unavailable",
      message: "The bundled Pi adapter entrypoint could not be found",
      path: "packages/cli/internal/pi",
      fixable: false,
        recommendedAction: "Rebuild the single product artifact and rerun vibekit doctor.",
    });
    return;
  }
  checkedPaths.push(path.relative(workspaceRoot, entry).replaceAll(path.sep, "/"));
  const text = fs.readFileSync(entry, "utf8");
  for (const name of ["createGuardedBuiltinTools", "createAgentDelegateTool"]) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) {
      findings.push({
        severity: "error",
        code: "builtin_export_missing",
        message: `Pi adapter does not expose built-in export ${name}`,
        path: path.relative(workspaceRoot, entry).replaceAll(path.sep, "/"),
        fixable: false,
        recommendedAction: "Rebuild the single product artifact and rerun vibekit doctor.",
      });
    }
  }
}

function readJson(filePath: string): Record<string, any> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, any>
      : undefined;
  } catch {
    return undefined;
  }
}

function findExisting(paths: readonly string[]): string | undefined {
  return paths.find((candidate) => fs.existsSync(candidate));
}

function findPackageManifest(name: string, here: string): string | undefined {
  const short = name.replace(/^@useagentsio\//, "");
  return findExisting([
    path.join(here, "../node_modules", ...name.split("/"), "package.json"),
    path.join(here, "../../packages", short, "package.json"),
    path.join(here, "../../node_modules/.pnpm", ...name.split("/"), "package.json"),
  ]);
}
