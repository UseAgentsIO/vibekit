import fs from "node:fs";
import path from "node:path";

import {
  listRegistryModules,
  readInstalledManifest,
  readProjectDocument,
  sha256File,
  type InstalledModuleDocument,
} from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";

export function runList(flags: GlobalFlags, out: OutputBuffer): number {
  const projectRoot = resolveProjectDir(flags.dir);
  const { registry, source } = resolveRegistrySelection(flags.registry);
  const available = listRegistryModules(registry);
  let installed: readonly InstalledModuleDocument[] = [];
  let configuredIds = new Set<string>();
  if (fs.existsSync(path.join(projectRoot, ".vibekit/installed.json"))) {
    installed = readInstalledManifest(projectRoot).modules;
  }
  if (fs.existsSync(path.join(projectRoot, ".vibekit/project.yaml"))) {
    const project = readProjectDocument(projectRoot);
    configuredIds = new Set([
      ...project.policies,
      ...project.verification.default,
      ...Object.values(project.agentBindings).map((binding) => binding.definition),
      project.state.backend,
    ]);
  }

  const rows = new Map<string, ListRow>();
  for (const entry of available) {
    rows.set(`${entry.id}@${entry.version}`, {
      id: entry.id,
      version: entry.version,
      source,
      installed: "no",
      configured: "no",
      available: "yes",
      verified: "no",
    });
  }
  for (const module of installed) {
    const key = `${module.id}@${module.version}`;
    const current = rows.get(key) ?? {
      id: module.id,
      version: module.version,
      source: module.registrySource,
      installed: "yes",
      configured: "no",
      available: "no",
      verified: "no",
    };
    current.installed = "yes";
    current.source = module.registrySource;
    current.configured = isConfigured(module, configuredIds, projectRoot) ? "yes" : "no";
    current.verified = isVerified(module, projectRoot) ? "yes" : "no";
    rows.set(key, current);
  }

  out.log(
    pad("ID", 32) +
      pad("VERSION", 10) +
      pad("SOURCE", 12) +
      pad("INSTALLED", 11) +
      pad("CONFIGURED", 12) +
      pad("AVAILABLE", 11) +
      "VERIFIED",
  );
  const sorted = [...rows.values()].sort((left, right) => left.id.localeCompare(right.id));
  for (const row of sorted) {
    out.log(
      pad(row.id, 32) +
        pad(row.version, 10) +
        pad(row.source, 12) +
        pad(row.installed, 11) +
        pad(row.configured, 12) +
        pad(row.available, 11) +
        row.verified,
    );
  }
  return 0;
}

interface ListRow {
  id: string;
  version: string;
  source: string;
  installed: string;
  configured: string;
  available: string;
  verified: string;
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

function isConfigured(
  module: InstalledModuleDocument,
  configuredIds: Set<string>,
  projectRoot: string,
): boolean {
  if (configuredIds.has(module.id)) {
    return true;
  }
  return module.configurationPaths.every((relative) =>
    fs.existsSync(path.join(projectRoot, relative)),
  ) && module.configurationPaths.length > 0;
}

function isVerified(module: InstalledModuleDocument, projectRoot: string): boolean {
  if (module.files.length === 0) {
    return false;
  }
  return module.files.every((file) => {
    const abs = path.join(projectRoot, file.path);
    return fs.existsSync(abs) && sha256File(abs) === file.hash;
  });
}
