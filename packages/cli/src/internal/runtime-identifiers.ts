/**
 * Runtime implementations shipped by the VibeKit product. Registry metadata
 * uses these identifiers instead of npm package names so a generated Project
 * can remain definitions-only while the installed product owns the runtime.
 */
export const PRODUCT_RUNTIME_IDS = {
  core: "vibekit:core",
  host: "vibekit:host",
  pi: "vibekit:pi",
  interfaceSdk: "vibekit:interface-sdk",
  interfaceHttp: "vibekit:interface-http",
  interfaceWebhook: "vibekit:interface-webhook",
  interfaceSchedule: "vibekit:interface-schedule",
  interfaceSlack: "vibekit:interface-slack",
  interfaceTelegram: "vibekit:interface-telegram",
  interfaceTerminal: "vibekit:interface-terminal",
  schedule: "vibekit:schedule",
  stateMemory: "vibekit:state-memory",
  toolBrowser: "vibekit:tool-browser",
  toolGithub: "vibekit:tool-github",
  toolMcp: "vibekit:tool-mcp",
  toolProcess: "vibekit:tool-process",
  toolScheduler: "vibekit:tool-scheduler",
  toolWeb: "vibekit:tool-web",
  verifierSchema: "vibekit:verifier-schema",
} as const;

export type ProductRuntimeId = (typeof PRODUCT_RUNTIME_IDS)[keyof typeof PRODUCT_RUNTIME_IDS];

const INTERNAL_RUNTIME_PATHS: Readonly<Record<ProductRuntimeId, string>> = {
  [PRODUCT_RUNTIME_IDS.core]: "./core/index.js",
  [PRODUCT_RUNTIME_IDS.host]: "./host/index.js",
  [PRODUCT_RUNTIME_IDS.pi]: "./pi/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceSdk]: "./interfaces/sdk/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceHttp]: "./interfaces/http/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceWebhook]: "./interfaces/webhook/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceSchedule]: "./interfaces/schedule/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceSlack]: "./interfaces/slack/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceTelegram]: "./interfaces/telegram/index.js",
  [PRODUCT_RUNTIME_IDS.interfaceTerminal]: "./interfaces/terminal/index.js",
  [PRODUCT_RUNTIME_IDS.schedule]: "./schedule/index.js",
  [PRODUCT_RUNTIME_IDS.stateMemory]: "./state/memory/index.js",
  [PRODUCT_RUNTIME_IDS.toolBrowser]: "./tools/browser/index.js",
  [PRODUCT_RUNTIME_IDS.toolGithub]: "./tools/github/index.js",
  [PRODUCT_RUNTIME_IDS.toolMcp]: "./tools/mcp/index.js",
  [PRODUCT_RUNTIME_IDS.toolProcess]: "./tools/process/index.js",
  [PRODUCT_RUNTIME_IDS.toolScheduler]: "./tools/scheduler/index.js",
  [PRODUCT_RUNTIME_IDS.toolWeb]: "./tools/web/index.js",
  [PRODUCT_RUNTIME_IDS.verifierSchema]: "./verifiers/schema/index.js",
};

const LEGACY_PACKAGE_TO_INTERNAL: Readonly<Record<string, ProductRuntimeId>> = {
  "@useagentsio/core": PRODUCT_RUNTIME_IDS.core,
  "@useagentsio/host": PRODUCT_RUNTIME_IDS.host,
  "@useagentsio/pi": PRODUCT_RUNTIME_IDS.pi,
  "@useagentsio/interface-sdk": PRODUCT_RUNTIME_IDS.interfaceSdk,
  "@useagentsio/interface-http": PRODUCT_RUNTIME_IDS.interfaceHttp,
  "@useagentsio/interface-webhook": PRODUCT_RUNTIME_IDS.interfaceWebhook,
  "@useagentsio/interface-schedule": PRODUCT_RUNTIME_IDS.interfaceSchedule,
  "@useagentsio/interface-slack": PRODUCT_RUNTIME_IDS.interfaceSlack,
  "@useagentsio/interface-telegram": PRODUCT_RUNTIME_IDS.interfaceTelegram,
  "@useagentsio/interface-terminal": PRODUCT_RUNTIME_IDS.interfaceTerminal,
  "@useagentsio/schedule-core": PRODUCT_RUNTIME_IDS.schedule,
  "@useagentsio/state-memory": PRODUCT_RUNTIME_IDS.stateMemory,
  "@useagentsio/tool-browser": PRODUCT_RUNTIME_IDS.toolBrowser,
  "@useagentsio/tool-github": PRODUCT_RUNTIME_IDS.toolGithub,
  "@useagentsio/tool-mcp": PRODUCT_RUNTIME_IDS.toolMcp,
  "@useagentsio/tool-process": PRODUCT_RUNTIME_IDS.toolProcess,
  "@useagentsio/tool-scheduler": PRODUCT_RUNTIME_IDS.toolScheduler,
  "@useagentsio/tool-web": PRODUCT_RUNTIME_IDS.toolWeb,
  "@useagentsio/verifier-schema": PRODUCT_RUNTIME_IDS.verifierSchema,
};

export function productRuntimeId(specifier: string): ProductRuntimeId | undefined {
  if (Object.prototype.hasOwnProperty.call(INTERNAL_RUNTIME_PATHS, specifier)) {
    return specifier as ProductRuntimeId;
  }
  return LEGACY_PACKAGE_TO_INTERNAL[specifier];
}

export function isProductRuntimePackage(specifier: string): boolean {
  return productRuntimeId(specifier) !== undefined;
}

export function omitProductRuntimeDependencies(
  dependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([name]) => !isProductRuntimePackage(name)),
  );
}

export function internalRuntimeUrl(specifier: string): URL | undefined {
  const id = productRuntimeId(specifier);
  if (id === undefined) return undefined;
  return new URL(INTERNAL_RUNTIME_PATHS[id], import.meta.url);
}

export async function importProductRuntime(
  specifier: string,
): Promise<Record<string, unknown> | undefined> {
  const url = internalRuntimeUrl(specifier);
  if (url === undefined) return undefined;
  try {
    return (await import(url.href)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
