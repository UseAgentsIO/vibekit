export const PI_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export type PiBuiltinTool = (typeof PI_BUILTIN_TOOLS)[number];

export const AGENT_DELEGATE_TOOL = "agent_delegate";
export const DELEGATE_CAPABILITY = "agent.delegate";

export const CAPABILITY_TOOL_MAP: Readonly<Record<string, readonly string[]>> = {
  "source.read": ["read", "grep", "find", "ls"],
  "source.write": ["write", "edit"],
  "command.execute": ["bash"],
  [DELEGATE_CAPABILITY]: [AGENT_DELEGATE_TOOL],
};

export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "bash"]);

export function toolsForCapability(capability: string): readonly string[] {
  return CAPABILITY_TOOL_MAP[capability] ?? [];
}

export function hasDelegateCapability(capabilities: readonly string[]): boolean {
  return capabilities.includes(DELEGATE_CAPABILITY);
}

export function registerDelegateTool(
  tools: readonly string[],
  capabilities: readonly string[],
): readonly string[] {
  if (!hasDelegateCapability(capabilities)) {
    return uniqueTools(tools.filter((tool) => tool !== AGENT_DELEGATE_TOOL));
  }
  return uniqueTools([...tools, AGENT_DELEGATE_TOOL]);
}

export function uniqueTools(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
