import {
  applyInstall,
  formatModuleId,
  isModuleType,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  type ModuleType,
} from "@useagentsio/core";

import type { OutputBuffer } from "../output.js";
import { resolveRegistry } from "../paths.js";

export function installOfficialModule(input: {
  readonly projectRoot: string;
  readonly type: string;
  readonly name: string;
  readonly registry?: string;
  readonly out: OutputBuffer;
}): void {
  if (!isModuleType(input.type)) {
    return;
  }
  const registry = resolveRegistry(input.registry);
  const project = readProjectDocument(input.projectRoot);
  const manifest = readInstalledManifest(input.projectRoot);
  const id = formatModuleId(input.type as ModuleType, input.name);
  if (manifest.modules.some((module) => module.id === id)) {
    input.out.log(`Already installed: ${id}`);
    return;
  }
  const plan = planInstall({
    projectRoot: input.projectRoot,
    registry,
    roots: [id],
    project,
    manifest,
    registrySource: "official",
  });
  const result = applyInstall({ projectRoot: input.projectRoot, plan });
  input.out.log(`Installed ${id}`);
  for (const file of result.created) {
    input.out.log(`  ${file}`);
  }
}
