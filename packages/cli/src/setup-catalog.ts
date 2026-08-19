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

export const SETUP_INTERFACES: readonly SetupItem[] = [
  { id: "terminal", label: "Terminal" },
  { id: "http", label: "HTTP" },
  { id: "webhook", label: "Webhook" },
  { id: "schedule", label: "Schedule" },
  { id: "slack", label: "Slack" },
  { id: "telegram", label: "Telegram" },
];

export const SETUP_SKILLS: readonly SetupItem[] = [
  { id: "software-development", label: "Software development" },
  { id: "research", label: "Research" },
  { id: "memory-hygiene", label: "Memory hygiene" },
  { id: "browser-use", label: "Browser use" },
  { id: "scheduler", label: "Scheduler" },
];

export const SETUP_POLICIES: readonly SetupItem[] = [
  { id: "least-privilege", label: "Least privilege" },
  { id: "require-verification", label: "Require verification" },
  { id: "interface-pairing", label: "Interface pairing" },
  { id: "untrusted-inbound", label: "Untrusted inbound" },
  { id: "memory-write-approval", label: "Memory write approval" },
  { id: "schedule-no-recurse", label: "Schedule no-recurse" },
];

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
