import path from "node:path";

import type { GlobalFlags } from "../args.js";
import { startGateway } from "../gateway/server.js";
import { controlGatewayService, ensureGatewayRunning, gatewayIsRunning, gatewayServiceDefinition, installGatewayService, openDashboard, readGatewayPort, uninstallGatewayService, writeGatewayPort } from "../gateway/service.js";
import type { OutputBuffer } from "../output.js";

export async function runGateway(positionals: readonly string[], flags: GlobalFlags, out: OutputBuffer): Promise<number> {
  const action = positionals[0];
  const port = flags.port ?? readGatewayPort();
  if (flags.port !== undefined) writeGatewayPort(port);
  const definition = gatewayServiceDefinition({ cliEntry: path.resolve(process.argv[1] ?? "vibekit"), port });
  if (action === "run") {
    const gateway = await startGateway(port);
    out.log(`VibeKit Gateway listening at http://127.0.0.1:${gateway.status.port}`);
    await new Promise<void>((resolve) => {
      const stop = (): void => { void gateway.close().then(resolve); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    });
    return 0;
  }
  if (action === "install") { writeGatewayPort(port); installGatewayService(definition); out.log(`Installed ${definition.platform} login service.`); return 0; }
  if (action === "uninstall") { uninstallGatewayService(definition); out.log("Uninstalled Gateway login service. Project Hosts were not stopped."); return 0; }
  if (action === "start" || action === "stop" || action === "restart") { controlGatewayService(definition, action); out.log(`Gateway ${action} requested. Project Hosts were not changed.`); return 0; }
  if (action === "status") {
    if (await gatewayIsRunning(port)) {
      out.log("Gateway: available");
      return 0;
    }
    out.log("Gateway: stopped");
    return 1;
  }
  out.error("Usage: vibekit gateway install|uninstall|start|stop|restart|status|run"); return 1;
}

export async function runDashboard(_positionals: readonly string[], flags: GlobalFlags, out: OutputBuffer): Promise<number> {
  const port = flags.port ?? readGatewayPort();
  try {
    await ensureGatewayRunning(port);
    openDashboard(port);
    out.log("Opened the VibeKit dashboard.");
    return 0;
  } catch (error) {
    out.error(error instanceof Error ? error.message : "VibeKit could not open the dashboard.");
    return 1;
  }
}
