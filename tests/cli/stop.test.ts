import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { deploymentSecretsPath, isHostIpcAvailable, readDeploymentSecrets, writeDeploymentSecret } from "@useagentsio/host";
import { readProjectDocument } from "@useagentsio/core";
import { runCli } from "vibekit";
import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("cli stop", () => {
  it("stops a running Host service gracefully", async () => {
    const dir = makeTempDir("vibekit-cli-stop-");
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
    writeDeploymentSecret(project.id, "OPENAI_API_KEY", "stop-test-secret");

    const projectFile = path.join(dir, ".vibekit", "project.yaml");
    const stateFile = path.join(dir, ".vibekit", "state", "decisions", "durable.json");
    const sessionFile = path.join(dir, ".vibekit", "state", "sessions", "conversation.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(stateFile, "durable state\n");
    fs.writeFileSync(sessionFile, "durable session\n");
    const projectBeforeStop = fs.readFileSync(projectFile, "utf8");

    const start = await runCli(["start", "--dir", dir, "--registry", officialRegistryDir]);
    expect(start.exitCode).toBe(0);
    expect(await isHostIpcAvailable(dir)).toBe(true);

    const stop = await runCli(["stop", "--dir", dir]);
    expect(stop.exitCode).toBe(0);
    expect(stop.stdout).toContain("VibeKit stopped.");

    expect(await isHostIpcAvailable(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, ".vibekit", "runtime", "host-status.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".vibekit", "runtime", "host.lock"))).toBe(false);
    expect(fs.readFileSync(projectFile, "utf8")).toBe(projectBeforeStop);
    expect(fs.readFileSync(stateFile, "utf8")).toBe("durable state\n");
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("durable session\n");
    expect(readDeploymentSecrets(project.id).OPENAI_API_KEY).toBe("stop-test-secret");
    fs.rmSync(deploymentSecretsPath(project.id), { force: true });
  });

  it("reports cleanly when Host is not running", async () => {
    const dir = makeTempDir("vibekit-cli-not-running-");
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

    const stop = await runCli(["stop", "--dir", dir]);
    expect(stop.exitCode).toBe(0);
    expect(stop.stdout).toContain("VibeKit is not running.");
  });

  it("recovers and cleans up stale socket and status files", async () => {
    const dir = makeTempDir("vibekit-cli-stale-");
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

    // Create fake stale files with a non-existent PID
    const runtimeDir = path.join(dir, ".vibekit", "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const fakePid = 99999999;
    fs.writeFileSync(
      path.join(runtimeDir, "host-status.json"),
      JSON.stringify({ schemaVersion: 1, ready: true, pid: fakePid }),
    );
    fs.writeFileSync(path.join(runtimeDir, "host.lock"), `${fakePid}\n`);

    const statusResult = await runCli(["status", "--dir", dir]);
    expect(statusResult.exitCode).toBe(0);
    expect(statusResult.stdout).toContain("Host: stopped");

    const stopResult = await runCli(["stop", "--dir", dir]);
    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout).toContain("VibeKit is not running.");

    expect(fs.existsSync(path.join(runtimeDir, "host-status.json"))).toBe(false);
    expect(fs.existsSync(path.join(runtimeDir, "host.lock"))).toBe(false);
  });
});
