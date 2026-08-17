import { isatty } from "node:tty";

import {
  VibeKitError,
  applyRemove,
  planRemove,
  readInstalledManifest,
  readProjectDocument,
  runDoctor,
} from "@vibekit/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";
import { parseModuleSelector } from "./diff.js";
import { printDoctor } from "./doctor.js";

export function runRemove(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const { id } = parseModuleSelector(positionals, "remove");
  const projectRoot = resolveProjectDir(flags.dir);
  const registry = resolveRegistry(flags.registry);
  const project = readProjectDocument(projectRoot);
  const manifest = readInstalledManifest(projectRoot);

  const plan = planRemove({
    projectRoot,
    registry,
    id,
    project,
    manifest,
  });

  out.log(`Remove ${plan.id}`);
  out.log("Modules:");
  for (const moduleId of plan.modulesToRemove) {
    out.log(`  ${moduleId}`);
  }
  if (plan.keptShared.length > 0) {
    out.log("Kept (still used):");
    for (const kept of plan.keptShared) {
      out.log(`  ${kept.id} (${kept.reason})`);
    }
  }
  if (plan.filesToRemove.length > 0) {
    out.log("Files:");
    for (const file of plan.filesToRemove) {
      out.log(`  ${file}`);
    }
  }

  if (plan.modified.length > 0) {
    out.log("Modified files stop removal:");
    for (const file of plan.modified) {
      out.log(`  ${file}`);
    }
    throw new VibeKitError({
      category: "conflict",
      code: "remove_modified",
      message: `Removal of ${plan.id} stopped; modified files: ${plan.modified.join(", ")}`,
      details: { id: plan.id, files: plan.modified },
    });
  }

  if (!flags.yes && !isatty(process.stdin.fd)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "confirmation_required",
      message: "Non-interactive remove requires --yes",
    });
  }

  const result = applyRemove({ projectRoot, plan });
  out.log("Removed modules:");
  for (const moduleId of result.removed) {
    out.log(`  ${moduleId}`);
  }
  if (result.deleted.length > 0) {
    out.log("Deleted files:");
    for (const file of result.deleted) {
      out.log(`  ${file}`);
    }
  }
  if (result.kept.length > 0) {
    out.log("Shared dependencies kept:");
    for (const moduleId of result.kept) {
      out.log(`  ${moduleId}`);
    }
  }

  const report = runDoctor({ projectRoot, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}
