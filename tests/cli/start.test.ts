import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readProjectDocument } from "@useagentsio/core";
import { isHostIpcAvailable, writeDeploymentSecret } from "@useagentsio/host";
import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("cli start", () => {
  it("makes the Project ready in the background and returns 0", async () => {
    const dir = makeTempDir("vibekit-cli-start-");
    const create = await runCli([
      "create",
      dir,
      "--agent",
      "coder",
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--interface",
      "terminal",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(create.exitCode).toBe(0);

    try {
      const startResult = await runCli(["start", "--dir", dir, "--registry", officialRegistryDir]);
      expect(startResult.exitCode, startResult.stderr).toBe(0);
      expect(startResult.stdout).toContain("VibeKit started.");
      expect(startResult.stdout).toMatch(/Project:\s+project:/);
      expect(startResult.stdout).toContain("VibeKit: ready");
      expect(startResult.stdout).toContain("Connections: Terminal");
      expect(startResult.stdout).not.toMatch(/Host|Gateway|IPC|daemon/);

      // Host must remain alive after start command returned
      expect(await isHostIpcAvailable(dir)).toBe(true);

      const statusResult = await runCli(["status", "--dir", dir]);
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.stdout).toContain("VibeKit: ready");

      // Second start is idempotent
      const secondStart = await runCli(["start", "--dir", dir, "--registry", officialRegistryDir]);
      expect(secondStart.exitCode).toBe(0);
      expect(secondStart.stdout).toContain("VibeKit is already running.");
    } finally {
      await runCli(["stop", "--dir", dir]);
    }

    expect(await isHostIpcAvailable(dir)).toBe(false);
  });

  it("resolves secrets stored in the deployment store without process.env", async () => {
    const dir = makeTempDir("vibekit-cli-secrets-");
    const create = await runCli([
      "create",
      dir,
      "--agent",
      "coder",
      "--provider",
      "openai",
      "--model",
      "gpt-5",
      "--interface",
      "terminal",
      "--yes",
      "--registry",
      officialRegistryDir,
    ]);
    expect(create.exitCode).toBe(0);

    const project = readProjectDocument(dir);
    // Save secret to deployment store
    writeDeploymentSecret(project.id, "OPENAI_API_KEY", "test-secret-key-12345");

    // Remove from process.env if present
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const startResult = await runCli(["start", "--dir", dir, "--registry", officialRegistryDir]);
      expect(startResult.exitCode).toBe(0);
      expect(startResult.stdout).toContain("VibeKit started.");
      expect(await isHostIpcAvailable(dir)).toBe(true);
    } finally {
      if (origKey !== undefined) {
        process.env.OPENAI_API_KEY = origKey;
      }
      await runCli(["stop", "--dir", dir]);
    }
  });
});
