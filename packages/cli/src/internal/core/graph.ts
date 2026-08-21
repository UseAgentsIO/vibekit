import { VibeKitError } from "./errors.js";
import type { ModuleId } from "./ids.js";
import type { LoadedModule } from "./module.js";

export interface DependencyGraph {
  readonly modules: readonly LoadedModule[];
  readonly edges: ReadonlyMap<ModuleId, readonly ModuleId[]>;
}

export interface ResolvedInstallSet {
  readonly toInstall: readonly LoadedModule[];
  readonly alreadyInstalled: readonly LoadedModule[];
  readonly recommended: readonly ModuleId[];
  readonly optional: readonly ModuleId[];
}

export function detectCycles(edges: ReadonlyMap<ModuleId, readonly ModuleId[]>): ModuleId[][] {
  const visiting = new Set<ModuleId>();
  const visited = new Set<ModuleId>();
  const cycles: ModuleId[][] = [];

  function visit(node: ModuleId, stack: ModuleId[]): void {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push(start >= 0 ? [...stack.slice(start), node] : [...stack, node]);
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      visit(next, stack);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of edges.keys()) {
    visit(node, []);
  }
  return cycles;
}

export function detectConflicts(modules: readonly LoadedModule[]): Array<{
  left: ModuleId;
  right: ModuleId;
}> {
  const ids = new Set(modules.map((module) => module.id));
  const conflicts: Array<{ left: ModuleId; right: ModuleId }> = [];
  const seen = new Set<string>();
  for (const module of modules) {
    for (const other of module.conflicts) {
      if (!ids.has(other)) {
        continue;
      }
      const key = [module.id, other].sort().join("\0");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      conflicts.push({ left: module.id, right: other });
    }
  }
  return conflicts;
}

export function topologicalSort(
  modules: readonly LoadedModule[],
  edges: ReadonlyMap<ModuleId, readonly ModuleId[]>,
): LoadedModule[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const remaining = new Map<ModuleId, Set<ModuleId>>();
  for (const module of modules) {
    remaining.set(
      module.id,
      new Set((edges.get(module.id) ?? []).filter((dep) => byId.has(dep))),
    );
  }
  const ordered: LoadedModule[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => id)
      .sort((left, right) => left.localeCompare(right));
    if (ready.length === 0) {
      throw new VibeKitError({
        category: "conflict",
        code: "dependency_cycle",
        message: "Dependency graph contains a cycle",
        details: { remaining: [...remaining.keys()] },
      });
    }
    for (const id of ready) {
      remaining.delete(id);
      const module = byId.get(id);
      if (module) {
        ordered.push(module);
      }
      for (const deps of remaining.values()) {
        deps.delete(id);
      }
    }
  }
  return ordered;
}

export function resolveRequiredGraph(
  roots: readonly ModuleId[],
  lookup: (id: ModuleId) => LoadedModule | undefined,
): DependencyGraph {
  const modules = new Map<ModuleId, LoadedModule>();
  const edges = new Map<ModuleId, ModuleId[]>();
  const missing: ModuleId[] = [];
  const queue = [...roots];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || modules.has(id)) {
      continue;
    }
    const loaded = lookup(id);
    if (loaded === undefined) {
      missing.push(id);
      continue;
    }
    modules.set(id, loaded);
    edges.set(id, [...loaded.requiredDependencies]);
    for (const dep of loaded.requiredDependencies) {
      if (!modules.has(dep)) {
        queue.push(dep);
      }
    }
  }

  if (missing.length > 0) {
    throw new VibeKitError({
      category: "dependency_missing",
      code: "required_dependency_missing",
      message: `Missing required dependencies: ${missing.join(", ")}`,
      details: { missing },
    });
  }

  const cycles = detectCycles(edges);
  if (cycles.length > 0) {
    throw new VibeKitError({
      category: "conflict",
      code: "dependency_cycle",
      message: `Dependency cycle detected: ${cycles[0]?.join(" -> ")}`,
      details: { cycles },
    });
  }

  const all = [...modules.values()];
  const conflicts = detectConflicts(all);
  if (conflicts.length > 0) {
    throw new VibeKitError({
      category: "conflict",
      code: "module_conflict",
      message: `Conflicting modules: ${conflicts[0]?.left} conflicts with ${conflicts[0]?.right}`,
      details: { conflicts },
    });
  }

  return { modules: all, edges };
}

export function resolveInstallSet(
  roots: readonly ModuleId[],
  lookup: (id: ModuleId) => LoadedModule | undefined,
  installedIds: ReadonlySet<ModuleId>,
): ResolvedInstallSet {
  const graph = resolveRequiredGraph(roots, lookup);
  const ordered = topologicalSort(graph.modules, graph.edges);
  const toInstall: LoadedModule[] = [];
  const alreadyInstalled: LoadedModule[] = [];
  const recommended = new Set<ModuleId>();
  const optional = new Set<ModuleId>();

  for (const module of ordered) {
    if (installedIds.has(module.id)) {
      alreadyInstalled.push(module);
    } else {
      toInstall.push(module);
    }
    for (const id of module.recommendedDependencies) {
      if (!installedIds.has(id) && !toInstall.some((item) => item.id === id)) {
        recommended.add(id);
      }
    }
    for (const id of module.optionalDependencies) {
      if (!installedIds.has(id) && !toInstall.some((item) => item.id === id)) {
        optional.add(id);
      }
    }
  }

  return {
    toInstall,
    alreadyInstalled,
    recommended: [...recommended],
    optional: [...optional],
  };
}
