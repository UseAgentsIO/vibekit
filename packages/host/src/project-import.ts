import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Load a package only from the Project or a caller-provided specifier.
 * Host/core do not declare optional Component packages as dependencies.
 */
export async function importProjectModule(
  projectRoot: string,
  specifier: string,
): Promise<Record<string, unknown> | undefined> {
  const resolved = resolveProjectModule(projectRoot, specifier);
  if (resolved !== undefined) {
    try {
      return (await import(resolved)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function resolveProjectModule(projectRoot: string, specifier: string): string | undefined {
  const roots = [
    path.join(projectRoot, "package.json"),
    path.join(projectRoot, "node_modules", specifier, "package.json"),
  ];
  for (const from of roots) {
    try {
      const resolved = createRequire(from).resolve(specifier);
      return pathToFileURL(resolved).href;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function exportedValue(
  mod: Record<string, unknown> | undefined,
  exportName: string,
): unknown {
  if (mod === undefined) {
    return undefined;
  }
  return mod[exportName];
}
