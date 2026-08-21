export const REPOSITORY_READ = "repository.read";
export const REPOSITORY_WRITE = "repository.write";
export const ISSUE_READ = "repository.issue.read";
export const ISSUE_WRITE = "repository.issue.write";

export interface ToolContext {
  projectRoot: string;
  config?: Record<string, unknown>;
  resolveSecret?: (name: string) => string;
  grantedCapabilities?: readonly string[];
  fetch?: typeof fetch;
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

const READ_ACTIONS = new Set([
  "get_issue",
  "list_issues",
  "get_pr",
  "list_prs",
  "list_checks",
  "get_file",
]);
const WRITE_ACTIONS = new Set(["create_issue"]);
const ISSUE_READ_ACTIONS = new Set(["get_issue", "list_issues"]);

const DEFAULT_API = "https://api.github.com";

export function createGithubTool(ctx: ToolContext): ExecutableTool {
  const config = parseConfig(ctx.config);
  return {
    name: "github",
    description:
      "GitHub issues, pull requests, checks, and file contents via api.github.com. Requires a GITHUB_TOKEN reference. Write actions need repository.write or repository.issue.write.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "get_issue",
            "list_issues",
            "create_issue",
            "get_pr",
            "list_prs",
            "list_checks",
            "get_file",
          ],
        },
        owner: { type: "string" },
        repo: { type: "string" },
        repository: { type: "string", description: "owner/repo override" },
        number: { type: "integer", description: "Issue or pull request number" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        state: { type: "string", enum: ["open", "closed", "all"] },
        ref: { type: "string", description: "Git ref for checks or file contents" },
        path: { type: "string", description: "Repository-relative path for get_file" },
        per_page: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    async execute(input: unknown): Promise<unknown> {
      const body = asObject(input);
      const action = asString(body.action);
      if (action === undefined) {
        return fail("invalid_input", "github requires an action");
      }
      const denied = denyAction(action, ctx.grantedCapabilities);
      if (denied) {
        return denied;
      }
      const repo = resolveRepo(body, config);
      if ("error" in repo) {
        return repo;
      }
      const token = tryResolve(ctx.resolveSecret, "GITHUB_TOKEN");
      if (token === undefined) {
        return fail("secret_missing", "Missing GITHUB_TOKEN");
      }
      const fetchImpl = ctx.fetch ?? globalThis.fetch;
      try {
        return await dispatch(fetchImpl, token, config.baseUrl, repo, action, body);
      } catch (error) {
        return fail("external_error", error instanceof Error ? error.message : "GitHub request failed");
      }
    },
  };
}

