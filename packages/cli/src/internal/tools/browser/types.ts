export interface ToolContext {
  projectRoot: string;
  config?: Record<string, unknown>;
  resolveSecret?: (name: string) => string;
  grantedCapabilities?: readonly string[];
  fetch?: typeof fetch;
  driver?: BrowserDriver;
  importPlaywright?: () => Promise<unknown>;
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

export interface BrowserSnapshot {
  readonly text: string;
  readonly url?: string;
  readonly title?: string;
  readonly refs?: Readonly<Record<string, string>>;
  readonly untrusted: true;
}

export interface BrowserDriver {
  navigate(url: string): Promise<{ url: string; title?: string }>;
  snapshot(): Promise<BrowserSnapshot>;
  click(target: { selector?: string; ref?: string }): Promise<void>;
  close?(): Promise<void>;
}

export const BROWSER_NAVIGATE_CAPABILITY = "browser.navigate";
export const BROWSER_INTERACT_CAPABILITY = "browser.interact";
