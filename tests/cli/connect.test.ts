import fs from "node:fs";
import path from "node:path";

import {
  createDefaultProject,
  emptyInstalledManifest,
  readInstalledManifest,
  readProjectDocument,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const ensurePersistentAvailability = vi.hoisted(() => vi.fn(async () => ({
  projectId: "project:connect-test",
  action: "start" as const,
  ok: true,
  state: "running" as const,
  pid: 4242,
})));

vi.mock("../../packages/cli/src/host-control.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/cli/src/host-control.js")>();
  return { ...actual, ensurePersistentAvailability };
});

import { deploymentSecretsPath } from "@useagentsio/host";
import { parseCliArgs } from "../../packages/cli/src/args.js";
import { runConnect } from "../../packages/cli/src/commands/connect.js";
import { OutputBuffer } from "../../packages/cli/src/output.js";
import { makeTempDir } from "../helpers.js";

const roots: string[] = [];
const previousToken = process.env.TELEGRAM_BOT_TOKEN;
const previousSkipInstall = process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(deploymentSecretsPath("project:connect-test"), { force: true });
  ensurePersistentAvailability.mockClear();
  if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  if (previousSkipInstall === undefined) delete process.env.VIBEKIT_SKIP_PACKAGE_INSTALL;
  else process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = previousSkipInstall;
});

describe("connect telegram", () => {
  it("persists only Telegram composition, stores the token safely, and leaves other channels disabled", async () => {
    const root = makeTempDir("vibekit-connect-");
    roots.push(root);
    const project = createDefaultProject({ slug: "connect-test", name: "Connect Test", defaultAgent: "assistant" });
    writeProjectDocument(root, {
      ...project,
      agentBindings: { assistant: { definition: "agent:assistant" } },
      interfaceBindings: {
        "terminal-main": { definition: "interface:terminal", enabled: false, defaultAgent: "assistant" },
      },
    });
    writeInstalledManifest(root, emptyInstalledManifest());
    process.env.TELEGRAM_BOT_TOKEN = "bot-token-that-must-not-be-printed";
    process.env.VIBEKIT_SKIP_PACKAGE_INSTALL = "1";

    const parsed = parseCliArgs(["connect", "telegram", "--dir", root, "--yes"]);
    const out = new OutputBuffer();
    const exitCode = await runConnect(parsed.positionals, parsed.flags, out);
    expect(exitCode, out.stderr).toBe(0);
    expect(out.stdout).not.toContain("bot-token-that-must-not-be-printed");
    expect(out.stderr).not.toContain("bot-token-that-must-not-be-printed");
    expect(ensurePersistentAvailability).toHaveBeenCalledWith(root, {
      ensureGateway: true,
      installGateway: false,
      requireSecrets: true,
    });

    const installed = readInstalledManifest(root).modules.map((module) => module.id);
    expect(installed).toEqual(expect.arrayContaining([
      "interface:telegram",
      "policy:interface-pairing",
      "policy:untrusted-inbound",
    ]));
    const saved = readProjectDocument(root);
    expect(saved.interfaceBindings?.["telegram-main"]).toEqual({
      definition: "interface:telegram",
      enabled: true,
      defaultAgent: "assistant",
      config: ".vibekit/config/interfaces/telegram.yaml",
    });
    expect(saved.interfaceBindings?.["terminal-main"]?.enabled).toBe(false);
    expect(saved.policies).toEqual(expect.arrayContaining(["policy:interface-pairing", "policy:untrusted-inbound"]));
    expect(fs.readFileSync(path.join(root, ".vibekit/config/interfaces/telegram.yaml"), "utf8")).toBe("{}\n");
    const secretPath = deploymentSecretsPath("project:connect-test");
    expect(fs.statSync(secretPath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(secretPath, "utf8")).toContain("TELEGRAM_BOT_TOKEN=bot-token-that-must-not-be-printed");
  });
});
