import fs from "node:fs";
import path from "node:path";

import { VibeKitError } from "./errors.js";
import { assertFileTarget } from "./file-targets.js";

export function safeResolve(root: string, target: string): string {
  assertFileTarget(target);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "file_target_escape",
      message: `File target "${target}" escapes the project root`,
      details: { target, root: resolvedRoot },
    });
  }
  if (fs.existsSync(resolved)) {
    let realRoot = resolvedRoot;
    let realTarget = resolved;
    try {
      realRoot = fs.realpathSync(resolvedRoot);
    } catch {
      realRoot = resolvedRoot;
    }
    try {
      realTarget = fs.realpathSync(resolved);
    } catch {
      realTarget = resolved;
    }
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "file_target_symlink_escape",
        message: `File target "${target}" escapes the project root through a symlink`,
        details: { target, root: resolvedRoot },
      });
    }
  }
  return resolved;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
