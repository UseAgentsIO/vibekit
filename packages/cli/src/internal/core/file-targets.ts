import path from "node:path";

import { VibeKitError } from "./errors.js";
import type { ValidationError, ValidationResult } from "./types.js";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;
const URL_SCHEME = /^(?:file|https?|ftp):/i;

export function isSafeFileTarget(target: string): boolean {
  return validateFileTarget(target).valid;
}

export function validateFileTarget(target: string): ValidationResult {
  const errors = fileTargetErrors(target);
  return errors.length === 0
    ? { valid: true, errors: [], data: target }
    : { valid: false, errors };
}

export function assertFileTarget(target: string): void {
  const errors = fileTargetErrors(target);
  if (errors.length > 0) {
    const first = errors[0];
    throw new VibeKitError({
      category: "invalid_input",
      code: "file_target_invalid",
      message: first?.message ?? "Invalid file target",
      details: { target, errors },
    });
  }
}

function fileTargetErrors(target: string): ValidationError[] {
  if (typeof target !== "string" || target.length === 0) {
    return [{ path: "/", message: "File target must be a non-empty relative path" }];
  }
  if (target.includes("\0") || target.includes("%00")) {
    return [{ path: "/", message: "File target must not contain a null byte" }];
  }
  if (target.startsWith("/") || target.startsWith("\\")) {
    return [{ path: "/", message: "File target must not be an absolute path" }];
  }
  if (WINDOWS_DRIVE.test(target)) {
    return [{ path: "/", message: "File target must not be a Windows drive path" }];
  }
  if (UNC_PREFIX.test(target) || target.startsWith("//")) {
    return [{ path: "/", message: "File target must not be a UNC path" }];
  }
  if (URL_SCHEME.test(target)) {
    return [{ path: "/", message: "File target must not use a URL scheme" }];
  }
  if (target.startsWith("~")) {
    return [{ path: "/", message: "File target must not expand a home directory" }];
  }
  if (/%2e/i.test(target)) {
    return [{ path: "/", message: "File target must not contain encoded path segments" }];
  }

  const normalized = target.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      return [{ path: "/", message: "File target must not contain '..'" }];
    }
  }

  const posix = path.posix.normalize(normalized);
  if (posix.startsWith("..") || path.posix.isAbsolute(posix)) {
    return [{ path: "/", message: "File target must stay inside the project root" }];
  }

  return [];
}
