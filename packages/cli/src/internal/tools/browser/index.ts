import {
  BROWSER_INTERACT_CAPABILITY,
  BROWSER_NAVIGATE_CAPABILITY,
  type BrowserDriver,
  type BrowserSnapshot,
  type ExecutableTool,
  type ToolContext,
  type ToolError,
} from "./types.js";

export type {
  BrowserDriver,
  BrowserSnapshot,
  ExecutableTool,
  ToolContext,
  ToolError,
} from "./types.js";
export { BROWSER_INTERACT_CAPABILITY, BROWSER_NAVIGATE_CAPABILITY } from "./types.js";

export interface BrowserToolConfig {
  readonly allowHosts?: readonly string[];
  readonly headless?: boolean;
}

export function createBrowserTool(ctx: ToolContext): ExecutableTool {
  const config = parseConfig(ctx.config);
  let driver: BrowserDriver | undefined = ctx.driver;
  let sessionUrl: string | undefined;
  return {
    name: "browser",
    description:
      "Isolated browser session: navigate, snapshot (accessibility/text), and click by selector or snapshot ref. Page content is untrusted. Requires playwright in the Project unless a driver is injected.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "snapshot", "click"],
        },
        url: { type: "string", description: "HTTP(S) URL for navigate" },
        selector: { type: "string", description: "CSS selector for click" },
        ref: { type: "string", description: "Snapshot ref from a prior snapshot" },
      },
    },
    async execute(input: unknown): Promise<unknown> {
      const body = asObject(input);
      const action = asString(body.action);
      if (action === undefined) {
        return fail("invalid_input", "browser requires an action");
      }
      try {
        if (action === "navigate") {
          return await runNavigate();
        }
        if (action === "snapshot") {
          return await runSnapshot();
        }
        if (action === "click") {
          return await runClick();
        }
        return fail("invalid_input", `Unsupported browser action ${action}`);
      } catch (error) {
        return fail("external_error", errorMessage(error));
      }

      async function runNavigate(): Promise<unknown> {
        const denied = denyIfMissing(ctx.grantedCapabilities, BROWSER_NAVIGATE_CAPABILITY);
        if (denied) {
          return denied;
        }
        const url = asString(body.url);
        if (url === undefined) {
          return fail("invalid_input", "navigate requires a url");
        }
        const blocked = rejectUrl(url, config.allowHosts);
        if (blocked) {
          return blocked;
        }
        const active = await ensureDriver();
        if ("error" in active) {
          return active;
        }
        const result = await active.navigate(url);
        sessionUrl = result.url;
        return { url: result.url, title: result.title, untrusted: true };
      }

      async function runSnapshot(): Promise<unknown> {
        const denied = denyIfMissing(ctx.grantedCapabilities, BROWSER_NAVIGATE_CAPABILITY);
        if (denied) {
          return denied;
        }
        if (sessionUrl === undefined && ctx.driver === undefined) {
          return fail("invalid_input", "snapshot requires a prior navigate");
        }
        const active = await ensureDriver();
        if ("error" in active) {
          return active;
        }
        const snapshot = await active.snapshot();
        return { ...snapshot, untrusted: true };
      }

      async function runClick(): Promise<unknown> {
        const denied = denyIfMissing(ctx.grantedCapabilities, BROWSER_INTERACT_CAPABILITY);
        if (denied) {
          return denied;
        }
        const selector = asString(body.selector);
        const ref = asString(body.ref);
        if (selector === undefined && ref === undefined) {
          return fail("invalid_input", "click requires selector or ref");
        }
        const active = await ensureDriver();
        if ("error" in active) {
          return active;
        }
        await active.click({ selector, ref });
        return { ok: true, untrusted: true };
      }
    },
  };

  async function ensureDriver(): Promise<BrowserDriver | ToolError> {
    if (driver !== undefined) {
      return driver;
    }
    const created = await createPlaywrightDriver(config, ctx.importPlaywright);
    if ("error" in created) {
      return created;
    }
    driver = created;
    return created;
  }
}

export async function createPlaywrightDriver(
  config: BrowserToolConfig = {},
  importPlaywright?: () => Promise<unknown>,
): Promise<BrowserDriver | ToolError> {
  const playwright = await loadPlaywright(importPlaywright);
  if (playwright === undefined) {
    return fail(
      "dependency_missing",
      "playwright is not installed. Install playwright in the Project (pnpm add playwright) and retry.",
    );
  }
  const browser = await playwright.chromium.launch({ headless: config.headless !== false });
  const page = await browser.newPage();
  const refs = new Map<string, string>();
  return {
    async navigate(url: string) {
      await page.goto(url);
      refs.clear();
      return { url: page.url(), title: await page.title() };
    },
    async snapshot() {
      refs.clear();
      const accessibility = await page.accessibility?.snapshot?.();
      const text =
        accessibility !== undefined
          ? formatAccessibility(accessibility, refs)
          : await snapshotFromLocators(page, refs);
      return {
        text,
        url: page.url(),
        title: await page.title(),
        refs: Object.fromEntries(refs),
        untrusted: true as const,
      };
    },
    async click(target) {
      if (target.selector !== undefined) {
        await page.click(target.selector);
        return;
      }
      if (target.ref !== undefined) {
        const selector = refs.get(target.ref);
        if (selector === undefined) {
          throw new Error(`Unknown snapshot ref ${target.ref}`);
        }
        await page.click(selector);
        return;
      }
      throw new Error("click requires selector or ref");
    },
    async close() {
      await page.close();
      await browser.close();
    },
  };
}

