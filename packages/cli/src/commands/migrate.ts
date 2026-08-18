import {
  createDefaultProject,
  readProjectDocument,
  writeProjectDocument,
} from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export function runMigrate(
  _positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const projectRoot = resolveProjectDir(flags.dir);
  const current = readProjectDocument(projectRoot);
  if (current.schemaVersion === 2 && current.host !== undefined && current.defaultAgent !== undefined) {
    out.log("Project is already schemaVersion 2.");
    return 0;
  }
  const defaultAgent =
    current.defaultAgent ??
    (current.agentBindings.chief !== undefined
      ? "chief"
      : Object.keys(current.agentBindings)[0]);
  const defaults = createDefaultProject({
    slug: current.id.replace(/^project:/, ""),
    name: current.name,
    defaultAgent,
  });
  const interfaceBindings =
    current.interfaceBindings !== undefined && Object.keys(current.interfaceBindings).length > 0
      ? current.interfaceBindings
      : defaultAgent === undefined
        ? {}
        : {
            "terminal-main": {
              definition: "interface:terminal" as const,
              enabled: true,
              defaultAgent,
              config: ".vibekit/config/interfaces/terminal-main.yaml",
            },
          };
  const next = {
    ...current,
    schemaVersion: 2 as const,
    runtime: {
      adapter: current.runtime?.adapter ?? "@useagentsio/pi",
      host: current.runtime?.host ?? "@useagentsio/host",
    },
    host: current.host ?? defaults.host,
    interfaceBindings,
    defaultAgent,
    state: {
      ...current.state,
      tracking: {
        conversations: "local" as const,
        ...current.state.tracking,
      },
    },
  };
  writeProjectDocument(projectRoot, next);
  out.log("Migrated Project to schemaVersion 2.");
  out.log("Select a default Agent and Interface with `vibekit create` flags or by editing project.yaml.");
  return 0;
}
