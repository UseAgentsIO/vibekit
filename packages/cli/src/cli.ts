import { VibeKitError, isVibeKitError } from "@useagentsio/core";

import { parseCliArgs } from "./args.js";
import { runAdd } from "./commands/add.js";
import { runCreate } from "./commands/create.js";
import { runDiff } from "./commands/diff.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";
import { runMigrate } from "./commands/migrate.js";
import { runModel } from "./commands/model.js";
import { runMsg } from "./commands/msg.js";
import { runRemove } from "./commands/remove.js";
import { runStart } from "./commands/start.js";
import { runStatus } from "./commands/status.js";
import { runUpdate } from "./commands/update.js";
import {
  cliVersion,
  findCommand,
  formatCommandHelp,
  formatRootHelp,
  formatUnknownCommand,
} from "./help.js";
import { OutputBuffer, type CliResult } from "./output.js";

export type { CliResult } from "./output.js";

function writeHelp(out: OutputBuffer, commandName: string | undefined): number {
  if (!commandName) {
    out.log(formatRootHelp());
    return 0;
  }
  const command = findCommand(commandName);
  if (!command || command.name === "help") {
    out.error(formatUnknownCommand(commandName));
    return 1;
  }
  out.log(formatCommandHelp(command));
  return 0;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const out = new OutputBuffer();
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.flags.version) {
      out.log(cliVersion());
      return { exitCode: 0, stdout: out.stdout, stderr: out.stderr };
    }
    if (parsed.command === "help") {
      const exitCode = writeHelp(out, parsed.positionals[0]);
      return { exitCode, stdout: out.stdout, stderr: out.stderr };
    }
    if (parsed.flags.help) {
      const exitCode = writeHelp(out, parsed.command);
      return { exitCode, stdout: out.stdout, stderr: out.stderr };
    }
    if (parsed.command === undefined) {
      out.log(formatRootHelp());
      return { exitCode: 1, stdout: out.stdout, stderr: out.stderr };
    }

    let exitCode = 0;
    switch (parsed.command) {
      case "create":
        exitCode = await runCreate(parsed.positionals, parsed.flags, out);
        break;
      case "model":
        exitCode = await runModel(parsed.positionals, parsed.flags, out);
        break;
      case "msg":
        exitCode = await runMsg(parsed.positionals, parsed.flags, out);
        break;
      case "start":
        exitCode = await runStart(parsed.positionals, parsed.flags, out);
        break;
      case "status":
        exitCode = runStatus(parsed.positionals, parsed.flags, out);
        break;
      case "migrate":
        exitCode = runMigrate(parsed.positionals, parsed.flags, out);
        break;
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
          message: formatUnknownCommand(parsed.command),
        });
    }
    return { exitCode, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    if (isVibeKitError(error)) {
      out.error(error.message.includes("\n") ? error.message : `${error.code}: ${error.message}`);
      return { exitCode: 1, stdout: out.stdout, stderr: out.stderr };
    }
    const message = error instanceof Error ? error.message : String(error);
    out.error(message);
    return { exitCode: 1, stdout: out.stdout, stderr: out.stderr };
  }
}
