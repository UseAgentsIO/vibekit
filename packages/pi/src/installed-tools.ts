import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseModuleId,
  readInstalledManifest,
  resolveInstalledModule,
  type ModuleId,
} from "@useagentsio/core";
import { parse as parseYaml } from "yaml";

import { fail } from "./fail.js";
import type { PiCustomTool } from "./session.js";

export interface BoundCustomTool extends PiCustomTool {
  readonly moduleId: ModuleId;
}

export interface BindInstalledToolsInput {
  readonly projectRoot: string;
  readonly resolveSecret: (name: string) => string;
  readonly grantedCapabilities?: readonly string[];
  readonly scheduledRun?: boolean;
  readonly allowedModuleIds?: readonly ModuleId[];
}

export async function bindInstalledProjectTools(
  input: BindInstalledToolsInput,
): Promise<readonly BoundCustomTool[]> {
  let manifest;
  try {
    manifest = readInstalledManifest(input.projectRoot);
  } catch {
    return [];
  }

  const bound: BoundCustomTool[] = [];
  for (const record of manifest.modules) {
    let parsed;
    try {
      parsed = parseModuleId(record.id);
    } catch {
      continue;
    }
    if (parsed.type !== "tool") {
      continue;
    }
    if (input.allowedModuleIds !== undefined && !input.allowedModuleIds.includes(record.id)) {
      continue;
    }
    const loaded = resolveInstalledModule(record);
    if (loaded.document.type === "agent") {
      continue;
    }
    const runtime = loaded.document.runtime;
    if (
      runtime === undefined ||
      runtime.available === false ||
      runtime.kind === "config-only" ||
      runtime.kind === "pi-builtin"
    ) {
      continue;
    }
    if (runtime.package === undefined || runtime.export === undefined) {
      throw fail(
        "unavailable",
        "runtime_package_missing",
        `${record.id} is executable but missing runtime.package/export`,
        { id: record.id },
      );
    }
    const factory = await loadToolFactory(input.projectRoot, runtime.package, runtime.export);
    if (factory === undefined) {
      throw fail(
        "unavailable",
        "tool_factory_missing",
        `Unable to load ${record.id} from ${runtime.package} (${runtime.export})`,
        { id: record.id, package: runtime.package, export: runtime.export },
      );
    }
    const config = loadToolConfig(input.projectRoot, record.id);
    const created = await factory({
      projectRoot: input.projectRoot,
      config,
      resolveSecret: input.resolveSecret,
      grantedCapabilities: input.grantedCapabilities,
      scheduledRun: input.scheduledRun,
    });
    const tools = Array.isArray(created) ? created : [created];
    for (const tool of tools) {
      if (!isPiCustomTool(tool)) {
        continue;
      }
      bound.push({ ...tool, moduleId: record.id });
    }
  }
  return bound;
}

async function loadToolFactory(
  projectRoot: string,
  packageName: string,
  exportName: string,
): Promise<
  | ((ctx: {
      projectRoot: string;
      config: Record<string, unknown>;
      resolveSecret: (name: string) => string;
      grantedCapabilities?: readonly string[];
      scheduledRun?: boolean;
    }) => PiCustomTool | readonly PiCustomTool[] | Promise<PiCustomTool | readonly PiCustomTool[]>)
  | undefined
> {
  const resolved = resolveProjectModule(projectRoot, packageName);
  let mod: Record<string, unknown> | undefined;
  try {
    mod = (await import(resolved ?? packageName)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const exported = mod[exportName];
  if (typeof exported === "function") {
    return exported as never;
  }
  return undefined;
}

function loadToolConfig(projectRoot: string, id: ModuleId): Record<string, unknown> {
  const name = parseModuleId(id).name;
  const candidates = [
    path.join(projectRoot, ".vibekit", "config", "tools", `${name}.yaml`),
    path.join(projectRoot, ".vibekit", "components", "tools", `${name}.yaml`),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const parsed = parseYaml(fs.readFileSync(filePath, "utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function resolveProjectModule(projectRoot: string, specifier: string): string | undefined {
  const roots = [
    path.join(projectRoot, "package.json"),
    path.join(projectRoot, "node_modules", specifier, "package.json"),
  ];
  for (const from of roots) {
    try {
      const resolved = createRequire(from).resolve(specifier);
      return pathToFileURL(resolved).href;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isPiCustomTool(value: unknown): value is PiCustomTool {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PiCustomTool).name === "string" &&
    typeof (value as PiCustomTool).execute === "function"
  );
}
