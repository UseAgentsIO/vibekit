import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { createWebTool, htmlToText } from "@useagentsio/tool-web";

const moduleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/tool/web/1.0.0",
);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

describe("tool:web module", () => {
  it("validates registry module.yaml", () => {
    const result = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(result.data).toMatchObject({
      id: "tool:web",
      runtime: { kind: "pi-extension", package: "@useagentsio/tool-web", export: "createWebTool" },
    });
  });
});

describe("createWebTool", () => {
  it("fetches HTML as readable untrusted text", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      fetch: async () =>
        textResponse("<html><body><h1>Hello</h1><p>World</p></body></html>", 200, {
          "content-type": "text/html",
        }),
    });
    const result = (await tool.execute({ action: "fetch", url: "https://example.com/page" })) as {
      text: string;
      url: string;
      untrusted: boolean;
    };
    expect(result.untrusted).toBe(true);
    expect(result.url).toBe("https://example.com/page");
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World");
    expect(result.text).not.toContain("<h1>");
  });

  it("blocks non-http schemes", async () => {
    const tool = createWebTool({ projectRoot: "/tmp", fetch: async () => textResponse("no") });
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/a"]) {
      const result = (await tool.execute({ action: "fetch", url })) as {
        error: true;
        code: string;
        message: string;
      };
      expect(result.error).toBe(true);
      expect(result.code).toBe("invalid_input");
      expect(result.message).toMatch(/Blocked URL scheme/);
    }
  });

  it("enforces allowHosts and validates redirect targets", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      config: { allowHosts: ["example.com"] },
      fetch: async (input) => {
        const url = String(input);
        if (url === "https://example.com/go") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://evil.test/leak" },
          });
        }
        return textResponse("ok", 200, { "content-type": "text/plain" });
      },
    });
    const denied = (await tool.execute({ action: "fetch", url: "https://evil.test/" })) as {
      error: true;
    };
    expect(denied.error).toBe(true);
    const redirected = (await tool.execute({ action: "fetch", url: "https://example.com/go" })) as {
      error: true;
      message: string;
    };
    expect(redirected.error).toBe(true);
    expect(redirected.message).toMatch(/allowHosts/);
  });

  it("rejects binary responses and oversize bodies", async () => {
    const binary = createWebTool({
      projectRoot: "/tmp",
      fetch: async () =>
        new Response(new Uint8Array([0, 1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    const binaryResult = (await binary.execute({
      action: "fetch",
      url: "https://example.com/blob",
    })) as { error: true };
    expect(binaryResult.error).toBe(true);

    const oversized = createWebTool({
      projectRoot: "/tmp",
      config: { maxBytes: 8 },
      fetch: async () =>
        textResponse("0123456789abcdef", 200, { "content-type": "text/plain" }),
    });
    const sizeResult = (await oversized.execute({
      action: "fetch",
      url: "https://example.com/big",
    })) as { error: true; message: string };
    expect(sizeResult.error).toBe(true);
    expect(sizeResult.message).toMatch(/byte limit/);
  });

  it("follows a limited number of same-origin redirects", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/one")) {
          return new Response(null, { status: 302, headers: { location: "/two" } });
        }
        if (url.endsWith("/two")) {
          return textResponse("landed", 200, { "content-type": "text/plain" });
        }
        return textResponse("miss", 404);
      },
    });
    const result = (await tool.execute({ action: "fetch", url: "https://example.com/one" })) as {
      text: string;
      untrusted: boolean;
    };
    expect(result.text).toBe("landed");
    expect(result.untrusted).toBe(true);
  });

  it("omits search from parameters when no key is present and returns a clear error", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      resolveSecret: () => {
        throw new Error("missing");
      },
    });
    const schema = tool.parameters as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(["fetch"]);
    const result = (await tool.execute({ action: "search", query: "vibekit" })) as {
      error: true;
      code: string;
      message: string;
    };
    expect(result.error).toBe(true);
    expect(result.code).toBe("secret_missing");
    expect(result.message).not.toMatch(/sk-|Bearer /);
  });

  it("searches Tavily when TAVILY_API_KEY resolves", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const tool = createWebTool({
      projectRoot: "/tmp",
      resolveSecret: (name) => {
        if (name === "TAVILY_API_KEY") {
          return "test-tavily-key";
        }
        throw new Error("missing");
      },
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return jsonResponse({
          results: [{ title: "One", url: "https://example.com", content: "Snippet" }],
        });
      },
    });
    const schema = tool.parameters as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(["fetch", "search"]);
    const result = (await tool.execute({ action: "search", query: "agents" })) as {
      untrusted: boolean;
      provider: string;
      results: Array<{ title: string }>;
    };
    expect(result.untrusted).toBe(true);
    expect(result.provider).toBe("tavily");
    expect(result.results[0]?.title).toBe("One");
    expect(requests[0]?.url).toBe("https://api.tavily.com/search");
    const body = JSON.parse(String(requests[0]?.init?.body)) as { query: string };
    expect(body.query).toBe("agents");
  });

  it("searches Brave when the secret name contains BRAVE", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      config: { searchSecretName: "BRAVE_API_KEY" },
      resolveSecret: (name) => (name === "BRAVE_API_KEY" ? "test-brave-key" : ""),
      fetch: async (input, init) => {
        expect(String(input)).toContain("api.search.brave.com");
        expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe(
          "test-brave-key",
        );
        return jsonResponse({
          web: { results: [{ title: "Brave", url: "https://example.com", description: "Hit" }] },
        });
      },
    });
    const result = (await tool.execute({ action: "search", query: "pi" })) as {
      provider: string;
      untrusted: boolean;
    };
    expect(result.provider).toBe("brave");
    expect(result.untrusted).toBe(true);
  });

  it("denies fetch and search when grantedCapabilities omit the required cap", async () => {
    const tool = createWebTool({
      projectRoot: "/tmp",
      grantedCapabilities: [],
      resolveSecret: () => "test-tavily-key",
      fetch: async () => textResponse("no"),
    });
    const fetchDenied = (await tool.execute({
      action: "fetch",
      url: "https://example.com",
    })) as { error: true; code: string };
    expect(fetchDenied.code).toBe("permission_denied");
    const searchDenied = (await tool.execute({ action: "search", query: "x" })) as {
      code: string;
    };
    expect(searchDenied.code).toBe("permission_denied");
  });
});

describe("htmlToText", () => {
  it("strips scripts and decodes entities", () => {
    expect(htmlToText("<script>alert(1)</script><p>A&amp;B</p>")).toBe("A&B");
  });
});
