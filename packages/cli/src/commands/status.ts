import fs from "node:fs";
import path from "node:path";

import { readProjectDocument } from "../internal/core/index.js";
import { readDeploymentSecrets } from "../internal/host/index.js";
import { secretNameForProvider } from "../internal/pi/index.js";

import type { GlobalFlags } from "../args.js";
import { inspectProject } from "../host-control.js";
import { providerDisplayName } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";
import { gatewayIsRunning, readGatewayPort } from "../gateway/service.js";

interface PersistedDoctorReport {
  readonly findings?: readonly { readonly severity?: string }[];
}

export async function runStatus(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  const project = readProjectDocument(projectRoot);
  const snapshot = await inspectProject(project.id, projectRoot, "");
  const model = project.defaults?.model;
  const gatewayPort = safeGatewayPort();
  const gatewayRunning = gatewayPort !== undefined && await gatewayIsRunning(gatewayPort);
  const bindings = Object.entries(project.interfaceBindings ?? {}).filter(([, binding]) => binding.enabled);

  out.log("Installation: ready");
  out.log(`Project: ${project.name}`);
  out.log(`Instructions: ${project.defaultAgent ?? "not selected"}`);
  if (model === undefined) {
    out.log("Model: not selected");
    out.log("Model authentication: needs setup");
  } else {
    out.log(`Model: ${model.id} via ${providerDisplayName(model.provider)}`);
    out.log(`Model authentication: ${modelAuthStatus(project.id, model.provider)}`);
  }

  const productState = snapshot.state === "running"
    ? "ready"
    : snapshot.state === "unhealthy"
      ? "needs attention"
      : snapshot.state === "missing" || snapshot.state === "invalid"
        ? "unavailable"
        : "stopped";
  out.log(`VibeKit: ${productState}`);
  // Keep the established diagnostic label for operators and scripts while the
  // product-level line above remains the normal user-facing answer.
  out.log(snapshot.state === "running" ? "Host: ready" : snapshot.state === "unhealthy" ? "Host: not ready" : "Host: stopped");

  out.log(`Gateway: ${gatewayRunning ? "available" : bindings.some(([, binding]) => binding.definition !== "interface:terminal") ? "not available" : "available when needed"}`);
  if (bindings.length === 0) {
    out.log("Connections: none configured");
  } else {
    out.log("Connections:");
    for (const [name, binding] of bindings) {
      const health = snapshot.interfaces[name];
      const state = snapshot.state !== "running"
        ? "configured"
        : health?.connected === true
          ? "connected"
          : health?.detail ?? "not connected";
      out.log(`  ${connectionLabel(name, binding.definition)}: ${state}`);
    }
  }

  const doctor = readDoctorSummary(projectRoot);
  out.log(`Doctor: ${doctor}`);

  if (flags.verbose) {
    out.log(`Project ID: ${project.id}`);
    out.log(`Project path: ${projectRoot}`);
    out.log(`Host process: ${snapshot.pid ?? "none"}`);
    out.log(`Gateway port: ${gatewayPort ?? "invalid"}`);
    for (const [name, binding] of bindings) {
      out.log(`Connection ${name}: ${binding.definition}`);
    }
  }
  return 0;
}

function safeGatewayPort(): number | undefined {
  try {
    return readGatewayPort();
  } catch {
    return undefined;
  }
}

function modelAuthStatus(projectId: string, provider: string): string {
  const secret = secretNameForProvider(provider);
  const stored = readDeploymentSecrets(projectId)[secret];
  return typeof stored === "string" && stored.length > 0
    || typeof process.env[secret] === "string" && process.env[secret]!.length > 0
    ? "configured"
    : "needs attention";
}

function readDoctorSummary(projectRoot: string): string {
  const file = path.join(projectRoot, ".vibekit", "runtime", "diagnostics", "doctor.json");
  if (!fs.existsSync(file)) return "not run (run vibekit doctor)";
  try {
    const report = JSON.parse(fs.readFileSync(file, "utf8")) as PersistedDoctorReport;
    const errors = report.findings?.filter((finding) => finding.severity === "error").length ?? 0;
    const warnings = report.findings?.filter((finding) => finding.severity === "warning").length ?? 0;
    if (errors === 0 && warnings === 0) return "ok";
    const total = errors + warnings;
    return `${total} issue${total === 1 ? "" : "s"} found (run vibekit doctor)`;
  } catch {
    return "report unreadable (run vibekit doctor)";
  }
}

function connectionLabel(name: string, definition: string): string {
  const raw = name.length > 0 ? name : definition.split(":")[1] ?? definition;
  const withoutSuffix = raw.replace(/-main$/i, "");
  return withoutSuffix.replace(/(^|[-_])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix === "-" || prefix === "_" ? " " : prefix}${letter.toUpperCase()}`);
}
