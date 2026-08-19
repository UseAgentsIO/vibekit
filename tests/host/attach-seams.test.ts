import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import {
  bindInstalledTools,
  bindOptionalStateAdapter,
  optionalSessionContext,
} from "@useagentsio/host";
import { describe, expect, it } from "vitest";

import { makeTempDir } from "../helpers.js";

describe("generic Host attach seams", () => {
  it("does not bind an optional state adapter for state:repository", async () => {
    const dir = makeTempDir("vibekit-seam-state-");
    writeProjectDocument(dir, createDefaultProject({ slug: "demo", name: "Demo" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const adapter = await bindOptionalStateAdapter(dir, "state:repository");
    expect(adapter).toBeUndefined();
    expect(fs.existsSync(path.join(dir, ".vibekit/state/memory.sqlite"))).toBe(false);
  });

  it("does not bind tools when none are installed", async () => {
    const dir = makeTempDir("vibekit-seam-tools-");
    writeProjectDocument(dir, createDefaultProject({ slug: "demo", name: "Demo" }));
    writeInstalledManifest(dir, emptyInstalledManifest());
    const tools = await bindInstalledTools(dir, {
      resolveSecret: () => {
        throw new Error("secrets must not be resolved when no tools are installed");
      },
    });
    expect(tools).toEqual([]);
  });

  it("does not inject session context without a memory grant", async () => {
    const snapshot = await optionalSessionContext(
      {
        id: "state:memory",
        sessionContext: () => "SECRET MEMORY",
      },
      ["source.read"],
    );
    expect(snapshot).toBeUndefined();
  });

  it("injects session context only when memory.read is granted", async () => {
    const snapshot = await optionalSessionContext(
      {
        id: "state:memory",
        sessionContext: () => "notes about the operator",
      },
      ["memory.read"],
    );
    expect(snapshot).toBe("notes about the operator");
  });
});
