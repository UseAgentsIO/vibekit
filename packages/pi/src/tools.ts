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

export const CAPABILITY_TOOL_MAP: Readonly<Record<string, readonly PiBuiltinTool[]>> = {
  "source.read": ["read", "grep", "find", "ls"],
  "source.write": ["write", "edit"],
  "command.execute": ["bash"],
};

export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "bash"]);

export function toolsForCapability(capability: string): readonly PiBuiltinTool[] {
  return CAPABILITY_TOOL_MAP[capability] ?? [];
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
