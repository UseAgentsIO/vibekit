import {
  VibeKitError,
  assertCapabilityResolved,
  resolveCapability,
} from "@useagentsio/core";
import { describe, expect, it } from "vitest";

describe("acceptance 15-16: capability resolution", () => {
  it("resolves a capability when exactly one compatible provider is installed", () => {
    const resolution = resolveCapability("source.read", {
      installedProviders: [
        { id: "tool:filesystem", capabilities: ["source.read", "source.write"] },
      ],
    });
    expect(resolution).toEqual({
      status: "resolved",
      capability: "source.read",
      provider: "tool:filesystem",
      source: "installed",
    });
    expect(assertCapabilityResolved(resolution)).toBe("tool:filesystem");
  });

  it("requires an explicit binding when several providers exist", () => {
    const ambiguous = resolveCapability("source.read", {
      installedProviders: [
        { id: "tool:filesystem", capabilities: ["source.read", "source.write"] },
        { id: "tool:sandbox-fs", capabilities: ["source.read"] },
      ],
    });
    expect(ambiguous.status).toBe("unresolved");
    if (ambiguous.status === "unresolved") {
      expect(ambiguous.reason).toBe("ambiguous");
      expect(ambiguous.providers).toEqual(["tool:filesystem", "tool:sandbox-fs"]);
    }
    expect(() => assertCapabilityResolved(ambiguous)).toThrow(VibeKitError);
    try {
      assertCapabilityResolved(ambiguous);
    } catch (error) {
      expect((error as VibeKitError).code).toBe("capability_ambiguous");
    }

    const bound = resolveCapability("source.read", {
      projectBinding: "tool:filesystem",
      installedProviders: [
        { id: "tool:filesystem", capabilities: ["source.read", "source.write"] },
        { id: "tool:sandbox-fs", capabilities: ["source.read"] },
      ],
    });
    expect(bound).toEqual({
      status: "resolved",
      capability: "source.read",
      provider: "tool:filesystem",
      source: "project",
    });

    const agentBound = resolveCapability("source.read", {
      agentBinding: "tool:sandbox-fs",
      projectBinding: "tool:filesystem",
      installedProviders: [
        { id: "tool:filesystem", capabilities: ["source.read"] },
        { id: "tool:sandbox-fs", capabilities: ["source.read"] },
      ],
    });
    expect(agentBound.status).toBe("resolved");
    if (agentBound.status === "resolved") {
      expect(agentBound.source).toBe("agent");
      expect(agentBound.provider).toBe("tool:sandbox-fs");
    }
  });
});
