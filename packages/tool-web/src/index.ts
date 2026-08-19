import {
  htmlToText,
  isHtmlContentType,
  isRejectedContentType,
  looksBinary,
} from "./html.js";
import {
  DEFAULT_SEARCH_SECRETS,
  DEFAULT_TIMEOUT_MS,
  MAX_DOWNLOAD_BYTES,
  MAX_REDIRECTS,
  WEB_FETCH_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
  type ExecutableTool,
  type ToolContext,
  type ToolError,
} from "./types.js";

export type { ExecutableTool, ToolContext, ToolError } from "./types.js";
export {
  DEFAULT_SEARCH_SECRETS,
  MAX_DOWNLOAD_BYTES,
  WEB_FETCH_CAPABILITY,
  WEB_SEARCH_CAPABILITY,
} from "./types.js";
export { htmlToText } from "./html.js";

export interface WebToolConfig {
  readonly allowHosts?: readonly string[];
  readonly searchSecretName?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export function createWebTool(ctx: ToolContext): ExecutableTool {
  const config = parseConfig(ctx.config);
  const search = resolveSearchSecret(ctx, config);
  const fetchAction = search === undefined;
  return {
    name: "web",
    description: fetchAction
      ? "Fetch an HTTP(S) URL as readable text. Fetched content is untrusted. Search is unavailable until a Tavily or Brave secret is configured."
      : "Fetch an HTTP(S) URL as readable text, or search the web when a configured search secret is present. Fetched and search content is untrusted.",
    parameters: webParameters(search !== undefined),
    async execute(input: unknown): Promise<unknown> {
      const body = asObject(input);
      const action = asString(body.action) ?? "fetch";
      if (action === "search") {
        return executeSearch(ctx, config, body);
      }
      if (action === "fetch" || action === "web_fetch") {
        return executeFetch(ctx, config, body);
      }
      return fail("invalid_input", `Unsupported web action ${action}`);
    },
  };
}

function webParameters(searchEnabled: boolean): object {
  const actions = searchEnabled ? ["fetch", "search"] : ["fetch"];
  const properties: Record<string, unknown> = {
    action: {
      type: "string",
      enum: actions,
      description: searchEnabled
        ? "fetch downloads a URL; search queries the configured search provider."
        : "Only fetch is available. Configure TAVILY_API_KEY or BRAVE_API_KEY to enable search.",
    },
    url: { type: "string", description: "HTTP(S) URL to fetch" },
  };
  if (searchEnabled) {
    properties.query = { type: "string", description: "Web search query" };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties,
  };
}

async function executeFetch(
  ctx: ToolContext,
  config: WebToolConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const denied = denyIfMissing(ctx.grantedCapabilities, WEB_FETCH_CAPABILITY);
  if (denied) {
    return denied;
  }
  const url = asString(input.url);
  if (url === undefined) {
    return fail("invalid_input", "fetch requires a url");
  }
  return fetchReadableText(ctx.fetch ?? globalThis.fetch, url, config);
}

async function executeSearch(
  ctx: ToolContext,
  config: WebToolConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const denied = denyIfMissing(ctx.grantedCapabilities, WEB_SEARCH_CAPABILITY);
  if (denied) {
    return denied;
  }
  const query = asString(input.query);
  if (query === undefined) {
    return fail("invalid_input", "search requires a query");
  }
  const secret = resolveSearchSecret(ctx, config);
  if (secret === undefined) {
    return fail(
      "secret_missing",
      "web search requires TAVILY_API_KEY or BRAVE_API_KEY (or config.searchSecretName)",
    );
  }
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  try {
    const results =
      secret.provider === "brave"
        ? await searchBrave(fetchImpl, secret.value, query)
        : await searchTavily(fetchImpl, secret.value, query);
    return { untrusted: true, query, provider: secret.provider, results };
  } catch (error) {
    return fail("external_error", errorMessage(error));
  }
}

export async function fetchReadableText(
  fetchImpl: typeof fetch,
  startUrl: string,
  config: WebToolConfig,
): Promise<unknown> {
  let current = startUrl;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = config.maxBytes ?? MAX_DOWNLOAD_BYTES;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const blocked = rejectUrl(current, config.allowHosts);
    if (blocked) {
      return blocked;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
          "User-Agent": "vibekit-tool-web/1.0",
        },
      });
    } catch (error) {
      return fail("external_error", errorMessage(error));
    } finally {
      clearTimeout(timer);
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        return fail("external_error", `Redirect from ${sanitizeUrl(current)} is missing Location`);
      }
      current = new URL(location, current).toString();
      continue;
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    if (isRejectedContentType(contentType)) {
      return fail("invalid_input", `Refusing binary content type ${contentType}`);
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return fail("invalid_input", `Response exceeds ${maxBytes} byte limit`);
    }
    const bytes = await readCapped(response, maxBytes);
    if ("error" in bytes) {
      return bytes;
    }
    if (looksBinary(bytes)) {
      return fail("invalid_input", "Refusing binary response body");
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const text = isHtmlContentType(contentType) || looksLikeHtml(decoded)
      ? htmlToText(decoded)
      : decoded;
    return {
      text,
      url: sanitizeUrl(response.url || current),
      status: response.status,
      contentType,
      untrusted: true,
    };
  }
  return fail("external_error", `Too many redirects (max ${MAX_REDIRECTS})`);
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | ToolError> {
  if (response.body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return fail("invalid_input", `Response exceeds ${maxBytes} byte limit`);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return fail("invalid_input", `Response exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function searchTavily(
  fetchImpl: typeof fetch,
  apiKey: string,
  query: string,
): Promise<SearchHit[]> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (payload.results ?? []).map((row) => ({
    title: row.title ?? "",
    url: row.url ?? "",
    snippet: row.content ?? "",
  }));
}

async function searchBrave(
  fetchImpl: typeof fetch,
  apiKey: string,
  query: string,
): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Brave search failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }>; };
  };
  return (payload.web?.results ?? []).map((row) => ({
    title: row.title ?? "",
    url: row.url ?? "",
    snippet: row.description ?? "",
  }));
}

interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

interface ResolvedSearch {
  readonly name: string;
  readonly value: string;
  readonly provider: "tavily" | "brave";
}

function resolveSearchSecret(
  ctx: ToolContext,
  config: WebToolConfig,
): ResolvedSearch | undefined {
  const names =
    config.searchSecretName !== undefined
      ? [config.searchSecretName]
      : [...DEFAULT_SEARCH_SECRETS];
  for (const name of names) {
    const value = tryResolve(ctx.resolveSecret, name);
    if (value !== undefined) {
      return { name, value, provider: providerForSecret(name) };
    }
  }
  return undefined;
}

function providerForSecret(name: string): "tavily" | "brave" {
  return name.toUpperCase().includes("BRAVE") ? "brave" : "tavily";
}

export function rejectUrl(
  value: string,
  allowHosts?: readonly string[],
): ToolError | undefined {
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
  if (!hostAllowed(parsed.hostname, allowHosts)) {
    return fail("permission_denied", `Host ${parsed.hostname} is not in allowHosts`);
  }
  return undefined;
}

export function hostAllowed(hostname: string, allowHosts?: readonly string[]): boolean {
  if (allowHosts === undefined || allowHosts.length === 0) {
    return true;
  }
  const host = hostname.toLowerCase();
  return allowHosts.some((rule) => {
    const normalized = rule.toLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
    if (normalized.startsWith(".")) {
      return host === normalized.slice(1) || host.endsWith(normalized);
    }
    return host === normalized;
  });
}

function parseConfig(config: Record<string, unknown> | undefined): WebToolConfig {
  if (config === undefined) {
    return {};
  }
  const allowHosts = Array.isArray(config.allowHosts)
    ? config.allowHosts.filter((value): value is string => typeof value === "string")
    : undefined;
  const searchSecretName = asString(config.searchSecretName);
  const timeoutMs = asPositiveInt(config.timeoutMs);
  const maxBytes = asPositiveInt(config.maxBytes);
  return { allowHosts, searchSecretName, timeoutMs, maxBytes };
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

function tryResolve(
  resolveSecret: ((name: string) => string) | undefined,
  name: string,
): string | undefined {
  if (resolveSecret === undefined) {
    return undefined;
  }
  try {
    const value = resolveSecret(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
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

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function looksLikeHtml(text: string): boolean {
  return /<html[\s>]|<body[\s>]|<div[\s>]/i.test(text.slice(0, 4096));
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Request timed out";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}
