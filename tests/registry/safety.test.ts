import fs from "node:fs";
import path from "node:path";

import { VibeKitError, buildRegistryIndex } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { makeTempDir, writeSyntheticComponent } from "../helpers.js";
import { runCli } from "vibekit";

describe("acceptance 6: unsafe file targets", () => {
  it("rejects path traversal targets when building a registry index", async () => {
    const root = makeTempDir("vibekit-unsafe-");
    writeSyntheticComponent(root, {
      type: "policy",
      name: "escape",
      files: [
        {
          source: "payload/index.txt",
          target: "../escaped.txt",
          ownership: "exclusive",
        },
      ],
    });
    expect(() => buildRegistryIndex(root)).toThrow(VibeKitError);
    try {
      buildRegistryIndex(root);
    } catch (error) {
      expect(error).toBeInstanceOf(VibeKitError);
      expect((error as VibeKitError).code).toMatch(/file_target_invalid|module_yaml_invalid/);
    }
  });

  it("rejects absolute targets when building a registry index", async () => {
    const root = makeTempDir("vibekit-abs-");
    writeSyntheticComponent(root, {
      type: "policy",
      name: "absolute",
      files: [
        {
          source: "payload/index.txt",
          target: "/tmp/vibekit-absolute.txt",
          ownership: "exclusive",
        },
      ],
    });
    expect(() => buildRegistryIndex(root)).toThrow(VibeKitError);
  });

  it("rejects unsafe targets during add", async () => {
    const project = makeTempDir("vibekit-proj-");
    expect((await runCli(["init", project])).exitCode).toBe(0);
    const registry = makeTempDir("vibekit-reg-");
    writeSyntheticComponent(registry, {
      type: "policy",
      name: "escape",
      files: [
        {
          source: "payload/index.txt",
          target: "../escaped.txt",
          ownership: "exclusive",
        },
      ],
    });
    // Bypass schema-checked index generation by writing a hand-built module file
    // that still has to pass runtime target checks if it ever loaded.
    fs.writeFileSync(
      path.join(registry, "index.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          modules: [
            {
              id: "policy:escape",
              version: "1.0.0",
              checksum: `sha256:${"0".repeat(64)}`,
              compatibility: { vibekit: "^1.0.0", pi: ">=0.50.0" },
              path: "components/policy/escape/1.0.0",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const result = await runCli([
      "add",
      "policy",
      "escape",
      "--yes",
      "--dir",
      project,
      "--registry",
      registry,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /file_target_invalid|module_yaml_invalid|registry_integrity_mismatch/,
    );
    expect(fs.existsSync(path.join(project, "..", "escaped.txt"))).toBe(false);
  });
});
