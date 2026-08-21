import { readProjectDocument } from "../internal/core/index.js";
import { VibeKitHost, isHostIpcAvailable } from "../internal/host/index.js";

import type { GlobalFlags } from "../args.js";
import { ensurePersistentAvailability, projectRequiresPersistentAvailability } from "../host-control.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry } from "../paths.js";
import { registerProject } from "../project-registry.js";
import { ensureInstalledSecrets } from "../secrets.js";
import { ensureGatewayRunning, readGatewayPort } from "../gateway/service.js";

export async function runStart(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  const entry = registerProject(projectRoot);
  const project = readProjectDocument(projectRoot);
  const enabled = Object.entries(project.interfaceBindings ?? {}).filter(([, binding]) => binding.enabled);
  const interfaces = enabled.map(([name, binding]) => `${name} (${binding.definition})`);
  const needsPersistentAvailability = projectRequiresPersistentAvailability(project);

  if (await isHostIpcAvailable(projectRoot)) {
    const result = await ensurePersistentAvailability(projectRoot, { ensureGateway: needsPersistentAvailability });
    out.log("VibeKit is already running.");
    printSummary(project.id, result.pid, interfaces, out, flags.verbose);
    return 0;
  }

  await ensureInstalledSecrets({ projectRoot, registry: resolveRegistry(flags.registry), yes: flags.yes, out });
  if (flags.foreground) {
    if (needsPersistentAvailability) await ensureGatewayRunning(readGatewayPort());
    const host = await VibeKitHost.start({ projectRoot, startInterfaces: true, env: process.env });
    out.log("VibeKit is running.");
    printSummary(entry.projectId, process.pid, interfaces, out, flags.verbose);
    if (enabled.some(([, binding]) => binding.definition === "interface:telegram")) {
      out.log("Telegram: message the bot, then run vibekit approve-pairing <code> if prompted.");
    }
    if (enabled.some(([, binding]) => binding.definition === "interface:terminal")) {
      out.log("Type a message in this terminal. Use exit to quit.");
    }
    await new Promise<void>((resolve) => {
      const shutdown = (): void => { void host.stop().then(resolve); };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
    return 0;
  }

  const result = await ensurePersistentAvailability(entry.path, { ensureGateway: needsPersistentAvailability });
  if (!result.ok) {
    out.error(result.error ?? "VibeKit could not start for this Project.");
    return 1;
  }
  out.log("VibeKit started.");
  printSummary(entry.projectId, result.pid, interfaces, out, flags.verbose);
  if (enabled.some(([, binding]) => binding.definition === "interface:telegram")) {
    out.log("Telegram: message the bot, then run vibekit approve-pairing <code> if prompted.");
  }
  return 0;
}

function printSummary(
  projectId: string,
  pid: number | undefined,
  interfaces: readonly string[],
  out: OutputBuffer,
  verbose: boolean,
): void {
  out.log(`Project: ${projectId}`);
  out.log("VibeKit: ready");
  out.log(`Connections: ${interfaces.length > 0 ? interfaces.map(connectionLabel).join(", ") : "none"}`);
  if (verbose) {
    out.log(`Project ID: ${projectId}`);
    out.log(`Process ID: ${pid ?? "?"}`);
  }
}

function connectionLabel(value: string): string {
  const name = value.split(" (")[0] ?? value;
  return name.replace(/-main$/i, "").replace(/(^|[-_])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix === "-" || prefix === "_" ? " " : prefix}${letter.toUpperCase()}`);
}
