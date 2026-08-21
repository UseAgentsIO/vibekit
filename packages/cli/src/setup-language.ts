import { formatModuleId, type ModuleId, type ProjectDocument } from "./internal/core/index.js";

import type { SetupItem } from "./setup-catalog.js";

/**
 * The first-run vocabulary. These choices deliberately describe outcomes while
 * their registry roots remain an implementation detail of the setup plan.
 */
export interface SetupAbility extends SetupItem {
  readonly capabilities: readonly string[];
  readonly roots: readonly ModuleId[];
}

export const SETUP_ABILITIES: readonly SetupAbility[] = [
  {
    id: "files",
    label: "Read and write files",
    description: "Work with files inside the selected workspace.",
    capabilities: ["source.read", "source.write"],
    roots: [formatModuleId("tool", "filesystem")],
  },
  {
    id: "commands",
    label: "Run approved commands",
    description: "Run the project's bounded verification and maintenance commands.",
    capabilities: ["command.execute"],
    roots: [formatModuleId("tool", "execution")],
  },
  {
    id: "web-search",
    label: "Enable web search",
    description: "Search the web when the task needs current information.",
    capabilities: ["web.search"],
    roots: [formatModuleId("tool", "web")],
  },
  {
    id: "memory",
    label: "Remember useful context",
    description: "Read and retain durable project memory.",
    capabilities: ["memory.read", "memory.write"],
    roots: [formatModuleId("state", "memory"), formatModuleId("tool", "memory")],
  },
];

export const DEFAULT_SETUP_ABILITIES: readonly string[] = SETUP_ABILITIES.map((item) => item.id);

/** Connections are still registry Interfaces internally, but normal setup never says so. */
export function connectionItems(items: readonly SetupItem[]): SetupItem[] {
  return items.map((item) => ({
    ...item,
    label: item.id === "terminal" ? "Use the terminal" : `Connect ${item.label}`,
    ...(item.description === undefined
      ? {}
      : {
          description: item.description
            .replace(/\bInterface\b/g, "connection")
            .replace(/\bState\b/g, "project data"),
        }),
  }));
}

export function abilityRoots(ids: readonly string[]): ModuleId[] {
  const selected = new Set(ids);
  return SETUP_ABILITIES
    .filter((item) => selected.has(item.id))
    .flatMap((item) => item.roots);
}

export function abilityCapabilities(ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return SETUP_ABILITIES.filter((item) => selected.has(item.id)).flatMap((item) => item.capabilities);
}

/** Persist only an explicit denial for abilities the user turned off. */
export function restrictProjectAbilities(
  project: ProjectDocument,
  ids: readonly string[],
): ProjectDocument {
  const enabled = new Set(abilityCapabilities(ids));
  const all = new Set(SETUP_ABILITIES.flatMap((item) => item.capabilities));
  const actions = { ...project.authorization.actions };
  for (const capability of all) {
    if (!enabled.has(capability)) {
      actions[capability] = "deny";
    }
  }
  return {
    ...project,
    authorization: { ...project.authorization, actions },
  };
}

/** Keep the persisted workspace relative and platform-independent. */
export function normalizeWorkspaceSelection(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.length === 0 ? "." : normalized;
}
