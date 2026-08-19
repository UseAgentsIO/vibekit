import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import {
  createMcpTool,
  filterStdioEnv,
  type McpTransport,
} from "@useagentsio/tool-mcp";

const moduleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/tool/mcp/1.0.0",
);

function fakeTransport(): McpTransport & { calls: Array<{ method: string; params?: unknown }> } {
  const calls: Array<{ method: string; params?: unknown }> = [];
  return {
    calls,
    async request(method, params) {
      calls.push({ method, params });
      if (method === "initialize") {
        return { protocolVersion: "2024-11-05", capabilities: { tools: {} } };
      }
      if (method === "tools/list") {
        return {
          tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
        };
      }
      if (method === "tools/call") {
        return { content: [{ type: "text", text: "pong" }] };
      }
      throw new Error(`unexpected ${method}`);
    },
    async notify(method, params) {
      calls.push({ method, params });
    },
    async close() {},
  };
}

describe("tool:mcp module", () => {
  it("validates registry module.yaml as an MCP client", () => {
    const result = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(result.data).toMatchObject({
      id: "tool:mcp",
      runtime: { kind: "pi-extension", export: "createMcpTool" },
    });
  });
});

describe("filterStdioEnv", () => {
  it("forwards only allowlisted names and explicit mappings", () => {
    const env = filterStdioEnv(
      { TOKEN: "MCP_TOKEN", SKIP: "not valid name" },
      (name) => (name === "MCP_TOKEN" ? "resolved-value" : ""),
      {
        PATH: "/bin",
        HOME: "/home/user",
        USER: "user",
        LANG: "en_US.UTF-8",
        TMPDIR: "/tmp",
        SECRET: "should-not-leak",
        MCP_TOKEN: "from-process",
      },
    );
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.TOKEN).toBe("resolved-value");
    expect(env.SECRET).toBeUndefined();
    expect(env.MCP_TOKEN).toBeUndefined();
    expect(env.SKIP).toBeUndefined();
  });
});

describe("createMcpTool", () => {
  it("lists servers and tools, and marks call results untrusted", async () => {
    const transport = fakeTransport();
    const tool = createMcpTool({
      projectRoot: "/tmp",
      config: {
        servers: { docs: { command: "npx", args: ["-y", "fake-mcp"], env: { TOKEN: "MCP_TOKEN" } } },
      },
      connect: async () => transport,
    });
    expect(await tool.execute({ action: "list_servers" })).toEqual({
      servers: [{ name: "docs", command: "npx", args: ["-y", "fake-mcp"] }],
    });
    expect(await tool.execute({ action: "list_tools", server: "docs" })).toEqual({
      servers: [
        {
          server: "docs",
          tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
        },
      ],
    });
    const called = (await tool.execute({
      action: "call",
      server: "docs",
      tool: "echo",
      arguments: { text: "hi" },
    })) as { untrusted: boolean; result: { content: Array<{ text: string }> } };
    expect(called.untrusted).toBe(true);
    expect(called.result.content[0]?.text).toBe("pong");
    expect(transport.calls.some((call) => call.method === "initialize")).toBe(true);
    expect(transport.calls.some((call) => call.method === "notifications/initialized")).toBe(true);
  });

  it("denies call without mcp.call and rejects unknown servers", async () => {
    const tool = createMcpTool({
      projectRoot: "/tmp",
      config: { servers: { docs: { command: "npx" } } },
      grantedCapabilities: [],
      connect: async () => fakeTransport(),
    });
    const denied = (await tool.execute({
      action: "call",
      server: "docs",
      tool: "echo",
    })) as { code: string };
    expect(denied.code).toBe("permission_denied");
    const listed = (await tool.execute({ action: "list_tools", server: "docs" })) as {
      code: string;
    };
    expect(listed.code).toBe("permission_denied");
    const open = createMcpTool({
      projectRoot: "/tmp",
      config: { servers: { docs: { command: "npx" } } },
      connect: async () => fakeTransport(),
    });
    const missing = (await open.execute({ action: "list_tools", server: "nope" })) as {
      error: true;
    };
    expect(missing.error).toBe(true);
  });
});
