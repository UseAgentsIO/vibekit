import { createTerminalInterface } from "@useagentsio/interface-terminal";
import { VibeKitHost } from "@useagentsio/host";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export async function runStart(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  const host = await VibeKitHost.start({
    projectRoot,
    startInterfaces: true,
    env: process.env,
    factories: {
      "interface:terminal": { create: createTerminalInterface },
    },
  });

  out.log(`VibeKit is running.`);
  out.log(`Project: ${host.project.id}`);
  out.log(`Interface: terminal`);
  out.log(`Type a message in this terminal. Use exit to quit.`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void host.stop().then(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
}
