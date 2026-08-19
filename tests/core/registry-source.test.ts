import fs from "node:fs";
import path from "node:path";

import {
  VibeKitError,
  applyInstall,
  assertRegistryMatchesInstallSource,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  localRegistrySource,
  OFFICIAL_REGISTRY_SOURCE,
  parseRegistrySource,
  planInstall,
  readInstalledManifest,
  registrySourceForRoot,
  resolveInstalledModule,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { buildTempRegistry, makeTempDir, officialRegistryDir } from "../helpers.js";

describe("registry source identity", () => {
  it("treats the official registry root as official", () => {
    expect(registrySourceForRoot(officialRegistryDir)).toBe(OFFICIAL_REGISTRY_SOURCE);
    expect(loadRegistry(officialRegistryDir).source).toBe(OFFICIAL_REGISTRY_SOURCE);
    expect(parseRegistrySource(OFFICIAL_REGISTRY_SOURCE)).toEqual({ kind: "official" });
  });

  it("treats any other registry path as local:<abs>", () => {
    const root = buildTempRegistry([{ type: "policy", name: "sample" }]);
    const source = localRegistrySource(root);
    expect(source).toBe(`local:${path.resolve(root)}`);
    expect(registrySourceForRoot(root)).toBe(source);
    expect(loadRegistry(root).source).toBe(source);
    expect(parseRegistrySource(source)).toEqual({ kind: "local", root: path.resolve(root) });
  });

  it("rejects unsupported source identities", () => {
    expect(() => parseRegistrySource("https://example.com/registry")).toThrow(VibeKitError);
    expect(() => parseRegistrySource("local:")).toThrow(VibeKitError);
  });
});

describe("install provenance", () => {
  it("records official when installing from the official registry", async () => {
    const dir = makeTempDir("vibekit-source-official-");
    expect((await runCli(["init", dir, "--registry", officialRegistryDir])).exitCode).toBe(0);
    expect(
      (
        await runCli([
          "add",
          "policy",
          "least-privilege",
          "--yes",
          "--dir",
          dir,
          "--registry",
          officialRegistryDir,
        ])
      ).exitCode,
    ).toBe(0);
    const record = readInstalledManifest(dir).modules.find(
      (module) => module.id === "policy:least-privilege",
    );
    expect(record?.registrySource).toBe(OFFICIAL_REGISTRY_SOURCE);
  });

  it("records local:<path> when installing from a custom registry", async () => {
    const registryRoot = buildTempRegistry([{ type: "policy", name: "custom-policy" }]);
    const dir = makeTempDir("vibekit-source-local-");
    expect((await runCli(["init", dir, "--registry", registryRoot])).exitCode).toBe(0);
    expect(
      (
        await runCli([
          "add",
          "policy",
          "custom-policy",
          "--yes",
          "--dir",
          dir,
          "--registry",
          registryRoot,
        ])
      ).exitCode,
    ).toBe(0);
    const record = readInstalledManifest(dir).modules.find(
      (module) => module.id === "policy:custom-policy",
    );
    expect(record?.registrySource).toBe(localRegistrySource(registryRoot));
    expect(record?.registrySource).not.toBe(OFFICIAL_REGISTRY_SOURCE);

    const listed = await runCli(["list", "--dir", dir, "--registry", registryRoot]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    expect(listed.stdout).toContain("policy:custom-policy");
    expect(listed.stdout).toContain(localRegistrySource(registryRoot));
    expect(listed.stdout).not.toMatch(/policy:custom-policy\s+\S+\s+official\s/);
  });

  it("planInstall defaults to the loaded registry source", () => {
    const registryRoot = buildTempRegistry([{ type: "policy", name: "sample" }]);
    const dir = makeTempDir("vibekit-source-plan-");
    writeProjectDocument(dir, createDefaultProject({ slug: "sample", name: "sample" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const registry = loadRegistry(registryRoot);
    const plan = planInstall({
      projectRoot: dir,
      registry,
      roots: ["policy:sample"],
      project: createDefaultProject({ slug: "sample", name: "sample" }),
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot: dir, plan });
    expect(readInstalledManifest(dir).modules[0]?.registrySource).toBe(localRegistrySource(registryRoot));
  });
});

describe("resolve against recorded source", () => {
  it("resolves a locally installed module from its recorded registry, not official", async () => {
    const registryRoot = buildTempRegistry([
      {
        type: "policy",
        name: "least-privilege",
        payload: "custom-policy-payload\n",
      },
    ]);
    const dir = makeTempDir("vibekit-source-resolve-");
    expect((await runCli(["init", dir, "--registry", registryRoot])).exitCode).toBe(0);
    expect(
      (
        await runCli([
          "add",
          "policy",
          "least-privilege",
          "--yes",
          "--dir",
          dir,
          "--registry",
          registryRoot,
        ])
      ).exitCode,
    ).toBe(0);

    const record = readInstalledManifest(dir).modules.find(
      (module) => module.id === "policy:least-privilege",
    );
    expect(record).toBeDefined();
    const loaded = resolveInstalledModule(record!);
    expect(loaded.absolutePath.startsWith(path.resolve(registryRoot))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".vibekit/components/policy/least-privilege.txt"), "utf8")).toBe(
      "custom-policy-payload\n",
    );
  });

  it("refuses to update a locally installed module from the official registry", async () => {
    const registryRoot = buildTempRegistry([{ type: "policy", name: "sample" }]);
    const dir = makeTempDir("vibekit-source-mismatch-");
    expect((await runCli(["init", dir, "--registry", registryRoot])).exitCode).toBe(0);
    expect(
      (
        await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registryRoot])
      ).exitCode,
    ).toBe(0);

    const result = await runCli([
      "update",
      "policy:sample",
      "--yes",
      "--dir",
      dir,
      "--registry",
      officialRegistryDir,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/registry_source_mismatch|installed from local:/);
  });

  it("fails closed when the recorded local source is gone", () => {
    const record = {
      id: "policy:sample" as const,
      version: "1.0.0",
      registrySource: localRegistrySource("/tmp/vibekit-missing-registry-does-not-exist"),
    };
    expect(() => resolveInstalledModule(record)).toThrow(VibeKitError);
  });

  it("assertRegistryMatchesInstallSource accepts matching official sources even from different roots", () => {
    const official = loadRegistry(officialRegistryDir, OFFICIAL_REGISTRY_SOURCE);
    expect(() =>
      assertRegistryMatchesInstallSource(
        { id: "policy:least-privilege", registrySource: OFFICIAL_REGISTRY_SOURCE },
        official,
      ),
    ).not.toThrow();
  });

  it("doctor errors instead of substituting official for a missing local source", async () => {
    const registryRoot = buildTempRegistry([{ type: "policy", name: "sample" }]);
    const dir = makeTempDir("vibekit-source-doctor-");
    expect((await runCli(["init", dir, "--registry", registryRoot])).exitCode).toBe(0);
    expect(
      (
        await runCli(["add", "policy", "sample", "--yes", "--dir", dir, "--registry", registryRoot])
      ).exitCode,
    ).toBe(0);

    const manifestPath = path.join(dir, ".vibekit/installed.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      modules: Array<{ registrySource: string }>;
    };
    manifest.modules[0]!.registrySource = localRegistrySource("/tmp/vibekit-gone-registry");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const report = runDoctor({
      projectRoot: dir,
      registry: loadRegistry(officialRegistryDir, OFFICIAL_REGISTRY_SOURCE),
    });
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.code === "registry_source_unavailable")).toBe(
      true,
    );
  });
});
