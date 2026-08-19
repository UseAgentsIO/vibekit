import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  localRegistrySource,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry, makeTempDir, writeUncheckedRegistryIndex } from "../helpers.js";

const DUMMY_CHECKSUM = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("runDoctor diagnostics", () => {
  it("fails with severity error when a component configuration violates schema through additional properties", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "custom",
        capabilities: ["custom.do"],
      },
    ]);
    const dir = makeTempDir("vibekit-doctor-config-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));

    // Write module config schema prohibiting additionalProperties
    const moduleDir = path.join(registryRoot, "components", "tool", "custom", "1.0.0");
    fs.writeFileSync(
      path.join(moduleDir, "config.schema.json"),
      JSON.stringify({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: false,
        properties: {
          allowedField: { type: "string" },
        },
      }),
      "utf8",
    );
    writeUncheckedRegistryIndex(registryRoot);
    const reg = loadRegistry(registryRoot, localRegistrySource(registryRoot));
    const checksum = reg.index.modules.find((m) => m.id === "tool:custom")?.checksum ?? DUMMY_CHECKSUM;

    const manifest = {
      ...emptyInstalledManifest(),
      modules: [
        {
          schemaVersion: 1 as const,
          id: "tool:custom" as const,
          version: "1.0.0",
          registrySource: localRegistrySource(registryRoot),
          sourceRevision: "test",
          integrityChecksum: checksum,
          installedAt: "2026-08-19T00:00:00.000Z",
          dependencies: [],
          files: [],
          configurationPaths: [".vibekit/config/tool/custom.yaml"],
          compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
        },
      ],
    };
    writeInstalledManifest(dir, manifest);

    // Write config file with additional property matching configuration.target
    fs.mkdirSync(path.join(dir, ".vibekit/config/tool"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".vibekit/config/tool/custom.yaml"),
      "unexpectedField: forbidden\n",
      "utf8",
    );

    const report = runDoctor({
      projectRoot: dir,
      registry: reg,
    });
    const configError = report.findings.find(
      (f) => f.code === "config_invalid" && f.severity === "error",
    );
    expect(configError).toBeDefined();
    expect(configError?.severity).toBe("error");
    expect(configError?.message).toContain("additional property");
  });

  it("fails when an executable module is missing runtime.export or exports an undefined symbol", () => {
    const registryRoot = buildTempRegistry([
      {
        type: "tool",
        name: "export-test",
        capabilities: ["test.export"],
        runtime: {
          kind: "package",
          package: "@test/tool",
          export: "expectedToolExport",
        },
      },
    ]);
    const dir = makeTempDir("vibekit-doctor-export-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));

    // Create a local package.json
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-project",
        dependencies: {
          "@test/tool": "1.0.0",
        },
      }),
      "utf8",
    );

    // Create node_modules/@test/tool/index.js without the expected export
    const pkgDir = path.join(dir, "node_modules", "@test", "tool");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@test/tool", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = { otherExport: () => {} };\n", "utf8");

    const reg = loadRegistry(registryRoot, localRegistrySource(registryRoot));
    const checksum = reg.index.modules.find((m) => m.id === "tool:export-test")?.checksum ?? DUMMY_CHECKSUM;

    const manifest = {
      ...emptyInstalledManifest(),
      modules: [
        {
          schemaVersion: 1 as const,
          id: "tool:export-test" as const,
          version: "1.0.0",
          registrySource: localRegistrySource(registryRoot),
          sourceRevision: "test",
          integrityChecksum: checksum,
          installedAt: "2026-08-19T00:00:00.000Z",
          dependencies: [],
          files: [],
          configurationPaths: [],
          compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
        },
      ],
    };
    writeInstalledManifest(dir, manifest);

    const report = runDoctor({
      projectRoot: dir,
      registry: reg,
    });
    const exportError = report.findings.find(
      (f) => f.code === "runtime_export_missing" && f.severity === "error",
    );
    expect(exportError).toBeDefined();
    expect(exportError?.message).toContain("does not export expectedToolExport");
  });

  it("detects unsafe path patterns, commands, and branch scopes in Agent permissions", () => {
    const registryRoot = makeTempDir("vibekit-doctor-scope-reg-");
    const moduleDir = path.join(registryRoot, "agents", "unsafe-agent", "1.0.0");
    fs.mkdirSync(path.join(moduleDir, "payload"), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, "payload", "instructions.md"), "# Unsafe Agent Instructions\n", "utf8");
    fs.writeFileSync(
      path.join(moduleDir, "module.yaml"),
      `schemaVersion: 1
id: agent:unsafe-agent
type: agent
name: unsafe-agent
displayName: Unsafe Agent
version: 1.0.0
description: Unsafe agent
compatibility:
  vibekit: "^1.0.0"
  pi: ">=0.50.0"
instructions: payload/instructions.md
model:
  provider: inherit
  id: inherit
  allowProjectOverride: true
  allowTaskOverride: false
components:
  required: []
  optional: []
  recommended: []
capabilities:
  requires:
    - source.read
    - command.execute
    - repository.write
inputs:
  required:
    - objective
  optional: []
outputs:
  required:
    - summary
permissions:
  allow:
    - capability: source.read
      scope:
        paths: ["../escape.txt"]
    - capability: command.execute
      scope:
        commands: ["ls\\0bad"]
    - capability: repository.write
      scope:
        branches: ["../main"]
  deny: []
files: []
delegation:
  allowed: false
  targets: []
  maxDepth: 1
  maxParallelChildren: 1
execution:
  isolation: process
  timeoutMs: 60000
  cleanupRequired: false
state:
  read: []
  write: []
verification:
  required: []
  independentReview: false
completion:
  requires:
    - result-recorded
escalation:
  on:
    - permission-denied
`,
      "utf8",
    );
    writeUncheckedRegistryIndex(registryRoot);
    const reg = loadRegistry(registryRoot, localRegistrySource(registryRoot));
    const checksum = reg.index.modules.find((m) => m.id === "agent:unsafe-agent")?.checksum ?? DUMMY_CHECKSUM;

    const dir = makeTempDir("vibekit-doctor-scopes-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));

    const manifest = {
      ...emptyInstalledManifest(),
      modules: [
        {
          schemaVersion: 1 as const,
          id: "agent:unsafe-agent" as const,
          version: "1.0.0",
          registrySource: localRegistrySource(registryRoot),
          sourceRevision: "test",
          integrityChecksum: checksum,
          installedAt: "2026-08-19T00:00:00.000Z",
          dependencies: [],
          files: [],
          configurationPaths: [],
          compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
        },
      ],
    };
    writeInstalledManifest(dir, manifest);

    const report = runDoctor({
      projectRoot: dir,
      registry: reg,
    });
    const unsafeFindings = report.findings.filter((f) => f.code === "grant_scope_unsafe");
    expect(unsafeFindings.length).toBeGreaterThanOrEqual(3);
    expect(unsafeFindings.some((f) => f.message.includes("../escape.txt"))).toBe(true);
    expect(unsafeFindings.some((f) => f.message.includes("command"))).toBe(true);
    expect(unsafeFindings.some((f) => f.message.includes("../main"))).toBe(true);
  });
});
