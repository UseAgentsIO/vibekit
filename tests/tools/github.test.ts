import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { createGithubTool } from "@useagentsio/tool-github";

const registryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/tool/github",
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("tool:github modules", () => {
  it("keeps 1.0.0 config-only and 1.1.0 executable", () => {
    const stub = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(registryRoot, "1.0.0/module.yaml"), "utf8"),
    );
    const next = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(registryRoot, "1.1.0/module.yaml"), "utf8"),
    );
    expect(stub.valid, JSON.stringify(stub.errors)).toBe(true);
    expect(next.valid, JSON.stringify(next.errors)).toBe(true);
    expect(stub.data).toMatchObject({
      version: "1.0.0",
      runtime: { kind: "config-only", available: false },
    });
    expect(next.data).toMatchObject({
      version: "1.1.0",
      runtime: {
        kind: "pi-extension",
        package: "@useagentsio/tool-github",
        export: "createGithubTool",
        available: true,
      },
    });
  });
});

describe("createGithubTool", () => {
  it("reads issues, prs, checks, and files with config.repository", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const tool = createGithubTool({
      projectRoot: "/tmp",
      config: { repository: "acme/widgets" },
      resolveSecret: (name) => (name === "GITHUB_TOKEN" ? "test-github-token" : ""),
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET" });
        if (url.endsWith("/issues/4")) {
          return jsonResponse({ number: 4, title: "Bug" });
        }
        if (url.includes("/issues?")) {
          return jsonResponse([{ number: 1 }]);
        }
        if (url.endsWith("/pulls/8")) {
          return jsonResponse({ number: 8, title: "PR" });
        }
        if (url.includes("/pulls")) {
          return jsonResponse([{ number: 8 }]);
        }
        if (url.includes("/check-runs")) {
          return jsonResponse({ check_runs: [{ name: "ci", status: "completed" }] });
        }
        if (url.includes("/contents/README.md")) {
          return jsonResponse({
            path: "README.md",
            encoding: "base64",
            content: Buffer.from("# Hi\n").toString("base64"),
            sha: "abc",
            type: "file",
          });
        }
        return jsonResponse({ message: "unexpected" }, 500);
      },
    });

    expect(await tool.execute({ action: "get_issue", number: 4 })).toMatchObject({ number: 4 });
    expect(await tool.execute({ action: "list_issues", state: "open" })).toEqual([{ number: 1 }]);
    expect(await tool.execute({ action: "get_pr", number: 8 })).toMatchObject({ number: 8 });
    expect(await tool.execute({ action: "list_prs" })).toEqual([{ number: 8 }]);
    expect(await tool.execute({ action: "list_checks", ref: "main" })).toMatchObject({
      check_runs: [{ name: "ci" }],
    });
    expect(await tool.execute({ action: "get_file", path: "README.md" })).toMatchObject({
      path: "README.md",
      content: "# Hi\n",
    });
    expect(calls.every((call) => call.url.startsWith("https://api.github.com/repos/acme/widgets"))).toBe(
      true,
    );
  });

  it("creates issues and denies writes without write caps", async () => {
    const tool = createGithubTool({
      projectRoot: "/tmp",
      config: { owner: "acme", repo: "widgets" },
      resolveSecret: () => "test-github-token",
      grantedCapabilities: ["repository.read", "repository.issue.read"],
      fetch: async (input, init) => {
        expect(init?.method).toBe("POST");
        expect(String(input)).toBe("https://api.github.com/repos/acme/widgets/issues");
        return jsonResponse({ number: 9, title: "New" }, 201);
      },
    });
    const denied = (await tool.execute({
      action: "create_issue",
      title: "New",
    })) as { code: string };
    expect(denied.code).toBe("permission_denied");

    const writer = createGithubTool({
      projectRoot: "/tmp",
      config: { owner: "acme", repo: "widgets" },
      resolveSecret: () => "test-github-token",
      grantedCapabilities: ["repository.issue.write"],
      fetch: async () => jsonResponse({ number: 9, title: "New" }, 201),
    });
    expect(await writer.execute({ action: "create_issue", title: "New" })).toMatchObject({
      number: 9,
    });
  });

  it("returns a clear error when GITHUB_TOKEN is missing", async () => {
    const tool = createGithubTool({
      projectRoot: "/tmp",
      config: { repository: "acme/widgets" },
      resolveSecret: () => {
        throw new Error("Host should not see this");
      },
    });
    const result = (await tool.execute({ action: "list_issues" })) as {
      error: true;
      code: string;
    };
    expect(result.error).toBe(true);
    expect(result.code).toBe("secret_missing");
  });

  it("rejects unsafe get_file paths", async () => {
    const tool = createGithubTool({
      projectRoot: "/tmp",
      config: { repository: "acme/widgets" },
      resolveSecret: () => "test-github-token",
      fetch: async () => jsonResponse({}),
    });
    const result = (await tool.execute({ action: "get_file", path: "../secret" })) as {
      error: true;
    };
    expect(result.error).toBe(true);
  });
});
