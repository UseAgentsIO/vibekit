import path from "node:path";

export interface CwdResolution {
  readonly ok: true;
  readonly cwd: string;
  readonly relative: string;
}

export interface CwdError {
  readonly ok: false;
  readonly message: string;
}

export function resolveProcessCwd(
  projectRoot: string,
  requested: string | undefined,
  allowAbsoluteCwd: boolean,
): CwdResolution | CwdError {
  const root = path.resolve(projectRoot);
  const raw = requested === undefined || requested.length === 0 ? "." : requested;
  if (raw.includes("\0")) {
    return { ok: false, message: "cwd must not contain a null byte" };
  }
  const isAbsolute = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw);
  if (isAbsolute && !allowAbsoluteCwd) {
    return { ok: false, message: "cwd must be relative to the Project root" };
  }
  const hasParent = raw.split(/[\\/]/).includes("..");
  if (hasParent && !allowAbsoluteCwd) {
    return { ok: false, message: "cwd must not contain .." };
  }
  const resolved = path.resolve(root, raw);
  if (!allowAbsoluteCwd) {
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return { ok: false, message: "cwd must stay inside the Project root" };
    }
  }
  return {
    ok: true,
    cwd: resolved,
    relative: path.relative(root, resolved) || ".",
  };
}
