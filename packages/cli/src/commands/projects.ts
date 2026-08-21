import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { locateProject, readProjectRegistry, registerProject, unregisterProject } from "../project-registry.js";

export async function runProjects(positionals: readonly string[], _flags: GlobalFlags, out: OutputBuffer): Promise<number> {
  const [action, value, extra] = positionals;
  if (action === "add" && value !== undefined) {
    const entry = registerProject(value);
    out.log(`Registered ${entry.projectId}`); out.log(entry.path); return 0;
  }
  if (action === "list") {
    const entries = readProjectRegistry();
    if (entries.length === 0) out.log("No Projects registered.");
    for (const entry of entries) out.log(`${entry.projectId}\t${entry.path}`);
    return 0;
  }
  if (action === "remove" && value !== undefined) {
    const entry = await unregisterProject(value); out.log(`Unregistered ${entry.projectId}. Project files were not changed.`); return 0;
  }
  if (action === "locate" && value !== undefined && extra !== undefined) {
    const entry = locateProject(value, extra); out.log(`Located ${entry.projectId} at ${entry.path}`); return 0;
  }
  out.error("Usage: vibekit projects add <path> | list | remove <project-id> | locate <project-id> <path>");
  return 1;
}
