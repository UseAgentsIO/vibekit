import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import {
  createBrowserTool,
  type BrowserDriver,
} from "@useagentsio/tool-browser";

const moduleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/tool/browser/1.0.0",
);

function fakeDriver(): BrowserDriver & {
  navigated: string[];
  clicks: Array<{ selector?: string; ref?: string }>;
} {
  const navigated: string[] = [];
  const clicks: Array<{ selector?: string; ref?: string }> = [];
  let url = "";
  return {
    navigated,
    clicks,
    async navigate(next) {
      navigated.push(next);
      url = next;
      return { url, title: "Example" };
    },
    async snapshot() {
      return {
        text: `[link] Docs (ref=e1)\n[button] Go (ref=e2)`,
        url,
        title: "Example",
        refs: { e1: "a:text(\"Docs\")", e2: "button:text(\"Go\")" },
        untrusted: true,
      };
    },
    async click(target) {
      clicks.push(target);
    },
  };
}

describe("tool:browser module", () => {
  it("validates registry module.yaml and recommends skill:browser-use", () => {
    const result = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(result.data).toMatchObject({
      id: "tool:browser",
      requires: { recommended: ["skill:browser-use", "policy:least-privilege"] },
      runtime: {
        kind: "pi-extension",
        package: "@useagentsio/tool-browser",
        export: "createBrowserTool",
      },
    });
  });
});

describe("createBrowserTool", () => {
  it("navigates, snapshots, and clicks through an injected driver", async () => {
    const driver = fakeDriver();
    const tool = createBrowserTool({ projectRoot: "/tmp", driver });
    const nav = (await tool.execute({ action: "navigate", url: "https://example.com" })) as {
      url: string;
      untrusted: boolean;
    };
    expect(nav.url).toBe("https://example.com");
    expect(nav.untrusted).toBe(true);
    const snap = (await tool.execute({ action: "snapshot" })) as {
      text: string;
      refs: Record<string, string>;
      untrusted: boolean;
    };
    expect(snap.untrusted).toBe(true);
    expect(snap.refs.e2).toContain("button");
    const click = (await tool.execute({ action: "click", ref: "e2" })) as { ok: boolean };
    expect(click.ok).toBe(true);
    expect(driver.clicks[0]).toEqual({ selector: undefined, ref: "e2" });
    await tool.execute({ action: "click", selector: "button.go" });
    expect(driver.clicks[1]).toEqual({ selector: "button.go", ref: undefined });
  });

  it("blocks file and javascript navigation", async () => {
    const tool = createBrowserTool({ projectRoot: "/tmp", driver: fakeDriver() });
    const fileUrl = (await tool.execute({ action: "navigate", url: "file:///tmp/x" })) as {
      error: true;
    };
    expect(fileUrl.error).toBe(true);
    const js = (await tool.execute({ action: "navigate", url: "javascript:alert(1)" })) as {
      error: true;
    };
    expect(js.error).toBe(true);
  });

  it("denies navigate and click without capabilities", async () => {
    const tool = createBrowserTool({
      projectRoot: "/tmp",
      driver: fakeDriver(),
      grantedCapabilities: ["browser.navigate"],
    });
    const click = (await tool.execute({ action: "click", selector: "a" })) as { code: string };
    expect(click.code).toBe("permission_denied");
    const noNav = createBrowserTool({
      projectRoot: "/tmp",
      driver: fakeDriver(),
      grantedCapabilities: [],
    });
    const nav = (await noNav.execute({ action: "navigate", url: "https://example.com" })) as {
      code: string;
    };
    expect(nav.code).toBe("permission_denied");
  });

  it("returns a clear error when playwright is missing and no driver is injected", async () => {
    const tool = createBrowserTool({
      projectRoot: "/tmp",
      importPlaywright: async () => {
        throw new Error("Cannot find package 'playwright'");
      },
    });
    const result = (await tool.execute({ action: "navigate", url: "https://example.com" })) as {
      error: true;
      code: string;
      message: string;
    };
    expect(result.error).toBe(true);
    expect(result.code).toBe("dependency_missing");
    expect(result.message).toMatch(/playwright/i);
  });
});
