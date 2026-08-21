import {
  VibeKitError,
  diffInstalledModule,
  formatModuleId,
  isModuleType,
  parseModuleId,
  readInstalledManifest,
  type ModuleId,
} from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";

export function runDiff(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const { id } = parseModuleSelector(positionals, "diff");
  const projectRoot = resolveProjectDir(flags.dir);
  const registry = resolveRegistry(flags.registry);
  const manifest = readInstalledManifest(projectRoot);
  const diff = diffInstalledModule({
    projectRoot,
    registry,
    id,
    manifest,
  });

  out.log(diff.id);
  out.log(`installed: ${diff.installedVersion}`);
  out.log(
    `newest compatible: ${diff.newestCompatibleVersion ?? "(none)"}`,
  );
  if (diff.files.length === 0) {
    out.log("No owned files.");
    return 0;
  }

  for (const file of diff.files) {
    out.log(`${file.path} [${file.ownership}]`);
    out.log(`  status: ${file.status}`);
    if (file.localChanged) {
      out.log("  local: changed");
    }
    if (file.upstreamChanged) {
      out.log("  upstream: changed");
    }
    if (file.unifiedDiff) {
      for (const line of file.unifiedDiff.split("\n")) {
        out.log(`  ${line}`);
      }
    }
  }

  if (diff.localChanged) {
    out.log("Local edits detected.");
  } else if (!diff.upstreamAvailable) {
    out.log("No local edits. Installed version matches the current files.");
  }
  return 0;
}

export function parseModuleSelector(
  positionals: readonly string[],
  command: string,
): { id: ModuleId; version?: string } {
  if (positionals.length === 0) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "cli_args_invalid",
      message: `Missing <module>.\n\nSee \`vibekit ${command} --help\`.`,
    });
  }

  if (positionals.length === 1 || (positionals.length >= 2 && positionals[0]?.includes(":"))) {
    const raw = positionals[0] ?? "";
    const extraVersion = positionals.length >= 2 && positionals[0]?.includes(":")
      ? positionals[1]
      : undefined;
    const at = raw.lastIndexOf("@");
    if (at > 0 && extraVersion === undefined) {
      const id = raw.slice(0, at);
      parseModuleId(id);
      return { id: id as ModuleId, version: raw.slice(at + 1) };
    }
    parseModuleId(raw);
    return { id: raw as ModuleId, version: extraVersion };
  }

  const typeName = positionals[0];
  const name = positionals[1];
  if (typeName && name && isModuleType(typeName)) {
    return {
      id: formatModuleId(typeName, name),
      version: positionals[2],
    };
  }

  throw new VibeKitError({
    category: "invalid_input",
    code: "cli_args_invalid",
    message: `Usage: vibekit ${command} <type:name>`,
  });
}
