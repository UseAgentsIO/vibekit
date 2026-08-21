import { VibeKitError } from "./errors.js";
import type { PermissionScope } from "./types.js";

export function normalizeGrantPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function pathMatches(requested: string, pattern: string): boolean {
  const path = normalizeGrantPath(requested);
  const glob = normalizeGrantPath(pattern);
  if (glob === "**" || glob === "**/*" || glob === "*") {
    return true;
  }
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (glob.endsWith("/*")) {
    const prefix = glob.slice(0, -2);
    if (!path.startsWith(`${prefix}/`)) {
      return false;
    }
    return !path.slice(prefix.length + 1).includes("/");
  }
  return path === glob;
}

export function pathAllowed(requested: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pathMatches(requested, pattern));
}

export function commandAllowed(requested: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const command = requested.trim();
  return patterns.some((pattern) => {
    if (pattern === "*" || pattern === "**") {
      return true;
    }
    return command === pattern || command.startsWith(`${pattern} `);
  });
}

export function resourceAllowed(requested: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.includes("*") || patterns.includes(requested);
}

/**
 * `undefined` means unbounded. An empty list means nothing is allowed.
 */
export function intersectStringLists(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] | undefined {
  if (left === undefined) {
    return right === undefined ? undefined : [...right];
  }
  if (right === undefined) {
    return [...left];
  }
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  if (left.includes("**") || left.includes("*")) {
    return [...right];
  }
  if (right.includes("**") || right.includes("*")) {
    return [...left];
  }
  return right.filter((item) => pathAllowed(item, left) || left.includes(item));
}

export function intersectScopes(
  grant: PermissionScope | undefined,
  task: { readonly paths: readonly string[]; readonly resources: readonly string[] },
  capability?: string,
): PermissionScope {
  const taskPaths = task.paths.length > 0 ? task.paths : undefined;
  const taskResources = task.resources.length > 0 ? task.resources : undefined;
  const paths = intersectStringLists(grant?.paths, taskPaths);
  const commands =
    capability === "command.execute"
      ? intersectStringLists(grant?.commands, taskResources)
      : intersectStringLists(grant?.commands, undefined);
  const resources =
    capability === "command.execute"
      ? intersectStringLists(grant?.resources, undefined)
      : intersectStringLists(grant?.resources, taskResources);
  const branches = grant?.branches !== undefined ? [...grant.branches] : undefined;
  return {
    ...(paths !== undefined ? { paths } : {}),
    ...(commands !== undefined ? { commands } : {}),
    ...(resources !== undefined ? { resources } : {}),
    ...(branches !== undefined && branches.length > 0 ? { branches } : {}),
  };
}

export function scopeIsImpossible(scope: PermissionScope | undefined, capability: string): boolean {
  if (scope === undefined) {
    return false;
  }
  if (
    (capability === "source.read" || capability === "source.write") &&
    scope.paths !== undefined &&
    scope.paths.length === 0
  ) {
    return true;
  }
  if (capability === "command.execute" && scope.commands !== undefined && scope.commands.length === 0) {
    return true;
  }
  if (
    (capability === "agent.delegate" ||
      capability.startsWith("repository.") ||
      capability.startsWith("schedule.")) &&
    scope.resources !== undefined &&
    scope.resources.length === 0
  ) {
    return true;
  }
  return false;
}

export function assertPathInScope(requested: string, scope: PermissionScope | undefined, capability: string): void {
  const patterns = scope?.paths;
  if (patterns === undefined) {
    return;
  }
  if (patterns.length === 0 || !pathAllowed(requested, patterns)) {
    throw new VibeKitError({
      category: "permission_denied",
      code: "path_not_in_scope",
      message:
        `Path ${requested} is outside the effective grant for ${capability}. ` +
        `Choose a path inside the selected workspace or update the workspace setting.`,
      details: { requested, capability, paths: patterns },
    });
  }
}

export function assertCommandInScope(
  requested: string,
  scope: PermissionScope | undefined,
  capability: string,
): void {
  const patterns = scope?.commands;
  if (patterns === undefined) {
    return;
  }
  if (patterns.length === 0 || !commandAllowed(requested, patterns)) {
    throw new VibeKitError({
      category: "permission_denied",
      code: "command_not_in_scope",
      message:
        `Command ${requested} is outside the effective grant for ${capability}. ` +
        `Choose an approved command or update the allowed commands setting.`,
      details: { requested, capability, commands: patterns },
    });
  }
}

export function assertResourceInScope(
  requested: string,
  scope: PermissionScope | undefined,
  capability: string,
): void {
  const patterns = scope?.resources;
  if (patterns === undefined) {
    return;
  }
  if (patterns.length === 0 || !resourceAllowed(requested, patterns)) {
    throw new VibeKitError({
      category: "permission_denied",
      code: "resource_not_in_scope",
      message:
        `Resource ${requested} is outside the effective grant for ${capability}. ` +
        `Choose an allowed resource or update the connection scope setting.`,
      details: { requested, capability, resources: patterns },
    });
  }
}
