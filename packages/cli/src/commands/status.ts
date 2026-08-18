import fs from "node:fs";
import path from "node:path";

import { readProjectDocument } from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export function runStatus(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const projectRoot = resolveProjectDir(flags.dir);
  const project = readProjectDocument(projectRoot);
  const statusPath = path.join(projectRoot, ".vibekit/runtime/host-status.json");
  out.log(`Project: ${project.id}`);
  out.log(`Default agent: ${project.defaultAgent ?? "(none)"}`);
  const bindings = Object.entries(project.interfaceBindings ?? {});
  if (bindings.length === 0) {
    out.log("Interfaces: (none)");
  } else {
    out.log("Interfaces:");
    for (const [name, binding] of bindings) {
      out.log(`  ${name}: ${binding.definition} -> ${binding.defaultAgent} (${binding.enabled ? "enabled" : "disabled"})`);
    }
  }
  if (!fs.existsSync(statusPath)) {
    out.log("Host: stopped");
    return 0;
  }
  const status = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
    ready?: boolean;
    pid?: number;
  };
  out.log(`Host: ${status.ready === true ? "ready" : "not ready"} (pid ${status.pid ?? "?"})`);
  return 0;
}
