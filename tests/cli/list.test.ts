import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { officialRegistryDir, makeTempDir } from "../helpers.js";

describe("list", () => {
  it("shows separate installed, configured, available, and verified statuses", async () => {
    const dir = makeTempDir("vibekit-list-");
    expect((await runCli(["init", dir, "--registry", officialRegistryDir])).exitCode).toBe(0);
    expect(
      (await runCli([
        "add",
        "policy",
        "least-privilege",
        "--yes",
        "--dir",
        dir,
        "--registry",
        officialRegistryDir,
      ])).exitCode,
    ).toBe(0);

    const result = await runCli(["list", "--dir", dir, "--registry", officialRegistryDir]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/INSTALLED/);
    expect(result.stdout).toMatch(/CONFIGURED/);
    expect(result.stdout).toMatch(/AVAILABLE/);
    expect(result.stdout).toMatch(/VERIFIED/);
    expect(result.stdout).toMatch(/policy:least-privilege\s+1\.0\.0\s+official\s+yes\s+yes\s+yes\s+yes/);
    expect(result.stdout).toMatch(/agent:coder\s+1\.0\.0\s+official\s+no\s+no\s+yes\s+no/);
  });
});
