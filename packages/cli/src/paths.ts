import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultRegistryRoot,
  loadRegistry,
  OFFICIAL_REGISTRY_SOURCE,
  type Registry,
} from "./internal/core/index.js";

export function resolveProjectDir(dir?: string): string {
  return path.resolve(dir ?? process.cwd());
}

export interface ResolvedRegistry {
  readonly registry: Registry;
  readonly source: string;
}

export function resolveRegistrySelection(registryFlag?: string): ResolvedRegistry {
  if (registryFlag) {
    const registry = loadRegistry(path.resolve(registryFlag));
    return { registry, source: registry.source };
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = [
    path.resolve(here, "../registry"),
    path.resolve(here, "../../registry"),
  ].find((candidate) => fs.existsSync(path.join(candidate, "index.json")));
  const registry = loadRegistry(bundled ?? defaultRegistryRoot(), OFFICIAL_REGISTRY_SOURCE);
  return { registry, source: OFFICIAL_REGISTRY_SOURCE };
}

export function resolveRegistry(registryFlag?: string): Registry {
  return resolveRegistrySelection(registryFlag).registry;
}

export function isPiProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".pi"));
}

export function detectPackageManager(dir: string): string | undefined {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(dir, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.existsSync(path.join(dir, "package-lock.json"))) {
    return "npm";
  }
  if (
    fs.existsSync(path.join(dir, "bun.lockb")) ||
    fs.existsSync(path.join(dir, "bun.lock"))
  ) {
    return "bun";
  }
  return undefined;
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "app";
}

export function isWorkspaceRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) &&
    fs.existsSync(path.join(dir, "packages/cli/package.json"))
  );
}
