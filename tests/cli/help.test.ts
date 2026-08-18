import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";

describe("cli help", () => {
  it("prints a ShadCN-style root menu for --help", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: vibekit [options] [command]");
    expect(result.stdout).toContain("compose Agents and Components into a Pi project");
    expect(result.stdout).toContain("Options:");
    expect(result.stdout).toContain("-v, --version");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("init [options] [dir]");
    expect(result.stdout).toContain("add [options] <type> <name>");
    expect(result.stdout).toContain("help [command]");
  });

  it("prints the version", () => {
    const result = runCli(["-v"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints command help for add --help and help add", () => {
    const flagged = runCli(["add", "--help"]);
    const nested = runCli(["help", "add"]);
    expect(flagged.exitCode).toBe(0);
    expect(nested.exitCode).toBe(0);
    expect(flagged.stdout).toContain("Usage: vibekit add [options] <type> <name>");
    expect(flagged.stdout).toContain("Arguments:");
    expect(flagged.stdout).toContain("Examples:");
    expect(flagged.stdout).toBe(nested.stdout);
  });

  it("prints command help for every shipped command", () => {
    for (const name of ["init", "add", "list", "diff", "update", "remove", "doctor"]) {
      const result = runCli([name, "-h"]);
      expect(result.exitCode, name).toBe(0);
      expect(result.stdout, name).toContain(`Usage: vibekit ${name}`);
      expect(result.stdout, name).toContain("Options:");
    }
  });

  it("rejects unknown help targets", () => {
    const result = runCli(["help", "blocks"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "blocks"');
    expect(result.stderr).toContain("Usage: vibekit [options] [command]");
  });
});
