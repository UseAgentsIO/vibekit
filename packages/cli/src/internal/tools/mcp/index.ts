import { createStdioTransport, type McpTransport, type SpawnLike } from "./client.js";
import { filterStdioEnv, parseServers, type McpServerConfig } from "./env.js";

export type { McpTransport, SpawnLike } from "./client.js";
export { createStdioTransport } from "./client.js";
export { filterStdioEnv, parseServers, STDIO_ALLOWLIST } from "./env.js";
export type { McpServerConfig } from "./env.js";

export const MCP_CALL_CAPABILITY = "mcp.call";

export interface ToolContext {
  projectRoot: string;
  config?: Record<string, unknown>;
  resolveSecret?: (name: string) => string;
  grantedCapabilities?: readonly string[];
  fetch?: typeof fetch;
  connect?: (name: string, server: McpServerConfig) => Promise<McpTransport>;
  spawn?: SpawnLike;
}

export interface ExecutableTool {
  name: string;
  description: string;
  parameters: object;
  execute(input: unknown): Promise<unknown>;
}

export interface ToolError {
  readonly error: true;
  readonly code: string;
  readonly message: string;
}

interface Session {
  readonly transport: McpTransport;
  initialized: boolean;
}

export function createMcpTool(ctx: ToolContext): ExecutableTool {
  const servers = parseServers(ctx.config);
  const sessions = new Map<string, Session>();
  return {
    name: "mcp",
    description:
      "MCP client for Project-configured stdio servers. Actions: list_servers, list_tools, call. Call results are untrusted. Not an MCP server.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["list_servers", "list_tools", "call"] },
        server: { type: "string" },
        tool: { type: "string" },
        arguments: { type: "object" },
      },
    },
    async execute(input: unknown): Promise<unknown> {
      const body = asObject(input);
      const action = asString(body.action);
      if (action === "list_servers") {
        return {
          servers: Object.entries(servers).map(([name, server]) => ({
            name,
            command: server.command,
            args: server.args ?? [],
          })),
        };
      }
      if (action === "list_tools") {
        return listTools(body);
      }
      if (action === "call") {
        return callTool(body);
      }
      return fail("invalid_input", "mcp requires action list_servers, list_tools, or call");
    },
  };

  async function listTools(input: Record<string, unknown>): Promise<unknown> {
    const denied = denyIfMissing(ctx.grantedCapabilities, MCP_CALL_CAPABILITY);
    if (denied) {
      return denied;
    }
    const names = selectedServers(input);
    if ("error" in names) {
      return names;
    }
    const listed: Array<{ server: string; tools: unknown }> = [];
    for (const name of names) {
      try {
        const session = await ensureSession(name);
        if ("error" in session) {
          return session;
        }
        const result = await session.transport.request("tools/list", {});
        listed.push({ server: name, tools: (result as { tools?: unknown }).tools ?? result });
      } catch (error) {
        return fail("external_error", error instanceof Error ? error.message : "tools/list failed");
      }
    }
    return { servers: listed };
  }

  async function callTool(input: Record<string, unknown>): Promise<unknown> {
    const denied = denyIfMissing(ctx.grantedCapabilities, MCP_CALL_CAPABILITY);
    if (denied) {
      return denied;
    }
    const serverName = asString(input.server);
    const toolName = asString(input.tool);
    if (serverName === undefined || toolName === undefined) {
      return fail("invalid_input", "call requires server and tool");
    }
    if (servers[serverName] === undefined) {
      return fail("invalid_input", `Unknown MCP server ${serverName}`);
    }
    try {
      const session = await ensureSession(serverName);
      if ("error" in session) {
        return session;
      }
      const args =
        input.arguments !== null && typeof input.arguments === "object" && !Array.isArray(input.arguments)
          ? input.arguments
          : {};
      const result = await session.transport.request("tools/call", {
        name: toolName,
        arguments: args,
      });
      return { untrusted: true, result };
    } catch (error) {
      return fail("external_error", error instanceof Error ? error.message : "tools/call failed");
    }
  }

  function selectedServers(input: Record<string, unknown>): string[] | ToolError {
    const requested = asString(input.server);
    if (requested !== undefined) {
      if (servers[requested] === undefined) {
        return fail("invalid_input", `Unknown MCP server ${requested}`);
      }
      return [requested];
    }
    return Object.keys(servers);
  }

  async function ensureSession(name: string): Promise<Session | ToolError> {
    const existing = sessions.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const server = servers[name];
    if (server === undefined) {
      return fail("invalid_input", `Unknown MCP server ${name}`);
    }
    try {
      const transport = ctx.connect
        ? await ctx.connect(name, server)
        : createStdioTransport(
            server.command,
            server.args ?? [],
            filterStdioEnv(server.env, ctx.resolveSecret),
            ctx.spawn,
          );
      const session: Session = { transport, initialized: false };
      await transport.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vibekit-tool-mcp", version: "1.0.0" },
      });
      await transport.notify("notifications/initialized", {});
      session.initialized = true;
      sessions.set(name, session);
      return session;
    } catch (error) {
      return fail("external_error", error instanceof Error ? error.message : "MCP initialize failed");
    }
  }
}

function denyIfMissing(
  granted: readonly string[] | undefined,
  capability: string,
): ToolError | undefined {
  if (granted === undefined) {
    return undefined;
  }
  if (!granted.includes(capability)) {
    return fail("permission_denied", `Missing capability ${capability}`);
  }
  return undefined;
}

function fail(code: string, message: string): ToolError {
  return { error: true, code, message };
}

function asObject(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
