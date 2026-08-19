import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checksumDirectory,
  findModuleDirs,
  loadModuleFromDirectory,
  stringifyYaml,
  writeRegistryIndex,
} from "@useagentsio/core";

const here = path.dirname(fileURLToPath(import.meta.url));

export const fixturesDir = path.resolve(here, "../fixtures");
export const officialRegistryDir = path.resolve(here, "../registry");

export function readFixture(kind: "valid" | "invalid", name: string): string {
  return fs.readFileSync(path.join(fixturesDir, kind, name), "utf8");
}

export function makeTempDir(prefix = "vibekit-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface SyntheticComponentOptions {
  readonly type: "provider" | "tool" | "skill" | "interface" | "state" | "policy" | "verifier";
  readonly name: string;
  readonly version?: string;
  readonly required?: string[];
  readonly optional?: string[];
  readonly recommended?: string[];
  readonly conflicts?: string[];
  readonly capabilities?: string[];
  readonly permissions?: string[];
  readonly files?: Array<{ source: string; target: string; ownership?: "exclusive" | "generated" }>;
  readonly payload?: string;
  readonly runtime?: {
    readonly kind: "interface" | "pi-builtin" | "pi-extension" | "package" | "config-only";
    readonly package?: string;
    readonly export?: string;
    readonly lifecycle?: "singleton";
    readonly tools?: readonly string[];
    readonly available?: boolean;
  };
  readonly packages?: { readonly dependencies?: Readonly<Record<string, string>> };
}

export function writeSyntheticComponent(
  registryRoot: string,
  options: SyntheticComponentOptions,
): string {
  const version = options.version ?? "1.0.0";
  const dir = path.join(registryRoot, "components", options.type, options.name, version);
  fs.mkdirSync(path.join(dir, "payload"), { recursive: true });
  const files = options.files ?? [
    {
      source: "payload/index.txt",
      target: `.vibekit/components/${options.type}/${options.name}.txt`,
      ownership: "exclusive" as const,
    },
  ];
  const payload = options.payload ?? `${options.type}:${options.name}\n`;
  for (const file of files) {
    const abs = path.join(dir, file.source);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, payload, "utf8");
    }
  }
  const document = {
    schemaVersion: 1,
    id: `${options.type}:${options.name}`,
    type: options.type,
    name: options.name,
    version,
    description: `Synthetic ${options.type}:${options.name}`,
    compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0", node: ">=20" },
    source: { repository: "https://github.com/UseAgentsIO/vibekit", revision: "test" },
    license: "MIT",
    providesCapabilities: options.capabilities ?? [],
    requires: {
      required: options.required ?? [],
      optional: options.optional ?? [],
      recommended: options.recommended ?? [],
      conflicts: options.conflicts ?? [],
    },
    requestsPermissions: (options.permissions ?? []).map((capability) => ({ capability })),
    secrets: [],
    files: files.map((file) => ({
      source: file.source,
      target: file.target,
      ownership: file.ownership ?? "exclusive",
    })),
    configuration: {
      target: `.vibekit/config/${options.type}/${options.name}.yaml`,
      schema: "config.schema.json",
    },
    ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
    ...(options.packages !== undefined ? { packages: options.packages } : {}),
  };
  fs.writeFileSync(path.join(dir, "module.yaml"), stringifyYaml(document), "utf8");
  fs.writeFileSync(
    path.join(dir, "config.schema.json"),
    `${JSON.stringify({ type: "object", additionalProperties: false, properties: {} }, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

export function buildTempRegistry(
  components: SyntheticComponentOptions[],
  options?: { readonly allowMissingDeps?: boolean },
): string {
  const root = makeTempDir("vibekit-registry-");
  for (const component of components) {
    writeSyntheticComponent(root, component);
  }
  if (options?.allowMissingDeps) {
    writeUncheckedRegistryIndex(root);
  } else {
    writeRegistryIndex(root);
  }
  return root;
}

export function writeUncheckedRegistryIndex(registryRoot: string): void {
  const dirs = findModuleDirs(registryRoot);
  const modules = dirs.map((dir) => {
    const checksum = checksumDirectory(dir);
    const loaded = loadModuleFromDirectory(registryRoot, dir, checksum);
    return {
      id: loaded.id,
      version: loaded.version,
      checksum,
      compatibility: loaded.compatibility ?? { vibekit: "^1.0.0", pi: ">=0.50.0" },
      path: path.relative(registryRoot, dir).split(path.sep).join("/"),
    };
  });
  fs.writeFileSync(
    path.join(registryRoot, "index.json"),
    `${JSON.stringify({ schemaVersion: 1, modules }, null, 2)}\n`,
    "utf8",
  );
}
