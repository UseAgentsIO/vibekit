import { isatty } from "node:tty";

import {
  VibeKitError,
  applyUpdates,
  planUpdates,
  readInstalledManifest,
  readProjectDocument,
  runDoctor,
} from "../internal/core/index.js";
import type { ModuleId, UpdateSelector } from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";
import { parseModuleSelector } from "./diff.js";
import { printDoctor } from "./doctor.js";

export function runUpdate(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const updates = parseUpdateSelectors(positionals);
  const projectRoot = resolveProjectDir(flags.dir);
  const { registry, source } = resolveRegistrySelection(flags.registry);
  const project = readProjectDocument(projectRoot);
  const manifest = readInstalledManifest(projectRoot);

  const plan = planUpdates({
    projectRoot,
    registry,
    updates,
    project,
    manifest,
    registrySource: source,
  });

  for (const update of plan.updates) {
    out.log(`Update ${update.id} ${update.fromVersion} → ${update.toVersion}`);
    out.log("Files:");
    if (update.files.length === 0) {
      out.log("  (none)");
    }
    for (const file of update.files) {
      out.log(`  ${file.path} [${file.decision}]`);
    }

    if (update.dependencyPlan && update.dependencyPlan.modules.length > 0) {
      out.log("New dependencies:");
      for (const module of update.dependencyPlan.modules) {
        out.log(`  ${module.id}@${module.version}`);
      }
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
      message: `Update stopped; conflicting files: ${plan.conflicts.map((file) => file.path).join(", ")}`,
      details: {
        files: plan.conflicts.map((file) => file.path),
      },
    });
  }

  if (plan.alreadyCurrent) {
    for (const update of plan.updates) {
      out.log(`Already current: ${update.id}@${update.toVersion}`);
    }
    return 0;
  }

  if (!flags.yes && !isatty(process.stdin.fd)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "confirmation_required",
      message: "Non-interactive update requires --yes",
    });
  }

  const result = applyUpdates({ projectRoot, plan });
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
  for (const update of result.plan.updates.filter((item) => !item.alreadyCurrent)) {
    out.log(`Updated ${update.id} to ${update.toVersion}`);
  }

  const report = runDoctor({ projectRoot, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function parseUpdateSelectors(positionals: readonly string[]): UpdateSelector[] {
  if (positionals.length > 1 && positionals[0]?.includes(":")) {
    if (positionals.length === 2 && !positionals[1]?.includes(":")) {
      const single = parseModuleSelector(positionals, "update");
      return [{ id: single.id, version: single.version }];
    }
    return positionals.map((raw): UpdateSelector => {
      const parsed = parseModuleSelector([raw], "update");
      return { id: parsed.id as ModuleId, version: parsed.version };
    });
  }
  const single = parseModuleSelector(positionals, "update");
  return [{ id: single.id, version: single.version }];
}
