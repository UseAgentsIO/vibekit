import { readProjectDocument } from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import { inspectProject, stopProjectHost } from "../host-control.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export async function runStop(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  const project = readProjectDocument(projectRoot);
  const before = await inspectProject(project.id, projectRoot, "");
  const result = await stopProjectHost(project.id, projectRoot);
  out.log(before.state === "stopped"
    ? "VibeKit is not running. Your Project, State, sessions, and secrets were kept."
    : "VibeKit stopped. Your Project, State, sessions, and secrets were kept.");
  return result.ok ? 0 : 1;
}
