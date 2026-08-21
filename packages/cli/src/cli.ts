import fs from "node:fs";
import path from "node:path";

import { VibeKitError, isVibeKitError } from "./internal/core/index.js";

import { parseCliArgs } from "./args.js";
import { runAdd } from "./commands/add.js";
import { runCreate } from "./commands/create.js";
import { runConfig } from "./commands/config.js";
import { runConnect } from "./commands/connect.js";
import { runDiff } from "./commands/diff.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";
import { runMigrate } from "./commands/migrate.js";
import { runModel } from "./commands/model.js";
import { runMsg } from "./commands/msg.js";
import { runRemove } from "./commands/remove.js";
import { runApprovePairing } from "./commands/approve-pairing.js";
import { runStart } from "./commands/start.js";
import { runStatus } from "./commands/status.js";
import { runStop } from "./commands/stop.js";
import { openPrimaryInterface, runSetup } from "./commands/setup.js";
import { runUpdate } from "./commands/update.js";
import { runProjects } from "./commands/projects.js";
import { runDashboard, runGateway } from "./commands/gateway.js";
import {
  cliVersion,
  findCommand,
  formatCommandHelp,
  formatRootHelp,
  formatUnknownCommand,
} from "./help.js";
import { OutputBuffer, type CliResult } from "./output.js";
import { resolveProjectDir } from "./paths.js";
import { releaseTerminal } from "./ui/keys.js";

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
      const projectRoot = resolveProjectDir(parsed.flags.dir);
      const hasProject = fs.existsSync(path.join(projectRoot, ".vibekit", "project.yaml"));
      const exitCode = hasProject
        ? await openPrimaryInterface(projectRoot, parsed.flags, out)
        : await runSetup([], parsed.flags, out, { openInterface: true });
      return { exitCode, stdout: out.stdout, stderr: out.stderr };
    }

    let exitCode = 0;
    switch (parsed.command) {
      case "create":
        exitCode = await runCreate(parsed.positionals, parsed.flags, out);
        break;
      case "project":
        if (parsed.positionals[0] !== "create") {
          throw new VibeKitError({
            category: "invalid_input",
            code: "project_command_invalid",
            message: "Use `vibekit project create [options] [dir]` for the advanced Project builder.",
          });
        }
        exitCode = await runCreate(parsed.positionals.slice(1), parsed.flags, out);
        break;
      case "setup":
        exitCode = await runSetup(parsed.positionals, parsed.flags, out, { openInterface: true });
        break;
      case "config":
        exitCode = await runConfig(parsed.positionals, parsed.flags, out);
        break;
      case "connect":
        exitCode = await runConnect(parsed.positionals, parsed.flags, out);
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
        exitCode = await runStatus(parsed.positionals, parsed.flags, out);
        break;
      case "stop":
        exitCode = await runStop(parsed.positionals, parsed.flags, out);
        break;
      case "projects":
        exitCode = await runProjects(parsed.positionals, parsed.flags, out);
        break;
      case "gateway":
        exitCode = await runGateway(parsed.positionals, parsed.flags, out);
        break;
      case "dashboard":
        exitCode = await runDashboard(parsed.positionals, parsed.flags, out);
        break;
      case "migrate":
        exitCode = runMigrate(parsed.positionals, parsed.flags, out);
        break;
      case "init":
        exitCode = await runInit(parsed.positionals, parsed.flags, out);
        break;
      case "add":
        exitCode = await runAdd(parsed.positionals, parsed.flags, out);
        break;
      case "approve-pairing":
        exitCode = runApprovePairing(parsed.positionals, parsed.flags, out);
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
        exitCode = await runDoctorCommand(parsed.flags, out);
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
  } finally {
    releaseTerminal();
  }
}
