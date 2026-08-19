import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { conversationKeyOf, type InboundMessage, type InterfaceServices } from "@useagentsio/interface-sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  createScheduleInterface,
  createSchedulerStore,
  ScheduleInterface,
} from "../../packages/interface-schedule/src/index.js";

const temps: string[] = [];
const running: ScheduleInterface[] = [];

afterEach(async () => {
  while (running.length > 0) {
    const item = running.pop();
    if (item !== undefined) {
      await item.stop();
    }
  }
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ScheduleInterface", () => {
  it("does not create jobs.json until the first write", async () => {
    const projectRoot = tempProject();
    const jobsPath = path.join(projectRoot, ".vibekit", "state", "schedules", "jobs.json");
    const store = createSchedulerStore({ projectRoot });
    expect(store.exists()).toBe(false);
    expect(fs.existsSync(jobsPath)).toBe(false);

    const { services } = recordingServices();
    const iface = await openInterface(projectRoot, services);
    await iface.start();
    expect(fs.existsSync(jobsPath)).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".vibekit", "state", "schedules"))).toBe(false);
    expect((await iface.health()).ok).toBe(true);
    expect((await iface.health()).detail).toBe("jobs=0");
  });

  it("fires a due one-shot job once, submits, then disables it", async () => {
    const projectRoot = tempProject();
    const store = createSchedulerStore({ projectRoot });
    const created = store.create({
      name: "once",
      schedule: "2020-01-01T00:00:00.000Z",
      prompt: "Check the overnight backlog",
    });
    expect(created.enabled).toBe(true);

    const { services, submissions } = recordingServices();
    const iface = await openInterface(projectRoot, services);
    await iface.start();

    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.text).toBe("Check the overnight backlog");
    expect(submissions[0]?.accountId).toBe("schedule");
    expect(submissions[0]?.conversationId).toBe(created.id);
    expect(submissions[0]?.sender).toEqual({
      id: `schedule:${created.id}`,
      displayName: "once",
      trusted: true,
    });
    expect(submissions[0]?.conversationKey).toBe(
      conversationKeyOf({
        interfaceBinding: "schedule-main",
        accountId: "schedule",
        conversationId: created.id,
      }),
    );

    const after = store.get(created.id);
    expect(after?.enabled).toBe(false);
    expect(after?.lastStatus).toBe("ok");

    await iface.tick();
    expect(submissions).toHaveLength(1);
  });

  it("advances an interval job without disabling it", async () => {
    const projectRoot = tempProject();
    const store = createSchedulerStore({ projectRoot });
    const created = store.create(
      {
        name: "heartbeat",
        schedule: "every 1h",
        prompt: "Send the hourly heartbeat.",
      },
      new Date("2026-08-18T10:00:00.000Z"),
    );
    store.update(created.id, { nextRunAt: "2026-08-18T09:00:00.000Z" }, new Date("2026-08-18T10:00:00.000Z"));

    const { services, submissions } = recordingServices();
    const iface = await createScheduleInterface(
      {
        projectRoot,
        tickMs: 0,
        interfaceBinding: "schedule-main",
        now: () => new Date("2026-08-18T10:00:00.000Z"),
      },
      services,
    );
    const schedule = iface as ScheduleInterface;
    running.push(schedule);
    await schedule.start();
    expect(submissions).toHaveLength(1);
    const after = store.get(created.id);
    expect(after?.enabled).toBe(true);
    expect(after?.nextRunAt).toBe("2026-08-18T11:00:00.000Z");
  });

  it("uses the lock so overlapping ticks do not double-fire", async () => {
    const projectRoot = tempProject();
    const store = createSchedulerStore({ projectRoot });
    store.create({
      name: "once",
      schedule: "2020-01-01T00:00:00.000Z",
      prompt: "only once",
    });

    const { services, submissions } = recordingServices();
    const first = await openInterface(projectRoot, services);
    const second = await openInterface(projectRoot, services);

    await Promise.all([first.tick(), second.tick()]);
    expect(submissions).toHaveLength(1);
    expect(store.list()[0]?.enabled).toBe(false);
  });

  it("rejects script path escape when creating a job", () => {
    const projectRoot = tempProject();
    const store = createSchedulerStore({ projectRoot });
    expect(() =>
      store.create({
        name: "escape",
        schedule: "30m",
        prompt: "nope",
        noAgent: true,
        script: "../outside.js",
      }),
    ).toThrow(/must not contain '\.\.'/);
    expect(() =>
      store.create({
        name: "abs",
        schedule: "30m",
        prompt: "nope",
        noAgent: true,
        script: "/tmp/outside.js",
      }),
    ).toThrow(/absolute/);
    expect(store.exists()).toBe(false);
  });

  it("runs a silent noAgent script without submitting", async () => {
    const projectRoot = tempProject();
    const scriptRel = "scripts/silent.js";
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, scriptRel), 'process.stdout.write("[SILENT]\\n");\n');

    const store = createSchedulerStore({ projectRoot });
    const created = store.create({
      name: "watchdog",
      schedule: "2020-01-01T00:00:00.000Z",
      prompt: "",
      noAgent: true,
      script: scriptRel,
      silentOnEmpty: true,
    });

    const { services, submissions } = recordingServices();
    const iface = await openInterface(projectRoot, services);
    await iface.start();
    expect(submissions).toEqual([]);
    expect(store.get(created.id)?.lastStatus).toBe("silent");
  });

  it("submits a short failure when a noAgent script exits non-zero", async () => {
    const projectRoot = tempProject();
    const scriptRel = "scripts/fail.js";
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, scriptRel), "process.exit(2);\n");

    const store = createSchedulerStore({ projectRoot });
    const created = store.create({
      name: "watchdog",
      schedule: "2020-01-01T00:00:00.000Z",
      prompt: "",
      noAgent: true,
      script: scriptRel,
    });

    const { services, submissions } = recordingServices();
    const iface = await openInterface(projectRoot, services);
    await iface.start();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.text).toMatch(/failed: exit 2/);
    expect(store.get(created.id)?.lastStatus).toBe("failed");
  });

  it("fails closed without submitting when delivery config is missing", async () => {
    const projectRoot = tempProject();
    const store = createSchedulerStore({ projectRoot });
    store.create({
      name: "needs-delivery",
      schedule: "2020-01-01T00:00:00.000Z",
      prompt: "do not spend tokens",
      deliveryInterface: "slack-main",
    });

    const { services, submissions } = recordingServices();
    const iface = await createScheduleInterface(
      {
        projectRoot,
        tickMs: 0,
        interfaceBinding: "schedule-main",
        requireDelivery: true,
        knownInterfaces: ["terminal-main"],
      },
      services,
    );
    const schedule = iface as ScheduleInterface;
    running.push(schedule);
    await schedule.start();
    expect(submissions).toEqual([]);
    expect(store.list()[0]?.lastStatus).toBe("blocked_config");
  });

  it("records the last HostOutput for a conversationKey", async () => {
    const projectRoot = tempProject();
    const { services } = recordingServices();
    const iface = await openInterface(projectRoot, services);
    const key = conversationKeyOf({
      interfaceBinding: "schedule-main",
      accountId: "schedule",
      conversationId: "sch_demo",
    });
    await iface.deliver({ type: "message.completed", conversationKey: key, text: "[SILENT]" });
    expect(iface.lastOutput(key)?.type).toBe("message.completed");
  });
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-schedule-"));
  temps.push(dir);
  return dir;
}

async function openInterface(
  projectRoot: string,
  services: InterfaceServices,
): Promise<ScheduleInterface> {
  const iface = await createScheduleInterface(
    { projectRoot, tickMs: 0, interfaceBinding: "schedule-main" },
    services,
  );
  expect(iface).toBeInstanceOf(ScheduleInterface);
  const schedule = iface as ScheduleInterface;
  running.push(schedule);
  return schedule;
}

function recordingServices(): {
  services: InterfaceServices;
  submissions: InboundMessage[];
} {
  const submissions: InboundMessage[] = [];
  return {
    submissions,
    services: {
      submit: async (message) => {
        submissions.push(message);
      },
      cancel: async () => true,
      approve: async () => undefined,
      resolveSecret: (name) => name,
      log: {
        info() {},
        warn() {},
        error() {},
      },
    },
  };
}
