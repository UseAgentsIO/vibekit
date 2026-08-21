import {
  applyInstall,
  formatModuleId,
  isModuleType,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  type ModuleType,
} from "../internal/core/index.js";

import { resolveRegistrySelection } from "../paths.js";

export interface InstallModuleResult {
  readonly id: string;
  readonly created: readonly string[];
  readonly alreadyInstalled: boolean;
}

/** @deprecated Use installRegistryModule. */
export const installOfficialModule = installRegistryModule;

export function installRegistryModule(input: {
  readonly projectRoot: string;
  readonly type: string;
  readonly name: string;
  readonly registry?: string;
}): InstallModuleResult {
  if (!isModuleType(input.type)) {
    return { id: `${input.type}:${input.name}`, created: [], alreadyInstalled: false };
  }
  const { registry, source } = resolveRegistrySelection(input.registry);
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
    registrySource: source,
  });
  const result = applyInstall({ projectRoot: input.projectRoot, plan });
  return { id, created: result.created, alreadyInstalled: false };
}
