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

export const WEB_FETCH_CAPABILITY = "web.fetch";
export const WEB_SEARCH_CAPABILITY = "web.search";

export const DEFAULT_SEARCH_SECRETS = ["TAVILY_API_KEY", "BRAVE_API_KEY"] as const;
export const MAX_DOWNLOAD_BYTES = 1_000_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
