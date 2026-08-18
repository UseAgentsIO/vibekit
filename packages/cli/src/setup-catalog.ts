import type { MenuOption } from "./ui/options.js";

export interface SetupItem {
  readonly id: string;
  readonly label: string;
}

export const SETUP_AGENTS: readonly SetupItem[] = [
  { id: "chief", label: "Chief" },
  { id: "coder", label: "Coder" },
  { id: "reviewer", label: "Reviewer" },
  { id: "researcher", label: "Researcher" },
  { id: "project-manager", label: "Project Manager" },
];

export const SETUP_INTERFACES: readonly SetupItem[] = [{ id: "terminal", label: "Terminal" }];

export const SETUP_SKILLS: readonly SetupItem[] = [
  { id: "software-development", label: "Software development" },
  { id: "research", label: "Research" },
];

export const SETUP_POLICIES: readonly SetupItem[] = [
  { id: "least-privilege", label: "Least privilege" },
  { id: "require-verification", label: "Require verification" },
];

export const SETUP_TOOLS: readonly SetupItem[] = [
  { id: "filesystem", label: "Filesystem" },
  { id: "execution", label: "Execution" },
];

export function asMenuOptions(items: readonly SetupItem[]): MenuOption<string>[] {
  return items.map((item) => ({
    value: item.id,
    label: item.label,
    id: item.id,
  }));
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
