import { VibeKitError, isVibeKitError } from "@vibekit/core";

import { USAGE, parseCliArgs } from "./args.js";
import { runAdd } from "./commands/add.js";
import { runDiff } from "./commands/diff.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";
import { runRemove } from "./commands/remove.js";
import { runUpdate } from "./commands/update.js";
import { OutputBuffer, type CliResult } from "./output.js";

export type { CliResult } from "./output.js";

const PHASE3_USAGE = `  vibekit diff <type:name> [--registry <path>] [--dir <path>]
  vibekit update <type:name> [--yes] [--registry <path>] [--dir <path>]
  vibekit remove <type:name> [--yes] [--registry <path>] [--dir <path>]
`;

function usageText(): string {
  return `${USAGE.trimEnd()}\n${PHASE3_USAGE}`;
}

export function runCli(argv: string[]): CliResult {
  const out = new OutputBuffer();
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.flags.help || parsed.command === undefined) {
      out.log(usageText());
      return { exitCode: parsed.command === undefined && !parsed.flags.help ? 1 : 0, stdout: out.stdout, stderr: out.stderr };
    }
    let exitCode = 0;
    switch (parsed.command) {
      case "init":
        exitCode = runInit(parsed.positionals, parsed.flags, out);
        break;
      case "add":
        exitCode = runAdd(parsed.positionals, parsed.flags, out);
        break;
      case "list":
        exitCode = runList(parsed.flags, out);
        break;
      case "diff":
        exitCode = runDiff(parsed.positionals, parsed.flags, out);
        break;
      case "update":
        exitCode = runUpdate(parsed.positionals, parsed.flags, out);
        break;
      case "remove":
        exitCode = runRemove(parsed.positionals, parsed.flags, out);
        break;
      case "doctor":
        exitCode = runDoctorCommand(parsed.flags, out);
        break;
      default:
        throw new VibeKitError({
          category: "invalid_input",
          code: "unknown_command",
          message: `Unknown command "${parsed.command}"\n${usageText()}`,
        });
    }
    return { exitCode, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    if (isVibeKitError(error)) {
      out.error(`${error.code}: ${error.message}`);
      return { exitCode: 1, stdout: out.stdout, stderr: out.stderr };
    }
    const message = error instanceof Error ? error.message : String(error);
    out.error(message);
    return { exitCode: 1, stdout: out.stdout, stderr: out.stderr };
  }
}
