import { isatty } from "node:tty";

import {
  VibeKitError,
  applyUpdate,
  planUpdate,
  readInstalledManifest,
  readProjectDocument,
  runDoctor,
} from "@vibekit/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";
import { parseModuleSelector } from "./diff.js";
import { printDoctor } from "./doctor.js";

export function runUpdate(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const { id, version } = parseModuleSelector(positionals, "update");
  const projectRoot = resolveProjectDir(flags.dir);
  const registry = resolveRegistry(flags.registry);
  const project = readProjectDocument(projectRoot);
  const manifest = readInstalledManifest(projectRoot);

  const plan = planUpdate({
    projectRoot,
    registry,
    id,
    version,
    project,
    manifest,
    registrySource: "official",
  });

  out.log(`Update ${plan.id} ${plan.fromVersion} → ${plan.toVersion}`);
  out.log("Files:");
  if (plan.files.length === 0) {
    out.log("  (none)");
  }
  for (const file of plan.files) {
    out.log(`  ${file.path} [${file.decision}]`);
  }

  if (plan.dependencyPlan && plan.dependencyPlan.modules.length > 0) {
    out.log("New dependencies:");
    for (const module of plan.dependencyPlan.modules) {
      out.log(`  ${module.id}@${module.version}`);
    }
  }

  if (plan.conflicts.length > 0) {
    out.log("Conflicts (update stopped):");
    for (const file of plan.conflicts) {
      out.log(`  ${file.path} (local and upstream both changed)`);
    }
    throw new VibeKitError({
      category: "conflict",
      code: "update_conflict",
      message: `Update of ${plan.id} stopped; conflicting files: ${plan.conflicts.map((file) => file.path).join(", ")}`,
      details: {
        id: plan.id,
        files: plan.conflicts.map((file) => file.path),
      },
    });
  }

  if (plan.alreadyCurrent) {
    out.log(`Already current: ${plan.id}@${plan.toVersion}`);
    return 0;
  }

  if (!flags.yes && !isatty(process.stdin.fd)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "confirmation_required",
      message: "Non-interactive update requires --yes",
    });
  }

  const result = applyUpdate({ projectRoot, plan });
  if (result.created.length > 0) {
    out.log("Created:");
    for (const file of result.created) {
      out.log(`  ${file}`);
    }
  }
  if (result.changed.length > 0) {
    out.log("Changed:");
    for (const file of result.changed) {
      out.log(`  ${file}`);
    }
  }
  if (result.removed.length > 0) {
    out.log("Removed:");
    for (const file of result.removed) {
      out.log(`  ${file}`);
    }
  }
  out.log(`Updated ${result.plan.id} to ${result.toVersion}`);

  const report = runDoctor({ projectRoot, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}
