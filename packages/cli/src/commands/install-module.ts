import {
  applyInstall,
  formatModuleId,
  isModuleType,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  type ModuleType,
} from "@useagentsio/core";

import { resolveRegistry } from "../paths.js";

export interface InstallModuleResult {
  readonly id: string;
  readonly created: readonly string[];
  readonly alreadyInstalled: boolean;
}

export function installOfficialModule(input: {
  readonly projectRoot: string;
  readonly type: string;
  readonly name: string;
  readonly registry?: string;
}): InstallModuleResult {
  if (!isModuleType(input.type)) {
    return { id: `${input.type}:${input.name}`, created: [], alreadyInstalled: false };
  }
  const registry = resolveRegistry(input.registry);
  const project = readProjectDocument(input.projectRoot);
  const manifest = readInstalledManifest(input.projectRoot);
  const id = formatModuleId(input.type as ModuleType, input.name);
  if (manifest.modules.some((module) => module.id === id)) {
    return { id, created: [], alreadyInstalled: true };
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
  return { id, created: result.created, alreadyInstalled: false };
}