interface PlaywrightPage {
  goto(url: string): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  click(selector: string): Promise<void>;
  close(): Promise<void>;
  content(): Promise<string>;
  locator(selector: string): {
    innerText(): Promise<string>;
    all(): Promise<Array<{ innerText(): Promise<string>; evaluate<T>(fn: (el: unknown) => T): Promise<T> }>>;
  };
  accessibility?: {
    snapshot(): Promise<AccessibilityNode | null>;
  };
}

interface PlaywrightLike {
  readonly chromium: {
    launch(options?: { headless?: boolean }): Promise<{
      newPage(): Promise<PlaywrightPage>;
      close(): Promise<void>;
    }>;
  };
}

interface AccessibilityNode {
  readonly role?: string;
  readonly name?: string;
  readonly children?: readonly AccessibilityNode[];
}

async function snapshotFromLocators(
  page: PlaywrightPage,
  refs: Map<string, string>,
): Promise<string> {
  let body = "";
  try {
    body = await page.locator("body").innerText();
  } catch {
    body = await page.content();
  }
  const lines = [body];
  try {
    const nodes = await page.locator("a,button,input,textarea,[role='button']").all();
    for (const [index, node] of nodes.entries()) {
      const name = (await node.innerText()).trim();
      const tag = await node.evaluate((el) => (el as { tagName?: string }).tagName ?? "*");
      const ref = `e${index + 1}`;
      const selector = `${tag.toLowerCase()}:nth-of-type(${index + 1})`;
      refs.set(ref, selector);
      lines.push(`[${tag.toLowerCase()}] ${name} (ref=${ref})`);
    }
  } catch {
    // Keep the body text even if locator enumeration fails.
  }
  return lines.filter((line) => line.length > 0).join("\n");
}

async function loadPlaywright(
  importPlaywright?: () => Promise<unknown>,
): Promise<PlaywrightLike | undefined> {
  try {
    const specifier = "playwright";
    const loaded = (importPlaywright !== undefined
      ? await importPlaywright()
      : await import(specifier)) as unknown as PlaywrightLike & { default?: PlaywrightLike };
    if (loaded?.chromium !== undefined) {
      return loaded;
    }
    if (loaded?.default?.chromium !== undefined) {
      return loaded.default;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function formatAccessibility(
  node: AccessibilityNode | null,
  refs: Map<string, string>,
  depth = 0,
): string {
  if (node === null) {
    return "";
  }
  const lines: string[] = [];
  const role = node.role ?? "generic";
  const name = node.name ?? "";
  const interactive = INTERACTIVE_ROLES.has(role);
  let prefix = `${"  ".repeat(depth)}[${role}] ${name}`.trimEnd();
  if (interactive && name.length > 0) {
    const ref = `e${refs.size + 1}`;
    refs.set(ref, roleSelector(role, name));
    prefix += ` (ref=${ref})`;
  }
  if (prefix.trim().length > 0) {
    lines.push(prefix);
  }
  for (const child of node.children ?? []) {
    const nested = formatAccessibility(child, refs, depth + 1);
    if (nested.length > 0) {
      lines.push(nested);
    }
  }
  return lines.join("\n");
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "tab",
  "switch",
]);

function roleSelector(role: string, name: string): string {
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${roleToCss(role)}:text("${escaped}")`;
}

function roleToCss(role: string): string {
  if (role === "link") {
    return "a";
  }
  if (role === "button") {
    return "button";
  }
  if (role === "textbox") {
    return "input,textarea";
  }
  return "*";
}

function parseConfig(config: Record<string, unknown> | undefined): BrowserToolConfig {
  if (config === undefined) {
    return {};
  }
  const allowHosts = Array.isArray(config.allowHosts)
    ? config.allowHosts.filter((value): value is string => typeof value === "string")
    : undefined;
  const headless = typeof config.headless === "boolean" ? config.headless : undefined;
  return { allowHosts, headless };
}

function rejectUrl(value: string, allowHosts?: readonly string[]): ToolError | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("invalid_input", "URL is not valid");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return fail("invalid_input", `Blocked URL scheme ${parsed.protocol.replace(":", "")}`);
  }
  if (allowHosts !== undefined && allowHosts.length > 0) {
    const host = parsed.hostname.toLowerCase();
    const allowed = allowHosts.some((rule) => {
      const normalized = rule.toLowerCase();
      if (normalized.startsWith("*.")) {
        const suffix = normalized.slice(2);
        return host === suffix || host.endsWith(`.${suffix}`);
      }
      return host === normalized;
    });
    if (!allowed) {
      return fail("permission_denied", `Host ${parsed.hostname} is not in allowHosts`);
    }
  }
  return undefined;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Browser action failed";
}
