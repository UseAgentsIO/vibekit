import {
  listRegistryModules,
  parseModuleId,
  resolveModule,
  type ModuleType,
  type Registry,
} from "@useagentsio/core";

import type { MenuOption } from "./ui/options.js";

export interface SetupItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * First-run fallback copy used only when a registry Module has no description.
 * Registry module.yaml remains authoritative.
 */
const WIZARD_COPY: Readonly<Record<string, string>> = {
  chief: "Coordinates user intent, decomposes work, and delegates to specialized agents.",
  coder: "Implements bounded code changes in isolated Git worktrees and returns evidence.",
  reviewer: "Independently reviews candidate changes without source-write permission.",
  researcher: "Investigates documentation and codebases and produces cited findings.",
  "project-manager":
    "Breaks larger objectives into scoped tasks with constraints and acceptance criteria.",
  personal: "Handles personal planning, notes, and life-admin tasks. Does not write project source.",
  "least-privilege": "Restricts agents to explicitly granted capabilities, paths, and commands.",
  "require-verification":
    "Requires configured verification to pass before consequential work can be accepted.",
};

/** Order-only fallback. Identity and copy come from the registry. */
export const SETUP_AGENTS: readonly SetupItem[] = [
  { id: "chief", label: "Chief" },
  { id: "coder", label: "Coder" },
  { id: "reviewer", label: "Reviewer" },
  { id: "researcher", label: "Researcher" },
  { id: "project-manager", label: "Project Manager" },
  { id: "personal", label: "Personal" },
];

const AGENT_DELEGATION_TARGETS: Readonly<Record<string, readonly string[]>> = {
  chief: ["project-manager", "coder", "reviewer", "researcher", "personal"],
  "project-manager": ["coder", "reviewer", "researcher"],
};

export const SETUP_INTERFACES: readonly SetupItem[] = [
  { id: "terminal", label: "Terminal" },
  { id: "http", label: "HTTP" },
  { id: "webhook", label: "Webhook" },
  { id: "schedule", label: "Schedule" },
  { id: "slack", label: "Slack" },
  { id: "telegram", label: "Telegram" },
];

/** Fallback labels for explicit --skill flags. Not a catalog. */
export const SETUP_SKILLS: readonly SetupItem[] = [
  { id: "software-development", label: "Software development" },
  { id: "research", label: "Research" },
  { id: "memory-hygiene", label: "Memory hygiene" },
  { id: "browser-use", label: "Browser use" },
  { id: "scheduler", label: "Scheduler" },
];

export const PROJECT_POLICY_IDS: readonly string[] = ["least-privilege", "require-verification"];

export const SETUP_POLICIES: readonly SetupItem[] = [
  { id: "least-privilege", label: "Least privilege" },
  { id: "require-verification", label: "Require verification" },
  { id: "interface-pairing", label: "Interface pairing" },
  { id: "untrusted-inbound", label: "Untrusted inbound" },
  { id: "memory-write-approval", label: "Memory write approval" },
  { id: "schedule-no-recurse", label: "Schedule no-recurse" },
];

/** Fallback labels for explicit --tool flags. Not a catalog. */
export const SETUP_TOOLS: readonly SetupItem[] = [
  { id: "filesystem", label: "Filesystem" },
  { id: "execution", label: "Execution" },
  { id: "memory", label: "Memory" },
  { id: "web", label: "Web" },
  { id: "browser", label: "Browser" },
  { id: "github", label: "GitHub" },
  { id: "mcp", label: "MCP client" },
  { id: "process", label: "Process" },
  { id: "scheduler", label: "Scheduler" },
];

export function asMenuOptions(items: readonly SetupItem[]): MenuOption<string>[] {
  return items.map((item) => ({
    value: item.id,
    label: item.label,
    id: item.id,
    hint: item.description,
  }));
}

export function setupItemsFromRegistry(
  fallback: readonly SetupItem[],
  registry: Registry | undefined,
  type: ModuleType,
): SetupItem[] {
  if (registry === undefined) {
    return fallback.map(applyWizardCopy);
  }

  const live = new Map<string, SetupItem>();
  const seen = new Set<string>();
  for (const entry of listRegistryModules(registry)) {
    let parsed;
    try {
      parsed = parseModuleId(entry.id);
    } catch {
      continue;
    }
    if (parsed.type !== type || seen.has(parsed.name)) {
      continue;
    }
    seen.add(parsed.name);
    try {
      const module = resolveModule(registry, entry.id);
      live.set(module.name, {
        id: module.name,
        label: module.displayName ?? titleCaseName(module.name),
        description: module.description ?? WIZARD_COPY[module.name],
      });
    } catch {
      // Keep the static fallback for this id.
    }
  }

  const ordered: SetupItem[] = [];
  const used = new Set<string>();
  for (const item of fallback) {
    const liveItem = live.get(item.id);
    if (liveItem === undefined) {
      continue;
    }
    ordered.push(applyWizardCopy(liveItem));
    used.add(item.id);
  }
  for (const item of [...live.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!used.has(item.id)) {
      ordered.push(applyWizardCopy(item));
    }
  }
  return ordered;
}

export function projectPolicyItems(items: readonly SetupItem[]): SetupItem[] {
  return items.filter((item) => PROJECT_POLICY_IDS.includes(item.id));
}

export function normalizeAgentIds(
  ids: readonly string[],
  known: readonly SetupItem[] = SETUP_AGENTS,
): string[] {
  const knownIds = known.map((item) => item.id);
  const orderedKnown = knownIds.filter((id) => ids.includes(id));
  const extra = ids.filter((id) => !knownIds.includes(id));
  return [...orderedKnown, ...extra];
}

function applyWizardCopy(item: SetupItem): SetupItem {
  if (item.description !== undefined && item.description.length > 0) {
    return item;
  }
  const description = WIZARD_COPY[item.id];
  return description === undefined ? item : { ...item, description };
}

function titleCaseName(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}

export function inferDefaultAgent(ids: readonly string[]): string | undefined {
  const ordered = normalizeAgentIds(ids);
  if (ordered.length === 0) {
    return undefined;
  }
  if (ordered.includes("chief")) {
    return "chief";
  }
  return ordered[0];
}

export function deriveDelegation(
  agents: readonly string[],
  contracts?: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const selected = new Set(agents);
  const delegation: Record<string, readonly string[]> = {};
  for (const agent of agents) {
    const allowed = contracts?.[agent] ?? AGENT_DELEGATION_TARGETS[agent] ?? [];
    delegation[agent] = allowed.filter((target) => selected.has(target));
  }
  return delegation;
}

export function delegationContractsFromRegistry(
  registry: Registry,
  agents: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const contracts: Record<string, readonly string[]> = {};
  for (const name of agents) {
    try {
      const loaded = resolveModule(registry, `agent:${name}`);
      if (loaded.document.type !== "agent") {
        contracts[name] = [];
        continue;
      }
      contracts[name] = loaded.document.delegation.targets;
    } catch {
      contracts[name] = [];
    }
  }
  return contracts;
}

export function labelFor(items: readonly SetupItem[], id: string | undefined): string {
  if (id === undefined) {
    return "None";
  }
  return items.find((item) => item.id === id)?.label ?? id;
}

export function labelsFor(items: readonly SetupItem[], ids: readonly string[]): string {
  if (ids.length === 0) {
    return "None";
  }
  return ids.map((id) => labelFor(items, id)).join(", ");
}
