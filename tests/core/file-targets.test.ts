import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  VibeKitError,
  assertFileTarget,
  isSafeFileTarget,
  safeResolve,
  validateFileTarget,
} from "@useagentsio/core";

import { makeTempDir } from "../helpers.js";

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

  it("rejects a target that escapes the project root through a symlink", () => {
    const root = makeTempDir("vibekit-symlink-");
    const outside = makeTempDir("vibekit-symlink-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "nope\n");
    fs.symlinkSync(outside, path.join(root, "link"));
    expect(() => safeResolve(root, "link/secret.txt")).toThrow(/symlink/i);
  });
});
