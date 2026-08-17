import { runDoctor, type DoctorReport } from "@vibekit/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";

export function runDoctorCommand(flags: GlobalFlags, out: OutputBuffer): number {
  const projectRoot = resolveProjectDir(flags.dir);
  let registry;
  try {
    registry = resolveRegistry(flags.registry);
  } catch {
    registry = undefined;
  }
  const report = runDoctor({ projectRoot, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

export function printDoctor(report: DoctorReport, out: OutputBuffer): void {
  if (report.findings.length === 0) {
    out.log("doctor: ok");
    return;
  }
  out.log(`doctor: ${report.errorCount} error(s), ${report.warningCount} warning(s)`);
  for (const finding of report.findings) {
    const location = finding.path ? ` (${finding.path})` : "";
    out.log(`  ${finding.severity} ${finding.code}${location}: ${finding.message}`);
  }
}
