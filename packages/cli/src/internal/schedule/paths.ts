import fs from "node:fs";
import path from "node:path";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;
const URL_SCHEME = /^(?:file|https?|ftp):/i;

export class PathEscapeError extends Error {
  readonly code = "path_escape";

  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

export function assertSafeRelativePath(target: string, label = "path"): void {
  if (typeof target !== "string" || target.length === 0) {
    throw new PathEscapeError(`${label} must be a non-empty relative path`);
  }
  if (target.includes("\0") || target.includes("%00")) {
    throw new PathEscapeError(`${label} must not contain a null byte`);
  }
  if (target.startsWith("/") || target.startsWith("\\")) {
    throw new PathEscapeError(`${label} must not be an absolute path`);
  }
  if (WINDOWS_DRIVE.test(target)) {
    throw new PathEscapeError(`${label} must not be a Windows drive path`);
  }
  if (UNC_PREFIX.test(target) || target.startsWith("//")) {
    throw new PathEscapeError(`${label} must not be a UNC path`);
  }
  if (URL_SCHEME.test(target)) {
    throw new PathEscapeError(`${label} must not use a URL scheme`);
  }
  if (target.startsWith("~")) {
    throw new PathEscapeError(`${label} must not expand a home directory`);
  }
  if (/%2e/i.test(target)) {
    throw new PathEscapeError(`${label} must not contain encoded path segments`);
  }

  const normalized = target.replace(/\\/g, "/");
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new PathEscapeError(`${label} must not contain '..'`);
    }
  }

  const posix = path.posix.normalize(normalized);
  if (posix.startsWith("..") || path.posix.isAbsolute(posix)) {
    throw new PathEscapeError(`${label} must stay inside the project root`);
  }
}

export function resolveInsideProject(projectRoot: string, target: string, label = "path"): string {
  assertSafeRelativePath(target, label);
  const resolvedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(resolvedRoot, target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathEscapeError(`${label} escapes the project root`);
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
      throw new PathEscapeError(`${label} escapes the project root through a symlink`);
    }
    return realTarget;
  }
  return resolved;
}

export function schedulesDir(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".vibekit", "state", "schedules");
}

export function defaultJobsPath(projectRoot: string): string {
  return path.join(schedulesDir(projectRoot), "jobs.json");
}

export function defaultLockPath(projectRoot: string): string {
  return path.join(schedulesDir(projectRoot), "jobs.lock");
}

export function defaultRunsDir(projectRoot: string): string {
  return path.join(schedulesDir(projectRoot), "runs");
}