async function dispatch(
  fetchImpl: typeof fetch,
  token: string,
  baseUrl: string,
  repo: { owner: string; repo: string },
  action: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const root = `${baseUrl}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  switch (action) {
    case "get_issue": {
      const number = asPositiveInt(input.number);
      if (number === undefined) {
        return fail("invalid_input", "get_issue requires number");
      }
      return githubGet(fetchImpl, token, `${root}/issues/${number}`);
    }
    case "list_issues": {
      const query = new URLSearchParams();
      const state = asString(input.state);
      if (state !== undefined) {
        query.set("state", state);
      }
      const labels = stringArray(input.labels);
      if (labels.length > 0) {
        query.set("labels", labels.join(","));
      }
      const perPage = asPositiveInt(input.per_page);
      if (perPage !== undefined) {
        query.set("per_page", String(perPage));
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return githubGet(fetchImpl, token, `${root}/issues${suffix}`);
    }
    case "create_issue": {
      const title = asString(input.title);
      if (title === undefined) {
        return fail("invalid_input", "create_issue requires title");
      }
      return githubSend(fetchImpl, token, `${root}/issues`, "POST", {
        title,
        body: asString(input.body) ?? "",
        labels: stringArray(input.labels),
      });
    }
    case "get_pr": {
      const number = asPositiveInt(input.number);
      if (number === undefined) {
        return fail("invalid_input", "get_pr requires number");
      }
      return githubGet(fetchImpl, token, `${root}/pulls/${number}`);
    }
    case "list_prs": {
      const query = new URLSearchParams();
      const state = asString(input.state);
      if (state !== undefined) {
        query.set("state", state);
      }
      const perPage = asPositiveInt(input.per_page);
      if (perPage !== undefined) {
        query.set("per_page", String(perPage));
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return githubGet(fetchImpl, token, `${root}/pulls${suffix}`);
    }
    case "list_checks": {
      const ref = asString(input.ref);
      if (ref === undefined) {
        return fail("invalid_input", "list_checks requires ref");
      }
      return githubGet(
        fetchImpl,
        token,
        `${root}/commits/${encodeURIComponent(ref)}/check-runs`,
      );
    }
    case "get_file": {
      const filePath = asString(input.path);
      if (filePath === undefined) {
        return fail("invalid_input", "get_file requires path");
      }
      if (filePath.includes("\0") || filePath.includes("..") || filePath.startsWith("/")) {
        return fail("invalid_input", "get_file path must be a repository-relative path");
      }
      const ref = asString(input.ref);
      const query = ref !== undefined ? `?ref=${encodeURIComponent(ref)}` : "";
      const encoded = filePath
        .split("/")
        .filter((part) => part.length > 0)
        .map((part) => encodeURIComponent(part))
        .join("/");
      const payload = await githubGet(fetchImpl, token, `${root}/contents/${encoded}${query}`);
      if (payload !== null && typeof payload === "object" && "error" in payload) {
        return payload;
      }
      return decodeContents(payload);
    }
    default:
      return fail("invalid_input", `Unsupported github action ${action}`);
  }
}

async function githubGet(fetchImpl: typeof fetch, token: string, url: string): Promise<unknown> {
  return githubSend(fetchImpl, token, url, "GET");
}

async function githubSend(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "vibekit-tool-github/1.1.0",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { text };
    }
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "authorization_required"
      : "external_error";
    return fail(code, `GitHub ${method} ${response.status}`);
  }
  return parsed;
}

function decodeContents(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => {
      if (entry !== null && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        return { name: row.name, path: row.path, type: row.type, sha: row.sha };
      }
      return entry;
    });
  }
  if (payload === null || typeof payload !== "object") {
    return payload;
  }
  const row = payload as Record<string, unknown>;
  if (row.encoding === "base64" && typeof row.content === "string") {
    const decoded = Buffer.from(row.content.replace(/\n/g, ""), "base64").toString("utf8");
    return {
      path: row.path,
      sha: row.sha,
      type: row.type,
      encoding: "utf-8",
      content: decoded,
    };
  }
  return row;
}

function denyAction(
  action: string,
  granted: readonly string[] | undefined,
): ToolError | undefined {
  if (granted === undefined) {
    return undefined;
  }
  if (WRITE_ACTIONS.has(action)) {
    if (granted.includes(REPOSITORY_WRITE) || granted.includes(ISSUE_WRITE)) {
      return undefined;
    }
    return fail("permission_denied", `Missing capability ${ISSUE_WRITE}`);
  }
  if (ISSUE_READ_ACTIONS.has(action)) {
    if (granted.includes(REPOSITORY_READ) || granted.includes(ISSUE_READ)) {
      return undefined;
    }
    return fail("permission_denied", `Missing capability ${ISSUE_READ}`);
  }
  if (READ_ACTIONS.has(action)) {
    if (granted.includes(REPOSITORY_READ)) {
      return undefined;
    }
    return fail("permission_denied", `Missing capability ${REPOSITORY_READ}`);
  }
  return fail("invalid_input", `Unsupported github action ${action}`);
}

function resolveRepo(
  input: Record<string, unknown>,
  config: GithubConfig,
): { owner: string; repo: string } | ToolError {
  const owner = asString(input.owner) ?? config.owner;
  const repo = asString(input.repo) ?? config.repo;
  if (owner !== undefined && repo !== undefined) {
    return { owner, repo };
  }
  const repository = asString(input.repository) ?? config.repository;
  if (repository !== undefined) {
    const parts = repository.split("/").filter((part) => part.length > 0);
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      return { owner: parts[0], repo: parts[1] };
    }
  }
  return fail("invalid_input", "owner/repo is required (input or config.repository)");
}

interface GithubConfig {
  readonly owner?: string;
  readonly repo?: string;
  readonly repository?: string;
  readonly baseUrl: string;
}

function parseConfig(config: Record<string, unknown> | undefined): GithubConfig {
  if (config === undefined) {
    return { baseUrl: DEFAULT_API };
  }
  const owner = asString(config.owner);
  const repo = asString(config.repo);
  const repository = asString(config.repository);
  const baseUrl = stripSlash(asString(config.baseUrl) ?? DEFAULT_API);
  return { owner, repo, repository, baseUrl };
}

function stripSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
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
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
