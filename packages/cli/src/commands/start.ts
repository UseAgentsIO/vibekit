import { VibeKitHost } from "@useagentsio/host";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";
import { ensureInstalledSecrets } from "../secrets.js";

export async function runStart(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  const registry = resolveRegistry(flags.registry);
  await ensureInstalledSecrets({
    projectRoot,
    registry,
    yes: flags.yes,
    out,
  });
  const host = await VibeKitHost.start({
    projectRoot,
    startInterfaces: true,
    env: process.env,
  });

  const enabled = Object.entries(host.project.interfaceBindings ?? {}).filter(
    ([, binding]) => binding.enabled,
  );
  const bindings = enabled.map(([name, binding]) => `${name} (${binding.definition})`);

  out.log(`VibeKit is running.`);
  out.log(`Project: ${host.project.id}`);
  out.log(`Interfaces: ${bindings.length > 0 ? bindings.join(", ") : "none"}`);
  if (enabled.some(([, binding]) => binding.definition === "interface:telegram")) {
    out.log(`Telegram: message the bot, then run vibekit approve-pairing <code> if prompted.`);
  }
  if (enabled.some(([, binding]) => binding.definition === "interface:terminal")) {
    out.log(`Type a message in this terminal. Use exit to quit.`);
  }

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void host.stop().then(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
}
