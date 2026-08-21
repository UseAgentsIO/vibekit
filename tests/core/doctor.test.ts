import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  localRegistrySource,
  runDoctor,
  sha256File,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import {
  buildTempRegistry,
  makeTempDir,
  officialRegistryDir,
  writeUncheckedRegistryIndex,
} from "../helpers.js";

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

  it("identifies the released invalid Pi built-in extension and its safe update", () => {
    const registry = loadRegistry(officialRegistryDir);
    const dir = makeTempDir("vibekit-doctor-pi-stub-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));

    const relative = ".pi/extensions/execution/index.ts";
    const absolute = path.join(dir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.copyFileSync(
      path.join(officialRegistryDir, "components/tool/execution/1.0.0/payload/index.ts"),
      absolute,
    );
    const entry = registry.index.modules.find(
      (item) => item.id === "tool:execution" && item.version === "1.0.0",
    );
    expect(entry).toBeDefined();
    writeInstalledManifest(dir, {
      ...emptyInstalledManifest(),
      modules: [
        {
          schemaVersion: 1,
          id: "tool:execution",
          version: "1.0.0",
          registrySource: officialRegistryDir === registry.root ? "official" : localRegistrySource(registry.root),
          sourceRevision: "v1.0.0",
          integrityChecksum: entry!.checksum,
          installedAt: "2026-08-20T00:00:00.000Z",
          dependencies: [],
          files: [{ path: relative, hash: sha256File(absolute), ownership: "exclusive" }],
          configurationPaths: [".vibekit/config/tools/execution.yaml"],
          compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
        },
      ],
    });

    const report = runDoctor({ projectRoot: dir, registry });
    const finding = report.findings.find((item) => item.code === "pi_builtin_extension_stub");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("tool:execution@1.0.0");
    expect(finding?.message).toContain(relative);
    expect(finding?.message).toContain("vibekit update tool:execution");
  });

  it("identifies other released registry extension stubs and their corrected updates", () => {
    const registry = loadRegistry(officialRegistryDir);
    const dir = makeTempDir("vibekit-doctor-pi-extension-stubs-");
    writeProjectDocument(dir, createDefaultProject({ slug: "test", name: "Test" }));
    const cases = [
      {
        id: "tool:web" as const,
        version: "1.0.0",
        source: "components/tool/web/1.0.0/payload/index.ts",
        target: ".pi/extensions/web/index.ts",
        config: ".vibekit/config/tools/web.yaml",
      },
      {
        id: "tool:memory" as const,
        version: "1.2.0",
        source: "components/tool/memory/1.2.0/payload/index.ts",
        target: ".pi/extensions/memory/index.ts",
        config: ".vibekit/config/tools/memory.yaml",
      },
    ];

    const modules = cases.map((item) => {
      const absolute = path.join(dir, item.target);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.copyFileSync(path.join(officialRegistryDir, item.source), absolute);
      const entry = registry.index.modules.find(
        (candidate) => candidate.id === item.id && candidate.version === item.version,
      );
      expect(entry).toBeDefined();
      return {
        schemaVersion: 1 as const,
        id: item.id,
        version: item.version,
        registrySource: "official",
        sourceRevision: `v${item.version}`,
        integrityChecksum: entry!.checksum,
        installedAt: "2026-08-20T00:00:00.000Z",
        dependencies: [],
        files: [{ path: item.target, hash: sha256File(absolute), ownership: "exclusive" as const }],
        configurationPaths: [item.config],
        compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
      };
    });
    writeInstalledManifest(dir, { ...emptyInstalledManifest(), modules });

    const report = runDoctor({ projectRoot: dir, registry });
    for (const item of cases) {
      const finding = report.findings.find(
        (candidate) => candidate.code === "pi_extension_stub" && candidate.path === item.target,
      );
      expect(finding?.severity).toBe("error");
      expect(finding?.message).toContain(`${item.id}@${item.version}`);
      expect(finding?.message).toContain(`vibekit update ${item.id}`);
      expect(finding?.message).toContain(item.target);
    }
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
