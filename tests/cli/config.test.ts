import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  writeProjectDocument,
} from "@useagentsio/core";
import {
  deploymentSecretsPath,
  readDeploymentSecrets,
  writeDeploymentSecret,
} from "@useagentsio/host";

import { runCli } from "vibekit";
import { OutputBuffer } from "../../packages/cli/src/output.js";
import { ensureInstalledSecrets } from "../../packages/cli/src/secrets.js";
import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("config facade", () => {
  it("shows effective runtime defaults for a minimal Project", async () => {
    const root = makeTempDir("vibekit-config-effective-");
    fs.mkdirSync(path.join(root, ".vibekit"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vibekit/project.yaml"),
      "schemaVersion: 2\nid: project:effective\nname: Effective\n",
      "utf8",
    );

    const result = await runCli(["config", "effective", "--dir", root]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("defaultTimeoutMs: 600000");
    expect(result.stdout).toContain("adapter: vibekit:pi");
    expect(fs.readFileSync(path.join(root, ".vibekit/project.yaml"), "utf8")).not.toContain("defaultTimeoutMs");
  });

  it("removes deployment secrets without printing their values", async () => {
    const root = makeTempDir("vibekit-config-secrets-");
    writeProjectDocument(root, createDefaultProject({ slug: "secret-facade", name: "Secret Facade" }));
    writeDeploymentSecret("project:secret-facade", "OPENAI_API_KEY", "never-print-this-value");
    expect(fs.existsSync(deploymentSecretsPath("project:secret-facade"))).toBe(true);

    const result = await runCli(["config", "secrets", "remove", "OPENAI_API_KEY", "--dir", root]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Removed OPENAI_API_KEY");
    expect(result.stdout).not.toContain("never-print-this-value");
    expect(fs.existsSync(deploymentSecretsPath("project:secret-facade"))).toBe(false);
  });

  it("lists declared secret names and redacted configured status", async () => {
    const root = makeTempDir("vibekit-config-secret-status-");
    const registryRoot = buildTempRegistry([
      {
        type: "provider",
        name: "locked",
        secrets: [{ name: "LOCKED_API_KEY", source: "deployment", required: true }],
      },
    ]);
    const registry = loadRegistry(registryRoot, `local:${fs.realpathSync(registryRoot)}`);
    writeProjectDocument(root, createDefaultProject({ slug: "secret-status", name: "Secret Status" }));
    applyInstall({
      projectRoot: root,
      plan: planInstall({
        projectRoot: root,
        registry,
        roots: ["provider:locked"],
        project: readProjectDocument(root),
        manifest: emptyInstalledManifest(),
        registrySource: registry.source,
      }),
    });

    const missing = await runCli(["config", "secrets", "status", "--dir", root, "--registry", registryRoot]);
    expect(missing.exitCode, missing.stderr).toBe(0);
    expect(missing.stdout).toContain("LOCKED_API_KEY: missing");
    expect(missing.stdout).not.toContain("value");

    writeDeploymentSecret("project:secret-status", "LOCKED_API_KEY", "secret-status-value");
    const configured = await runCli(["config", "secrets", "status", "--dir", root, "--registry", registryRoot]);
    expect(configured.exitCode, configured.stderr).toBe(0);
    expect(configured.stdout).toContain("LOCKED_API_KEY: configured");
    expect(configured.stdout).not.toContain("secret-status-value");
    expect(readInstalledManifest(root).modules).toHaveLength(1);

    const envRoot = makeTempDir("vibekit-config-secret-env-");
    writeProjectDocument(envRoot, createDefaultProject({ slug: "secret-env", name: "Secret Env" }));
    applyInstall({
      projectRoot: envRoot,
      plan: planInstall({
        projectRoot: envRoot,
        registry,
        roots: ["provider:locked"],
        project: readProjectDocument(envRoot),
        manifest: emptyInstalledManifest(),
        registrySource: registry.source,
      }),
    });
    await ensureInstalledSecrets({
      projectRoot: envRoot,
      registry,
      yes: true,
      out: new OutputBuffer(),
      env: { LOCKED_API_KEY: "saved-from-setup" },
    });
    expect(readDeploymentSecrets("project:secret-env").LOCKED_API_KEY).toBe("saved-from-setup");
  });

  it("opens the existing Agent instructions surface through one clear action", async () => {
    const root = makeTempDir("vibekit-config-instructions-");
    const project = createDefaultProject({ slug: "instructions", name: "Instructions", defaultAgent: "assistant" });
    writeProjectDocument(root, {
      ...project,
      agentBindings: { assistant: { definition: "agent:assistant" } },
    });
    const instructions = path.join(root, ".vibekit", "agents", "assistant", "instructions.md");
    fs.mkdirSync(path.dirname(instructions), { recursive: true });
    fs.writeFileSync(instructions, "# Assistant\n", "utf8");
    const previousEditor = process.env.EDITOR;
    const previousVisual = process.env.VISUAL;
    process.env.EDITOR = "true";
    process.env.VISUAL = "true";
    try {
      const result = await runCli(["config", "instructions", "--dir", root]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain(".vibekit/agents/assistant/instructions.md");
    } finally {
      if (previousEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = previousEditor;
      if (previousVisual === undefined) delete process.env.VISUAL;
      else process.env.VISUAL = previousVisual;
    }
  });
});
