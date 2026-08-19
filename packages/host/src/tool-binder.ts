import fs from "node:fs";
import path from "node:path";

import {
  authorizeInvocation,
  invocationFromToolCall,
  parseModuleId,
  readInstalledManifest,
  type ApprovalDocument,
  type EffectiveAuthority,
  type ModuleId,
  type ProjectDocument,
  type TaskDocument,
} from "@useagentsio/core";
import type { PiCustomTool } from "@useagentsio/pi";
import { parse as parseYaml } from "yaml";

import { hostError } from "./errors.js";
import { exportedValue, importProjectModule } from "./project-import.js";
import { resolveExecutableRuntime } from "./runtime-loader.js";

export interface BoundCustomTool extends PiCustomTool {
  readonly moduleId: ModuleId;
}

export interface ToolBindContext {
  readonly projectRoot: string;
  readonly resolveSecret: (name: string) => string;
  readonly grantedCapabilities?: readonly string[];
  readonly scheduledRun?: boolean;
  readonly allowedModuleIds?: readonly ModuleId[];
  readonly authority?: EffectiveAuthority;
  readonly project?: ProjectDocument;
  readonly task?: TaskDocument;
  readonly approvals?: readonly ApprovalDocument[] | (() => readonly ApprovalDocument[]);
  readonly now?: Date | (() => Date);
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
    if (
      context.allowedModuleIds !== undefined &&
      !context.allowedModuleIds.includes(record.id)
    ) {
      continue;
    }
    const executable = resolveExecutableRuntime(record, {
      expectedType: "tool",
      executableKinds: ["pi-extension", "package"],
    });
    if (executable === undefined) {
      continue;
    }
    const factory = await loadToolFactory(projectRoot, executable.package, executable.export);
    if (factory === undefined) {
      throw hostError(
        "unavailable",
        "tool_factory_missing",
        `Unable to load ${record.id} from ${executable.package} (${executable.export})`,
        {
          id: record.id,
          package: executable.package,
          export: executable.export,
          registrySource: record.registrySource,
        },
      );
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
      bound.push(
        wrapToolExecution({ ...tool, moduleId: record.id }, {
          allowedModuleIds: context.allowedModuleIds,
          authority: context.authority,
          project: context.project,
          task: context.task,
          approvals: context.approvals,
          now: context.now,
        }),
      );
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

function wrapToolExecution(
  tool: BoundCustomTool,
  context: {
    readonly allowedModuleIds: readonly ModuleId[] | undefined;
    readonly authority?: EffectiveAuthority;
    readonly project?: ProjectDocument;
    readonly task?: TaskDocument;
    readonly approvals?: readonly ApprovalDocument[] | (() => readonly ApprovalDocument[]);
    readonly now?: Date | (() => Date);
  },
): BoundCustomTool {
  const inner = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (args: unknown) => {
      if (context.allowedModuleIds !== undefined && !context.allowedModuleIds.includes(tool.moduleId)) {
        throw hostError(
          "permission_denied",
          "tool_not_granted",
          `${tool.moduleId} is not in the effective Tool grant set`,
          { moduleId: tool.moduleId, name: tool.name },
        );
      }
      if (context.authority !== undefined && context.project !== undefined && context.task !== undefined) {
        const invocation = invocationFromToolCall({
          toolName: tool.name,
          args,
          authority: context.authority,
          moduleId: tool.moduleId,
        });
        const approvals = typeof context.approvals === "function" ? context.approvals() : context.approvals;
        const now = typeof context.now === "function" ? context.now() : context.now;
        authorizeInvocation({
          authority: context.authority,
          invocation,
          project: context.project,
          task: context.task,
          approvals,
          now,
        });
      }
      return inner(args);
    },
  };
}

function isPiCustomTool(value: unknown): value is PiCustomTool {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as PiCustomTool).name === "string" &&
    typeof (value as PiCustomTool).execute === "function"
  );
}
