import { VibeKitError, loadRegistry, resolveInstallSet, resolveModule } from "@useagentsio/core";
import { describe, expect, it } from "vitest";

import { buildTempRegistry } from "../helpers.js";

describe("acceptance 12-14: composition", () => {
  it("fails when a required dependency is missing", () => {
    const root = buildTempRegistry(
      [
        {
          type: "tool",
          name: "orphan",
          required: ["policy:does-not-exist"],
        },
      ],
      { allowMissingDeps: true },
    );
    const registry = loadRegistry(root);
    expect(() =>
      resolveInstallSet(["tool:orphan"], (id) => {
        try {
          return resolveModule(registry, id);
        } catch {
          return undefined;
        }
      }, new Set()),
    ).toThrow(VibeKitError);
    try {
      resolveInstallSet(["tool:orphan"], (id) => {
        try {
          return resolveModule(registry, id);
        } catch {
          return undefined;
        }
      }, new Set());
    } catch (error) {
      expect((error as VibeKitError).category).toBe("dependency_missing");
      expect((error as VibeKitError).code).toBe("required_dependency_missing");
    }
  });

  it("fails when required dependencies form a cycle", () => {
    const root = buildTempRegistry([
      { type: "tool", name: "alpha", required: ["tool:beta"] },
      { type: "tool", name: "beta", required: ["tool:alpha"] },
    ]);
    const registry = loadRegistry(root);
    expect(() =>
      resolveInstallSet(["tool:alpha"], (id) => resolveModule(registry, id), new Set()),
    ).toThrow(VibeKitError);
    try {
      resolveInstallSet(["tool:alpha"], (id) => resolveModule(registry, id), new Set());
    } catch (error) {
      expect((error as VibeKitError).code).toBe("dependency_cycle");
    }
  });

  it("fails when Modules declare a conflict", () => {
    const root = buildTempRegistry([
      { type: "policy", name: "one", conflicts: ["policy:two"] },
      { type: "policy", name: "two" },
    ]);
    const registry = loadRegistry(root);
    expect(() =>
      resolveInstallSet(
        ["policy:one", "policy:two"],
        (id) => resolveModule(registry, id),
        new Set(),
      ),
    ).toThrow(VibeKitError);
    try {
      resolveInstallSet(
        ["policy:one", "policy:two"],
        (id) => resolveModule(registry, id),
        new Set(),
      );
    } catch (error) {
      expect((error as VibeKitError).code).toBe("module_conflict");
    }
  });
});
