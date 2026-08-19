import fs from "node:fs";
import path from "node:path";

import {
  defaultRegistryRoot,
  getInstalledModule,
  loadRegistry,
  parseModuleId,
  readInstalledManifest,
  resolveModule,
  type ModuleId,
  type ModuleRuntime,
} from "@useagentsio/core";
import type { PiCustomTool } from "@useagentsio/pi";
import { parse as parseYaml } from "yaml";

import { exportedValue, importProjectModule } from "./project-import.js";

export interface BoundCustomTool extends PiCustomTool {
  readonly moduleId: ModuleId;
}

export interface ToolBindContext {
  readonly projectRoot: string;
  readonly resolveSecret: (name: string) => string;
  readonly grantedCapabilities?: readonly string[];
  readonly scheduledRun?: boolean;
}

export interface ToolFactory {
  (ctx: ToolBindContext & { config: Record<string, unknown> }):
    | PiCustomTool
    | readonly PiCustomTool[]
    | Promise<PiCustomTool | readonly PiCustomTool[]>;
}

/**
 * Attach Pi custom tools from installed `family: tool` modules only.
 * Never imports a tool package unless that module is installed.
 */
export async function bindInstalledTools(
  projectRoot: string,
  context: Omit<ToolBindContext, "projectRoot">,
): Promise<readonly BoundCustomTool[]> {
  let manifest;
  try {
    manifest = readInstalledManifest(projectRoot);
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
    const runtime = runtimeOf(record.id, record.version, projectRoot);
    if (runtime?.package === undefined || runtime.export === undefined) {
      continue;
    }
    if (runtime.kind === "config-only" || runtime.available === false) {
      continue;
    }
    if (getInstalledModule(manifest, record.id) === undefined) {
      continue;
    }
    const factory = await loadToolFactory(projectRoot, runtime.package, runtime.export);
    if (factory === undefined) {
      continue;
    }
    const config = loadToolConfig(projectRoot, record.id);
    const created = await factory({
      projectRoot,
      config,
      resolveSecret: context.resolveSecret,
      grantedCapabilities: context.grantedCapabilities,
      scheduledRun: context.scheduledRun,
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

export async function loadToolFactory(
  projectRoot: string,
  packageName: string,
  exportName: string,
): Promise<ToolFactory | undefined> {
  const mod = await importProjectModule(projectRoot, packageName);
  const exported = exportedValue(mod, exportName);
  if (typeof exported === "function") {
    return exported as ToolFactory;
  }
  return undefined;
}

function runtimeOf(
  id: ModuleId,
  version: string,
  projectRoot: string,
): ModuleRuntime | undefined {
  try {
    const loaded = resolveModule(loadRegistry(defaultRegistryRoot()), id, version);
    if (loaded.document.type === "agent") {
      return undefined;
    }
    return loaded.document.runtime;
  } catch {
    try {
      const loaded = resolveModule(loadRegistry(defaultRegistryRoot()), id);
      if (loaded.document.type === "agent") {
        return undefined;
      }
      return loaded.document.runtime;
    } catch {
      void projectRoot;
      return undefined;
    }
  }
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

function isPiCustomTool(value: unknown): value is PiCustomTool {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PiCustomTool).name === "string" &&
    typeof (value as PiCustomTool).execute === "function"
  );
}
