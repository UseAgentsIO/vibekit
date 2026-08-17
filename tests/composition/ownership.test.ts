import fs from "node:fs";
import path from "node:path";

import { emptyInstalledManifest, planFileOwnership } from "@vibekit/core";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";
import { buildTempRegistry, makeTempDir } from "../helpers.js";

describe("acceptance 5: exclusive ownership", () => {
  it("rejects two Modules claiming the same exclusive file", () => {
    expect(() =>
      planFileOwnership(
        [
          {
            moduleId: "policy:one",
            sourceAbs: "/tmp/one",
            targetRel: ".vibekit/components/policies/shared.yaml",
            ownership: "exclusive",
          },
          {
            moduleId: "policy:two",
            sourceAbs: "/tmp/two",
            targetRel: ".vibekit/components/policies/shared.yaml",
            ownership: "exclusive",
          },
        ],
        emptyInstalledManifest(),
      ),
    ).toThrow(/duplicate_exclusive_ownership|both claim/);
  });

  it("rejects add when an installed Module already owns the target", () => {
    const registry = buildTempRegistry([
      {
        type: "policy",
        name: "one",
        files: [
          {
            source: "payload/index.txt",
            target: ".vibekit/components/policies/shared.yaml",
            ownership: "exclusive",
          },
        ],
        payload: "one\n",
      },
      {
        type: "policy",
        name: "two",
        files: [
          {
            source: "payload/index.txt",
            target: ".vibekit/components/policies/shared.yaml",
            ownership: "exclusive",
          },
        ],
        payload: "two\n",
      },
    ]);
    const dir = makeTempDir("vibekit-own-");
    expect(runCli(["init", dir, "--registry", registry]).exitCode).toBe(0);
    const first = runCli([
      "add",
      "policy",
      "one",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(first.exitCode, first.stderr + first.stdout).toBe(0);
    const second = runCli([
      "add",
      "policy",
      "two",
      "--yes",
      "--dir",
      dir,
      "--registry",
      registry,
    ]);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toMatch(/duplicate_exclusive_ownership/);
    expect(fs.readFileSync(path.join(dir, ".vibekit/components/policies/shared.yaml"), "utf8")).toBe(
      "one\n",
    );
  });
});
