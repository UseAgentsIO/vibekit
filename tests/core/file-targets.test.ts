import { describe, expect, it } from "vitest";

import {
  VibeKitError,
  assertFileTarget,
  isSafeFileTarget,
  validateFileTarget,
} from "@vibekit/core";

describe("file targets", () => {
  it.each([
    ".pi/extensions/github/index.ts",
    "payload/index.ts",
    ".vibekit/config/tools/github.yaml",
    "src/example.ts",
    "./instructions.md",
    ".",
  ])("accepts %s", (target) => {
    expect(isSafeFileTarget(target)).toBe(true);
    expect(validateFileTarget(target).valid).toBe(true);
    expect(() => assertFileTarget(target)).not.toThrow();
  });

  it.each([
    ["/etc/passwd", "absolute posix"],
    ["C:\\Windows\\system32", "windows drive"],
    ["C:/Windows/system32", "windows drive slash"],
    ["\\\\server\\share", "unc"],
    ["//server/share", "unc slash"],
    ["../.ssh/id_rsa", "parent segment"],
    ["foo/../../etc/passwd", "normalized escape"],
    ["foo/\0bar", "null byte"],
    ["file:///etc/passwd", "url scheme"],
    ["~/.ssh/id_rsa", "home expansion"],
    ["foo/%2e%2e/bar", "encoded dots"],
    ["", "empty"],
  ])("rejects %s (%s)", (target) => {
    expect(isSafeFileTarget(target)).toBe(false);
    expect(validateFileTarget(target).valid).toBe(false);
    expect(() => assertFileTarget(target)).toThrow(VibeKitError);
  });
});
