import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSchedulerTool } from "../../packages/cli/src/internal/tools/scheduler/index.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("createSchedulerTool", () => {
  it("creates, lists, pauses, and removes jobs", async () => {
    const projectRoot = tempProject();
    const jobsPath = path.join(projectRoot, ".vibekit", "state", "schedules", "jobs.json");
    expect(fs.existsSync(jobsPath)).toBe(false);

    const tool = createSchedulerTool({ projectRoot });
    expect(tool.name).toBe("scheduler");

    const created = asOk(
      await tool.execute({
        action: "create",
        name: "morning-brief",
        schedule: "every 1d",
        prompt: "Write a self-contained morning brief for the operator.",
        timezone: "UTC",
      }),
    );
    expect(created.job?.name).toBe("morning-brief");
    expect(created.job?.allowSchedulerTool).toBe(false);
    expect(created.job?.id).toMatch(/^sch_[0-9a-f]+$/);
    expect(fs.existsSync(jobsPath)).toBe(true);

    const listed = asOk(await tool.execute({ action: "list" }));
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs?.[0]?.enabled).toBe(true);

    const paused = asOk(await tool.execute({ action: "pause", id: created.job?.id }));
    expect(paused.job?.enabled).toBe(false);

    const removed = asOk(await tool.execute({ action: "remove", id: created.job?.id }));
    expect(removed.removed).toBe(created.job?.id);
    expect(asOk(await tool.execute({ action: "list" })).jobs).toEqual([]);
  });

  it("rejects escaped script paths on create", async () => {
    const tool = createSchedulerTool({ projectRoot: tempProject() });
    const escaped = await tool.execute({
      action: "create",
      name: "bad",
      schedule: "30m",
      noAgent: true,
      script: "../secret.js",
      prompt: "",
    });
    expect(escaped).toMatchObject({ ok: false });
    expect(String((escaped as { error: string }).error)).toMatch(/must not contain '\.\.'/);

    const absolute = await tool.execute({
      action: "create",
      name: "abs",
      schedule: "30m",
      noAgent: true,
      script: "/etc/passwd",
      prompt: "",
    });
    expect(absolute).toMatchObject({ ok: false });
    expect(String((absolute as { error: string }).error)).toMatch(/absolute/);
  });

  it("rejects mutating actions when scheduledRun is true", async () => {
    const projectRoot = tempProject();
    const allowed = createSchedulerTool({ projectRoot });
    const seed = asOk(
      await allowed.execute({
        action: "create",
        name: "seed",
        schedule: "30m",
        prompt: "keep this",
      }),
    );

    const locked = createSchedulerTool({ projectRoot, scheduledRun: true });
    const created = await locked.execute({
      action: "create",
      name: "from-cron",
      schedule: "30m",
      prompt: "should not land",
    });
    expect(created).toEqual({ ok: false, error: "Scheduled runs cannot create or edit jobs" });

    const paused = await locked.execute({ action: "pause", id: seed.job?.id });
    expect(paused).toEqual({ ok: false, error: "Scheduled runs cannot create or edit jobs" });

    const listed = asOk(await locked.execute({ action: "list" }));
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs?.[0]?.name).toBe("seed");
  });

  it("also honors fromScheduledRun and allowAgentScheduling", async () => {
    const projectRoot = tempProject();
    const denied = createSchedulerTool({ projectRoot, fromScheduledRun: true });
    expect(await denied.execute({ action: "create", name: "x", schedule: "30m", prompt: "no" })).toEqual({
      ok: false,
      error: "Scheduled runs cannot create or edit jobs",
    });

    const allowed = createSchedulerTool({
      projectRoot,
      scheduledRun: true,
      config: { allowAgentScheduling: true },
    });
    const created = asOk(
      await allowed.execute({
        action: "create",
        name: "override",
        schedule: "2h",
        prompt: "explicitly allowed",
      }),
    );
    expect(created.job?.name).toBe("override");
  });

  it("denies mutating actions when grantedCapabilities lacks schedule.write", async () => {
    const tool = createSchedulerTool({
      projectRoot: tempProject(),
      grantedCapabilities: ["schedule.read"],
    });
    const created = await tool.execute({
      action: "create",
      name: "blocked",
      schedule: "30m",
      prompt: "no write",
    });
    expect(created).toEqual({ ok: false, error: "Missing capability schedule.write" });

    const listed = asOk(await tool.execute({ action: "list" }));
    expect(listed.jobs).toEqual([]);
  });

  it("rejects invalid schedules on create", async () => {
    const tool = createSchedulerTool({ projectRoot: tempProject() });
    const result = await tool.execute({
      action: "create",
      name: "bad-sched",
      schedule: "whenever",
      prompt: "nope",
    });
    expect(result).toMatchObject({ ok: false });
  });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-scheduler-tool-"));
  temps.push(dir);
  return dir;
}

function asOk(value: unknown): {
  ok: true;
  job?: { id: string; name: string; enabled: boolean; allowSchedulerTool?: boolean };
  jobs?: Array<{ id: string; name: string; enabled: boolean }>;
  removed?: string;
} {
  expect(value).toMatchObject({ ok: true });
  return value as {
    ok: true;
    job?: { id: string; name: string; enabled: boolean; allowSchedulerTool?: boolean };
    jobs?: Array<{ id: string; name: string; enabled: boolean }>;
    removed?: string;
  };
}
