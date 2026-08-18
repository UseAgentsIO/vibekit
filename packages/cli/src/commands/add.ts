import { isatty } from "node:tty";

import {
  VibeKitError,
  applyInstall,
  formatModuleId,
  isModuleType,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  runDoctor,
  type ModuleType,
  type PlannedPermission,
} from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";
import { printDoctor } from "./doctor.js";

export function runAdd(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const typeName = positionals[0];
  const name = positionals[1];
  if (!typeName || !name) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "cli_args_invalid",
      message: "Missing <type> and <name>.\n\nSee `vibekit add --help`.",
    });
  }
  if (!isModuleType(typeName)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_type_invalid",
      message: `Unknown module type "${typeName}"`,
    });
  }

  if (!flags.yes && !isatty(process.stdin.fd)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "confirmation_required",
      message: "Non-interactive add requires --yes",
    });
  }

  const projectRoot = resolveProjectDir(flags.dir);
  const registry = resolveRegistry(flags.registry);
  const project = readProjectDocument(projectRoot);
  const manifest = readInstalledManifest(projectRoot);
  const id = formatModuleId(typeName as ModuleType, name);

  if (manifest.modules.some((module) => module.id === id)) {
    throw new VibeKitError({
      category: "conflict",
      code: "module_already_installed",
      message: `${id} is already installed`,
    });
  }

  const plan = planInstall({
    projectRoot,
    registry,
    roots: [id],
    project,
    manifest,
    registrySource: "official",
  });

  out.log(`Plan for ${id}`);
  out.log("Modules to install:");
  for (const module of plan.modules) {
    out.log(`  ${module.id}@${module.version}`);
  }
  if (plan.recommended.length > 0) {
    out.log("Recommended (not installed):");
    for (const recommended of plan.recommended) {
      out.log(`  ${recommended}`);
    }
  }
  if (plan.optional.length > 0) {
    out.log("Optional (not installed):");
    for (const optional of plan.optional) {
      out.log(`  ${optional}`);
    }
  }

  out.log("Requested permissions:");
  printPermissions(plan.permissions, out);
  if (plan.secrets.length > 0) {
    out.log("Secret references (values are not stored):");
    for (const secret of plan.secrets) {
      out.log(`  ${secret.name} (${secret.source}${secret.required ? ", required" : ""})`);
    }
  }
  out.log("Files:");
  for (const file of plan.files) {
    out.log(`  ${file.targetRel} [${file.ownership}] <- ${file.moduleId}`);
  }

  const result = applyInstall({ projectRoot, plan });
  out.log("Installed:");
  for (const file of result.created) {
    out.log(`  ${file}`);
  }
  if (result.changed.length > 0) {
    out.log("Changed:");
    for (const file of result.changed) {
      out.log(`  ${file}`);
    }
  }

  const report = runDoctor({ projectRoot, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function printPermissions(permissions: readonly PlannedPermission[], out: OutputBuffer): void {
  if (permissions.length === 0) {
    out.log("  (none)");
    return;
  }
  for (const entry of permissions) {
    out.log(`  ${entry.moduleId}`);
    if (entry.grants) {
      for (const grant of entry.grants.allow) {
        const scope = formatScope(grant.scope);
        out.log(`    allow ${grant.capability}${scope}`);
      }
      for (const grant of entry.grants.deny) {
        out.log(`    deny ${grant.capability}`);
      }
      continue;
    }
    if (entry.requests.length === 0) {
      out.log("    (none)");
      continue;
    }
    for (const request of entry.requests) {
      out.log(`    ${request.capability}`);
    }
  }
}

function formatScope(scope: { paths?: readonly string[]; commands?: readonly string[] } | undefined): string {
  if (!scope) {
    return "";
  }
  const parts: string[] = [];
  if (scope.paths && scope.paths.length > 0) {
    parts.push(`paths: ${scope.paths.join(", ")}`);
  }
  if (scope.commands && scope.commands.length > 0) {
    parts.push(`commands: ${scope.commands.join(", ")}`);
  }
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}
