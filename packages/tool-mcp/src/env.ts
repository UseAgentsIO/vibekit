export const STDIO_ALLOWLIST = ["PATH", "HOME", "USER", "LANG", "TMPDIR"] as const;

export interface McpServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export function parseServers(config: Record<string, unknown> | undefined): Record<string, McpServerConfig> {
  const raw = config?.servers;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.command !== "string" || row.command.length === 0) {
      continue;
    }
    const args = Array.isArray(row.args)
      ? row.args.filter((entry): entry is string => typeof entry === "string")
      : [];
    const env =
      row.env !== null && typeof row.env === "object" && !Array.isArray(row.env)
        ? Object.fromEntries(
            Object.entries(row.env as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === "string" && typeof entry[1] === "string",
            ),
          )
        : undefined;
    servers[name] = { command: row.command, args, env };
  }
  return servers;
}

export function filterStdioEnv(
  mapping: Readonly<Record<string, string>> | undefined,
  resolveSecret?: (name: string) => string,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of STDIO_ALLOWLIST) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) {
      env[name] = value;
    }
  }
  if (mapping === undefined) {
    return env;
  }
  for (const [childName, reference] of Object.entries(mapping)) {
    if (!isEnvName(childName) || !isEnvName(reference)) {
      continue;
    }
    const resolved = resolveReference(reference, resolveSecret, source);
    if (resolved !== undefined) {
      env[childName] = resolved;
    }
  }
  return env;
}

function resolveReference(
  name: string,
  resolveSecret: ((name: string) => string) | undefined,
  source: NodeJS.ProcessEnv,
): string | undefined {
  if (resolveSecret !== undefined) {
    try {
      const value = resolveSecret(name);
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    } catch {
      // Fall through to process.env by reference name only.
    }
  }
  const fromProcess = source[name];
  return typeof fromProcess === "string" && fromProcess.length > 0 ? fromProcess : undefined;
}

function isEnvName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
