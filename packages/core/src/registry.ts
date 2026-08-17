import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import semver from "semver";

import { VibeKitError } from "./errors.js";
import { isModuleType, parseModuleId, type ModuleId } from "./ids.js";
import {
  isAgentDocument,
  loadedModuleFromDocument,
  type LoadedModule,
} from "./module.js";
import type { AgentDocument, CompatibilityDeclaration, ComponentDocument } from "./types.js";
import { parseAndValidateYaml } from "./validate.js";

export interface RegistryIndexEntry {
  readonly id: ModuleId;
  readonly version: string;
  readonly checksum: string;
  readonly compatibility: CompatibilityDeclaration;
  readonly path: string;
}

export interface RegistryIndex {
  readonly schemaVersion: 1;
  readonly modules: readonly RegistryIndexEntry[];
}

export interface Registry {
  readonly root: string;
  readonly index: RegistryIndex;
}

export function defaultRegistryRoot(): string {
  const fromEnv = process.env.VIBEKIT_REGISTRY;
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, "../../../registry");
  if (fs.existsSync(path.join(candidate, "index.json"))) {
    return candidate;
  }
  throw new VibeKitError({
    category: "unavailable",
    code: "registry_not_found",
    message: "Unable to locate the official VibeKit registry",
    details: { candidate },
  });
}

export function loadRegistry(root: string): Registry {
  const resolved = path.resolve(root);
  const indexPath = path.join(resolved, "index.json");
  if (!fs.existsSync(indexPath)) {
    throw new VibeKitError({
      category: "unavailable",
      code: "registry_index_missing",
      message: `Registry index not found at ${indexPath}`,
      details: { root: resolved },
    });
  }
  const raw = fs.readFileSync(indexPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "registry_index_invalid",
      message: error instanceof Error ? error.message : "Registry index is not valid JSON",
      details: { root: resolved },
    });
  }
  const index = parseRegistryIndex(parsed);
  return { root: resolved, index };
}

export function loadModuleDocument(
  moduleDir: string,
): ComponentDocument | AgentDocument {
  const modulePath = path.join(moduleDir, "module.yaml");
  if (!fs.existsSync(modulePath)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_yaml_missing",
      message: `module.yaml is missing in ${moduleDir}`,
      details: { moduleDir },
    });
  }
  const text = fs.readFileSync(modulePath, "utf8");
  const generic = parseAndValidateYaml("module", text);
  if (!generic.valid || generic.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_yaml_invalid",
      message: generic.errors[0]?.message ?? "module.yaml is invalid",
      details: { moduleDir, errors: generic.errors },
    });
  }
  const kind = generic.data.type === "agent" ? "agent" : "component";
  const result = parseAndValidateYaml(kind, text);
  if (!result.valid || result.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_yaml_invalid",
      message: result.errors[0]?.message ?? "module.yaml is invalid",
      details: { moduleDir, kind, errors: result.errors },
    });
  }
  return result.data;
}

export function loadModuleFromDirectory(
  registryRoot: string,
  moduleDir: string,
  checksum?: string,
): LoadedModule {
  const document = loadModuleDocument(moduleDir);
  const registryPath = path.relative(registryRoot, moduleDir).split(path.sep).join("/");
  return loadedModuleFromDocument(document, {
    registryPath,
    absolutePath: path.resolve(moduleDir),
    checksum,
  });
}

export function resolveModule(
  registry: Registry,
  id: string,
  version?: string,
): LoadedModule {
  parseModuleId(id);
  const matches = registry.index.modules.filter((entry) => entry.id === id);
  if (matches.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "module_not_found",
      message: `Module ${id} is not in the registry`,
      details: { id },
    });
  }
  const selected = version
    ? matches.find((entry) => entry.version === version)
    : highestVersion(matches);
  if (selected === undefined) {
    throw new VibeKitError({
      category: "unavailable",
      code: "module_version_not_found",
      message: `Module ${id}@${version} is not in the registry`,
      details: { id, version },
    });
  }
  const moduleDir = path.join(registry.root, selected.path);
  return loadModuleFromDirectory(registry.root, moduleDir, selected.checksum);
}

export function listRegistryModules(registry: Registry): readonly RegistryIndexEntry[] {
  return registry.index.modules;
}

