import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  loadRegistry,
  planInstall,
  readProjectDocument,
  writeProjectDocument,
} from "@useagentsio/core";
import { VibeKitHost } from "@useagentsio/host";
import type { CreatePiSession, PiSession, PiSessionEvent } from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { runCli } from "vibekit";

import { makeTempDir, officialRegistryDir } from "../helpers.js";

describe("Host Pi built-in authority after registry stub cleanup", () => {
  it("keeps vibekit msg and persistent Host turns scoped to the effective authority", async () => {
    const projectRoot = makeTempDir("vibekit-host-pi-builtins-");
    writeProjectDocument(projectRoot, {
      ...createDefaultProject({ slug: "pi-host", name: "Pi Host", defaultAgent: "coder" }),
      defaults: { model: { provider: "openai", id: "gpt-4.1" } },
      authorization: {
        default: "deny",
        actions: {
          "source.read": "standing",
          "source.write": "standing",
          "command.execute": "standing",
        },
      },
    });
    const registry = loadRegistry(officialRegistryDir);
    const plan = planInstall({
      projectRoot,
      registry,
      roots: ["agent:coder"],
      project: readProjectDocument(projectRoot),
      manifest: emptyInstalledManifest(),
    });
    applyInstall({ projectRoot, plan });
    fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "src/allowed.txt"), "allowed\n", "utf8");

    const attempts: Array<{
      readonly names: readonly string[];
      readonly outsideWrite: string;
      readonly outsideCommand: string;
    }> = [];
    const createSession: CreatePiSession = async (options) => {
      const tools = new Map((options.customTools ?? []).map((tool) => [tool.name, tool]));
      const read = tools.get("read");
      const write = tools.get("write");
      const bash = tools.get("bash");
      expect(read).toBeDefined();
      expect(write).toBeDefined();
      expect(bash).toBeDefined();
      await read!.execute({ path: "src/allowed.txt" });
      await write!.execute({ path: "src/allowed.txt", contents: "updated\n" });

      let outsideWrite = "none";
      try {
        await write!.execute({ path: "outside.txt", contents: "blocked\n" });
      } catch (error) {
        outsideWrite = error instanceof Error ? error.message : String(error);
      }
      let outsideCommand = "none";
      try {
        await bash!.execute({ command: "echo blocked" });
      } catch (error) {
        outsideCommand = error instanceof Error ? error.message : String(error);
      }
      attempts.push({
        names: [...tools.keys()],
        outsideWrite,
        outsideCommand,
      });

      let listener: ((event: PiSessionEvent) => void) | undefined;
      const session: PiSession = {
        async prompt() {
          listener?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "scoped" },
          });
        },
        subscribe(next) {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        async abort() {},
        dispose() {},
      };
      return session;
    };

    const host = await VibeKitHost.start({
      projectRoot,
      startInterfaces: false,
      createSession,
    });
    try {
      for (const text of ["first turn", "second turn"]) {
        const result = await runCli(["msg", text, "--dir", projectRoot]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain("scoped");
      }
    } finally {
      await host.stop();
    }

    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.names).toEqual(expect.arrayContaining(["read", "write", "bash"]));
      expect(attempt.outsideWrite).toMatch(/effective grant|permission/i);
      expect(attempt.outsideCommand).toMatch(/effective grant|permission/i);
    }
    expect(fs.existsSync(path.join(projectRoot, "src/allowed.txt"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "outside.txt"))).toBe(false);
    expect(fs.readdirSync(path.join(projectRoot, ".vibekit/state/conversations"))).toHaveLength(1);
    expect(readProjectDocument(projectRoot).capabilityBindings["command.execute"]).toBe("tool:execution");
    expect(readProjectDocument(projectRoot).capabilityBindings["source.write"]).toBe("tool:filesystem");
  });
});
