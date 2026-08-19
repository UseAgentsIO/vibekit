import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAndValidateYaml } from "@useagentsio/core";
import { afterEach, describe, expect, it } from "vitest";

import { createProcessTool, loadStore } from "@useagentsio/tool-process";
import { makeTempDir } from "../helpers.js";

const moduleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../registry/components/tool/process/1.0.0",
);

const started: Array<{ tool: ReturnType<typeof createProcessTool>; id?: string }> = [];

afterEach(async () => {
  for (const entry of started) {
    if (entry.id !== undefined) {
      await entry.tool.execute({ action: "kill", id: entry.id });
    }
  }
  started.length = 0;
});

describe("tool:process module", () => {
  it("validates registry module.yaml", () => {
    const result = parseAndValidateYaml(
      "component",
      fs.readFileSync(path.join(moduleDir, "module.yaml"), "utf8"),
    );
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(result.data).toMatchObject({
      id: "tool:process",
      runtime: { kind: "pi-extension", export: "createProcessTool" },
    });
  });
});

describe("createProcessTool", () => {
  it("starts, logs, waits, and records pids in runtime state", async () => {
    const projectRoot = makeTempDir("vibekit-proc-");
    const tool = createProcessTool({ projectRoot });
    const startedProc = (await tool.execute({
      action: "start",
      command: `${process.execPath} -e "process.stdout.write('hello-out'); process.stderr.write('err')"` ,
      cwd: ".",
    })) as { id: string; pid: number; status: string };
    started.push({ tool, id: startedProc.id });
    expect(startedProc.id).toMatch(/^p[0-9a-f]+$/);
    expect(startedProc.pid).toBeGreaterThan(0);

    const waited = (await tool.execute({
      action: "wait",
      id: startedProc.id,
      timeoutMs: 5000,
    })) as { status: string; timedOut?: boolean };
    expect(waited.timedOut).not.toBe(true);
    expect(["exited", "killed"]).toContain(waited.status);

    let log = (await tool.execute({ action: "log", id: startedProc.id, bytes: 1024 })) as {
      log: string;
    };
    if (!log.log.includes("hello-out")) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      log = (await tool.execute({ action: "log", id: startedProc.id, bytes: 1024 })) as {
        log: string;
      };
    }
    expect(log.log).toContain("hello-out");

    const store = loadStore(projectRoot);
    expect(store.processes.some((row) => row.id === startedProc.id)).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".vibekit", "runtime", "processes.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".vibekit", "runtime", `proc-${startedProc.id}.log`)),
    ).toBe(true);

    const listed = (await tool.execute({ action: "list" })) as {
      processes: Array<{ id: string }>;
    };
    expect(listed.processes.some((row) => row.id === startedProc.id)).toBe(true);
  });

  it("rejects parent and absolute cwd unless allowAbsoluteCwd is set", async () => {
    const projectRoot = makeTempDir("vibekit-proc-cwd-");
    const tool = createProcessTool({ projectRoot });
    const parent = (await tool.execute({
      action: "start",
      command: "echo no",
      cwd: "..",
    })) as { error: true; message: string };
    expect(parent.error).toBe(true);
    expect(parent.message).toMatch(/\.\./);
    const absolute = (await tool.execute({
      action: "start",
      command: "echo no",
      cwd: "/tmp",
    })) as { error: true };
    expect(absolute.error).toBe(true);

    const allowed = createProcessTool({
      projectRoot,
      config: { allowAbsoluteCwd: true },
    });
    const ok = (await allowed.execute({
      action: "start",
      command: `${process.execPath} -e "process.exit(0)"`,
      cwd: projectRoot,
    })) as { id?: string; error?: true };
    if (ok.id !== undefined) {
      started.push({ tool: allowed, id: ok.id });
      await allowed.execute({ action: "wait", id: ok.id, timeoutMs: 5000 });
    }
    expect(ok.error).toBeUndefined();
    expect(ok.id).toBeDefined();
  });

  it("kills only processes this tool started", async () => {
    const projectRoot = makeTempDir("vibekit-proc-kill-");
    const tool = createProcessTool({ projectRoot });
    const foreign = (await tool.execute({ action: "kill", pid: process.pid })) as {
      error: true;
      code: string;
    };
    expect(foreign.error).toBe(true);
    expect(foreign.code).toBe("permission_denied");

    const running = (await tool.execute({
      action: "start",
      command: `${process.execPath} -e "setInterval(() => {}, 1000)"`,
    })) as { id: string; pid: number };
    started.push({ tool, id: running.id });
    const killed = (await tool.execute({ action: "kill", id: running.id })) as { id: string };
    expect(killed.id).toBe(running.id);
    const polled = (await tool.execute({ action: "wait", id: running.id, timeoutMs: 3000 })) as {
      status: string;
    };
    expect(polled.status).not.toBe("running");
  });

  it("denies all actions without process.manage", async () => {
    const tool = createProcessTool({
      projectRoot: makeTempDir("vibekit-proc-cap-"),
      grantedCapabilities: [],
    });
    const result = (await tool.execute({ action: "list" })) as { code: string };
    expect(result.code).toBe("permission_denied");
  });
});
