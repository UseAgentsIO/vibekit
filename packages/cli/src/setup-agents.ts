import {
  SETUP_AGENTS,
  asMenuOptions,
  inferDefaultAgent,
  labelFor,
  labelsFor,
  normalizeAgentIds,
  type SetupItem,
} from "./setup-catalog.js";
import { printDone } from "./ui/render.js";
import { resolveMultiSelect, resolveSelect } from "./ui/resolve.js";
import { isSubmit, submit, type PromptResult } from "./ui/result.js";
import { clearRenderedLines } from "./ui/theme.js";

export interface AgentSelection {
  readonly agents: readonly string[];
  readonly defaultAgent?: string;
}

export async function resolveProjectAgents(input: {
  readonly values?: readonly string[];
  readonly required: boolean;
  readonly interactive?: boolean;
  readonly items?: readonly SetupItem[];
}): Promise<PromptResult<AgentSelection>> {
  const items = input.items ?? SETUP_AGENTS;
  const options = asMenuOptions(items);
  if (input.values !== undefined) {
    const agents = normalizeAgentIds(input.values, items);
    const defaultAgent = inferDefaultAgent(agents);
    const label = agents.length === 0 ? "None" : labelsFor(items, agents);
    printDone("Agents", label);
    let lines = 1;
    if (agents.length > 1 && defaultAgent !== undefined) {
      printDone("Default agent", labelFor(items, defaultAgent));
      lines = 2;
    }
    return submit({ agents, defaultAgent }, lines);
  }

  for (;;) {
    const picked = await resolveMultiSelect({
      message: "Agents",
      description: "Choose one or more agents for this project.",
      interactive: input.interactive,
      searchable: true,
      min: input.required ? 1 : 0,
      initial: items.some((item) => item.id === "assistant") ? ["assistant"] : undefined,
      hintBelow: true,
      options,
    });
    if (!isSubmit(picked)) {
      return picked;
    }
    const agents = picked.value;
    if (agents.length <= 1) {
      return submit(
        { agents, defaultAgent: inferDefaultAgent(agents) },
        picked.lines ?? 1,
      );
    }

    const defaultOptions = options
      .filter((option) => agents.includes(option.value))
      .map((option) => ({
        ...option,
        hint: defaultAgentHint(option.value) ?? option.hint,
      }));
    const inferred = inferDefaultAgent(agents);
    const initial = Math.max(
      0,
      defaultOptions.findIndex((option) => option.value === inferred),
    );
    const chosen = await resolveSelect({
      message: "Default agent",
      description: "Who should receive new messages by default?",
      interactive: true,
      searchable: false,
      initial,
      hintBelow: true,
      options: defaultOptions,
    });
    if (!isSubmit(chosen) || chosen.value === undefined) {
      clearRenderedLines(picked.lines ?? 1);
      if (chosen.status === "cancel") {
        return chosen;
      }
      continue;
    }
    return submit(
      { agents, defaultAgent: chosen.value },
      (picked.lines ?? 1) + (chosen.lines ?? 1),
    );
  }
}

function defaultAgentHint(id: string): string | undefined {
  switch (id) {
    case "assistant":
      return "Handles everyday research, planning, and project work in one useful default Agent";
    case "chief":
      return "Coordinates requests and delegates work to specialists";
    case "coder":
      return "Send requests directly to the implementation agent";
    case "reviewer":
      return "Send requests directly to the review agent";
    case "researcher":
      return "Send requests directly to the research agent";
    case "project-manager":
      return "Send requests directly to the planning agent";
    case "personal":
      return "Send requests directly to the personal agent";
    default:
      return undefined;
  }
}
