import fs from "node:fs";
import path from "node:path";

import { loadInstalledProviders, resolveEffectiveAuthority } from "@useagentsio/core";
import { adaptCustomTool, createGuardedBuiltinTools } from "@useagentsio/pi";
import { describe, expect, it } from "vitest";

import { makeTempDir } from "../helpers.js";
import { writeRuntimeFixture } from "./helpers.js";

describe("Pi custom tool adapter", () => {
  it("passes SDK parameters to the VibeKit tool instead of the tool-call ID", async () => {
    const root = makeTempDir("vibekit-pi-tool-");
    const file = path.join(root, "hello.txt");
    fs.writeFileSync(file, "hello", "utf8");
    const tool = adaptCustomTool({
      name: "read",
      description: "read a file",
      parameters: { type: "object" },
      execute: (input) => fs.readFileSync(String((input as { path: string }).path), "utf8"),
    });

    const execute = tool.execute as (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
    await expect(execute("tool-call-id", { path: file })).resolves.toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("reads, finds, and greps files through the guarded built-ins", async () => {
    const fixture = writeRuntimeFixture();
    fs.writeFileSync(path.join(fixture.root, "hello.txt"), "hello VibeKit\n", "utf8");
    const tools = createGuardedBuiltinTools({
      cwd: fixture.root,
      project: fixture.project,
      task: fixture.task,
      authority: resolveEffectiveAuthority({
        project: fixture.project,
        agent: fixture.agent,
        task: fixture.task,
        installedProviders: loadInstalledProviders(fixture.root),
      }),
    });
    const execute = (name: string, input: unknown) => tools.find((tool) => tool.name === name)!.execute(input);

    await expect(execute("read", { path: "hello.txt" })).resolves.toBe("hello VibeKit\n");
    await expect(execute("find", { pattern: "*.txt" })).resolves.toContain("hello.txt");
    await expect(execute("grep", { pattern: "VibeKit" })).resolves.toContainEqual({
      path: "hello.txt",
      line: 1,
      text: "hello VibeKit",
    });
  });
});
