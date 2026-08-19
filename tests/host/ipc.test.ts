import fs from "node:fs";
import path from "node:path";

import { createDefaultProject, writeInstalledManifest, writeProjectDocument, emptyInstalledManifest } from "@useagentsio/core";
import {
  VibeKitHost,
  hostSocketPath,
  isHostIpcAvailable,
  submitViaIpc,
  type RunTurn,
} from "@useagentsio/host";
import { conversationKeyOf } from "@useagentsio/interface-sdk";
import { describe, expect, it } from "vitest";
import { runCli } from "vibekit";

import { makeTempDir } from "../helpers.js";

function writeProject(dir: string) {
  const project = {
    ...createDefaultProject({ slug: "demo", name: "Demo", defaultAgent: "chief" }),
    agentBindings: { chief: { definition: "agent:chief" as const } },
    interfaceBindings: {
      "terminal-main": {
        definition: "interface:terminal" as const,
        enabled: false,
        defaultAgent: "chief",
      },
    },
  };
  writeProjectDocument(dir, project);
  writeInstalledManifest(dir, emptyInstalledManifest());
  return project;
}

const echoTurn: RunTurn = async (request) => ({
  task: {
    schemaVersion: 1,
    id: "task_550e8400-e29b-41d4-a716-446655440099",
    projectId: request.project.id,
    objective: request.message.text,
    context: { references: [] },
    constraints: [],
    acceptanceCriteria: [],
    requiredCapabilities: [],
    assignedAgent: "agent:chief",
    claimedBy: null,
    scope: { paths: [], resources: [] },
    dependencies: [],
    priority: "normal",
    delivery: { mode: "apply" },
    authorization: { state: "standing" },
    status: "open",
    revision: 1,
    createdAt: request.message.timestamp,
    updatedAt: request.message.timestamp,
  },
  runId: "run_550e8400-e29b-41d4-a716-446655440099",
  text: `echo:${request.message.text}`,
  cancelled: false,
  events: [],
  sessionPath: request.conversation.sessionPath,
});

describe("Host IPC", () => {
  it("exposes a local socket and submits turns through it", async () => {
    const dir = makeTempDir("vibekit-host-ipc-");
    writeProject(dir);
    const host = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      runTurn: echoTurn,
    });

    try {
      expect(await isHostIpcAvailable(dir)).toBe(true);
      const socketPath = hostSocketPath(dir);
      expect(fs.existsSync(socketPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
      }
      const status = JSON.parse(
        fs.readFileSync(path.join(dir, ".vibekit/runtime/host-status.json"), "utf8"),
      ) as { socketPath?: string };
      expect(status.socketPath).toBe(socketPath);

      const conversationKey = conversationKeyOf({
        interfaceBinding: "terminal-main",
        accountId: "local",
        conversationId: "cli",
      });
      const result = await submitViaIpc(dir, {
        eventId: "evt-ipc-1",
        interfaceBinding: "terminal-main",
        accountId: "local",
        conversationId: "cli",
        conversationKey,
        sender: { id: "local", trusted: true },
        text: "hello",
        attachments: [],
        timestamp: "2026-08-17T12:00:00.000Z",
      });
      expect(result.duplicate).toBe(false);
      expect(result.text).toBe("echo:hello");
    } finally {
      await host.stop();
    }

    expect(await isHostIpcAvailable(dir)).toBe(false);
    expect(fs.existsSync(hostSocketPath(dir))).toBe(false);
  });

  it("still refuses a second Host lock on the same Project", async () => {
    const dir = makeTempDir("vibekit-host-ipc-lock-");
    writeProject(dir);
    const first = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      runTurn: echoTurn,
    });
    try {
      await expect(
        VibeKitHost.start({ projectRoot: dir, startInterfaces: false }),
      ).rejects.toMatchObject({ code: "host_already_running" });
    } finally {
      await first.stop();
    }
  });

  it("routes vibekit msg to the running Host over IPC", async () => {
    const dir = makeTempDir("vibekit-host-ipc-cli-");
    writeProject(dir);
    const host = await VibeKitHost.start({
      projectRoot: dir,
      startInterfaces: false,
      runTurn: echoTurn,
    });
    try {
      const result = await runCli(["msg", "hello", "--dir", dir]);
      expect(result.stderr).not.toContain("host_already_running");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("echo:hello");
    } finally {
      await host.stop();
    }
  });
});
