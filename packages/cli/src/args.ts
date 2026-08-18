import { parseArgs } from "node:util";

import { VibeKitError } from "@useagentsio/core";

export interface GlobalFlags {
  readonly yes: boolean;
  readonly registry?: string;
  readonly dir?: string;
  readonly help: boolean;
  readonly version: boolean;
}

export interface ParsedCli {
  readonly command?: string;
  readonly positionals: string[];
  readonly flags: GlobalFlags;
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
        registry: { type: "string" },
        dir: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
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
      registry: parsed.values.registry,
      dir: parsed.values.dir,
      help: parsed.values.help === true,
      version: parsed.values.version === true,
    },
  };
}
