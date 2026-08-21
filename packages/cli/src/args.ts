import { parseArgs } from "node:util";

import { VibeKitError } from "./internal/core/index.js";

export interface GlobalFlags {
  readonly yes: boolean;
  readonly fix: boolean;
  readonly registry?: string;
  readonly dir?: string;
  readonly help: boolean;
  readonly version: boolean;
  readonly agents: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly interface?: string;
  readonly example?: string;
  readonly customize: boolean;
  readonly service: boolean;
  readonly foreground: boolean;
  readonly live: boolean;
  readonly skipInstall: boolean;
  readonly defaults: boolean;
  readonly verbose: boolean;
  readonly showFiles: boolean;
  readonly skills: readonly string[];
  readonly tools: readonly string[];
  readonly policies: readonly string[];
  readonly port?: number;
}

export interface ParsedCli {
  readonly command?: string;
  readonly positionals: string[];
  readonly flags: GlobalFlags;
}

export function hasSetupFlags(flags: GlobalFlags): boolean {
  return (
    flags.provider !== undefined ||
    flags.model !== undefined ||
    flags.agents.length > 0 ||
    flags.interface !== undefined ||
    flags.skills.length > 0 ||
    flags.tools.length > 0 ||
    flags.policies.length > 0 ||
    flags.customize
  );
}

export function parseCliArgs(argv: string[]): ParsedCli {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        yes: { type: "boolean", short: "y", default: false },
        fix: { type: "boolean", default: false },
        registry: { type: "string" },
        dir: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        agent: { type: "string", multiple: true },
        provider: { type: "string" },
        model: { type: "string" },
        interface: { type: "string" },
        example: { type: "string" },
        customize: { type: "boolean", default: false },
        service: { type: "boolean", default: false },
        foreground: { type: "boolean", short: "f", default: false },
        live: { type: "boolean", default: false },
        "skip-install": { type: "boolean", default: false },
        defaults: { type: "boolean", short: "d", default: false },
        verbose: { type: "boolean", default: false },
        "show-files": { type: "boolean", default: false },
        skill: { type: "string", multiple: true },
        tool: { type: "string", multiple: true },
        policy: { type: "string", multiple: true },
        port: { type: "string" },
      },
    });
  } catch (error) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "cli_args_invalid",
      message: error instanceof Error ? error.message : "Invalid CLI arguments",
    });
  }

  const [command, ...positionals] = parsed.positionals;
  return {
    command,
    positionals,
    flags: {
      yes: parsed.values.yes === true,
      fix: parsed.values.fix === true,
      registry: parsed.values.registry,
      dir: parsed.values.dir,
      help: parsed.values.help === true,
      version: parsed.values.version === true,
      agents: parsed.values.agent ?? [],
      provider: parsed.values.provider,
      model: parsed.values.model,
      interface: parsed.values.interface,
      example: parsed.values.example,
      customize: parsed.values.customize === true,
      service: parsed.values.service === true,
      foreground: parsed.values.foreground === true,
      live: parsed.values.live === true,
      skipInstall: parsed.values["skip-install"] === true,
      defaults: parsed.values.defaults === true,
      verbose: parsed.values.verbose === true,
      showFiles: parsed.values["show-files"] === true,
      skills: parsed.values.skill ?? [],
      tools: parsed.values.tool ?? [],
      policies: parsed.values.policy ?? [],
      port: parsePort(parsed.values.port),
    },
  };
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new VibeKitError({ category: "invalid_input", code: "gateway_port_invalid", message: `Invalid port: ${value}` });
  }
  return port;
}
