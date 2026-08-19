import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";

describe("cli help", () => {
  it("prints a ShadCN-style root menu for --help", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: vibekit [options] [command]");
    expect(result.stdout).toContain("run an Agent Host; compose Agents and Components");
    expect(result.stdout).toContain("Options:");
    expect(result.stdout).toContain("-v, --version");
    expect(result.stdout).toContain("-d, --defaults");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("init [options] [dir]");
    expect(result.stdout).toContain("add [options] <type> <name>");
    expect(result.stdout).toContain("help [command]");
  });

  it("prints the version", async () => {
    const result = await runCli(["-v"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints command help for add --help and help add", async () => {
    const flagged = await runCli(["add", "--help"]);
    const nested = await runCli(["help", "add"]);
    expect(flagged.exitCode).toBe(0);
    expect(nested.exitCode).toBe(0);
    expect(flagged.stdout).toContain("Usage: vibekit add [options] <type> <name>");
    expect(flagged.stdout).toContain("Arguments:");
    expect(flagged.stdout).toContain("Examples:");
    expect(flagged.stdout).toBe(nested.stdout);
  });

  it("prints command help for every shipped command", async () => {
    for (const name of ["create", "model", "msg", "start", "status", "migrate", "init", "add", "approve-pairing", "list", "diff", "update", "remove", "doctor"]) {
      const result = await runCli([name, "-h"]);
      expect(result.exitCode, name).toBe(0);
      expect(result.stdout, name).toContain(`Usage: vibekit ${name}`);
      expect(result.stdout, name).toContain("Options:");
    }
  });

  it("rejects unknown help targets", async () => {
    const result = await runCli(["help", "blocks"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command "blocks"');
    expect(result.stderr).toContain("Usage: vibekit [options] [command]");
  });
});