export function findModuleDirs(registryRoot: string): string[] {
  const dirs: string[] = [];
  const componentsRoot = path.join(registryRoot, "components");
  const agentsRoot = path.join(registryRoot, "agents");
  if (fs.existsSync(componentsRoot)) {
    for (const typeName of fs.readdirSync(componentsRoot)) {
      if (!isModuleType(typeName) || typeName === "agent") {
        continue;
      }
      const typeDir = path.join(componentsRoot, typeName);
      if (!fs.statSync(typeDir).isDirectory()) {
        continue;
      }
      for (const name of fs.readdirSync(typeDir)) {
        const nameDir = path.join(typeDir, name);
        if (!fs.statSync(nameDir).isDirectory()) {
          continue;
        }
        for (const version of fs.readdirSync(nameDir)) {
          const versionDir = path.join(nameDir, version);
          if (fs.existsSync(path.join(versionDir, "module.yaml"))) {
            dirs.push(versionDir);
          }
        }
      }
    }
  }
  if (fs.existsSync(agentsRoot)) {
    for (const name of fs.readdirSync(agentsRoot)) {
      const nameDir = path.join(agentsRoot, name);
      if (!fs.statSync(nameDir).isDirectory()) {
        continue;
      }
      for (const version of fs.readdirSync(nameDir)) {
        const versionDir = path.join(nameDir, version);
        if (fs.existsSync(path.join(versionDir, "module.yaml"))) {
          dirs.push(versionDir);
        }
      }
    }
  }
  return dirs.sort((left, right) => left.localeCompare(right));
}

function highestVersion(entries: readonly RegistryIndexEntry[]): RegistryIndexEntry | undefined {
  return [...entries].sort((left, right) => semver.rcompare(left.version, right.version))[0];
}

function parseRegistryIndex(value: unknown): RegistryIndex {
  if (value === null || typeof value !== "object") {
    throw new VibeKitError({
      category: "invalid_input",
      code: "registry_index_invalid",
      message: "Registry index must be an object",
    });
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "registry_index_invalid",
      message: "Registry index schemaVersion must be 1",
    });
  }
  if (!Array.isArray(record.modules)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "registry_index_invalid",
      message: "Registry index must include a modules array",
    });
  }
  const modules: RegistryIndexEntry[] = record.modules.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${index} is invalid`,
      });
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string") {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${index} is missing id`,
      });
    }
    parseModuleId(item.id);
    if (typeof item.version !== "string" || typeof item.checksum !== "string") {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${item.id} is missing version or checksum`,
      });
    }
    if (typeof item.path !== "string" || item.path.includes("..") || path.isAbsolute(item.path)) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${item.id} has an unsafe path`,
      });
    }
    if (item.compatibility === null || typeof item.compatibility !== "object") {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${item.id} is missing compatibility`,
      });
    }
    const compatibility = item.compatibility as Record<string, unknown>;
    if (typeof compatibility.vibekit !== "string" || typeof compatibility.pi !== "string") {
      throw new VibeKitError({
        category: "invalid_input",
        code: "registry_index_invalid",
        message: `Registry index entry ${item.id} has invalid compatibility`,
      });
    }
    return {
      id: item.id as ModuleId,
      version: item.version,
      checksum: item.checksum,
      path: item.path,
      compatibility: {
        vibekit: compatibility.vibekit,
        pi: compatibility.pi,
        ...(typeof compatibility.node === "string" ? { node: compatibility.node } : {}),
      },
    };
  });
  return { schemaVersion: 1, modules };
}

export function assertModulePayload(module: LoadedModule): void {
  for (const file of module.files) {
    const sourceAbs = path.join(module.absolutePath, file.source);
    if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_payload_missing",
        message: `Module ${module.id} is missing payload file ${file.source}`,
        details: { id: module.id, source: file.source },
      });
    }
  }
  if (module.configuration) {
    const schemaAbs = path.join(module.absolutePath, module.configuration.schema);
    if (!fs.existsSync(schemaAbs)) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "module_config_schema_missing",
        message: `Module ${module.id} is missing ${module.configuration.schema}`,
        details: { id: module.id, schema: module.configuration.schema },
      });
    }
  }
  if (isAgentDocument(module.document)) {
    const instructions = path.join(module.absolutePath, "payload", "instructions.md");
    const agentYaml = path.join(module.absolutePath, "payload", "agent.yaml");
    if (!fs.existsSync(instructions) || !fs.existsSync(agentYaml)) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "agent_payload_missing",
        message: `Agent ${module.id} must include payload/agent.yaml and payload/instructions.md`,
        details: { id: module.id },
      });
    }
  }
}
