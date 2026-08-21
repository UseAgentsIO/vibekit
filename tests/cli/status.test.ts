import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createDefaultProject,
  emptyInstalledManifest,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { runCli } from "vibekit";
import { makeTempDir } from "../helpers.js";

describe("cli status", () => {
  it("summarizes product readiness without exposing runtime topology", async () => {
    const root = makeTempDir("vibekit-cli-status-");
    const project = createDefaultProject({ slug: "status", name: "Status Project", defaultAgent: "assistant" });
    writeProjectDocument(root, {
      ...project,
      defaults: { model: { provider: "openai", id: "gpt-5" } },
      interfaceBindings: {
        "terminal-main": {
          definition: "interface:terminal",
          enabled: true,
          defaultAgent: "assistant",
        },
      },
    });
    writeInstalledManifest(root, emptyInstalledManifest());
    const reportDir = path.join(root, ".vibekit", "runtime", "diagnostics");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "doctor.json"), JSON.stringify({ findings: [] }));

    const result = await runCli(["status", "--dir", root]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Installation: ready");
    expect(result.stdout).toContain("Project: Status Project");
    expect(result.stdout).toContain("Model authentication:");
    expect(result.stdout).toContain("VibeKit: stopped");
    expect(result.stdout).toContain("Gateway:");
    expect(result.stdout).toContain("Connections:");
    expect(result.stdout).toContain("Doctor: ok");
    expect(result.stdout).not.toMatch(/PID|IPC|daemon/);
    expect(result.stdout).not.toContain("/status");
    expect(result.stdout).not.toContain(".vibekit/runtime/host.sock");
  });
});
