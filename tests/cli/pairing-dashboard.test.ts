import fs from "node:fs";

import { createDefaultProject, emptyInstalledManifest, writeInstalledManifest, writeProjectDocument } from "@useagentsio/core";
import { approvePairing, issuePairingCode, listPairings } from "@useagentsio/interface-telegram";
import { afterEach, describe, expect, it } from "vitest";

import { startGateway, type GatewayHandle } from "../../packages/cli/src/gateway/server.js";
import { dashboardHtml } from "../../packages/cli/src/gateway/dashboard.js";
import { projectRegistryPath, readProjectRegistry, registerProject } from "../../packages/cli/src/project-registry.js";
import { makeTempDir } from "../helpers.js";

const roots: string[] = [];
const gateways: GatewayHandle[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  fs.rmSync(projectRegistryPath(), { force: true });
  fs.rmSync(`${projectRegistryPath()}.backup`, { force: true });
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Telegram pairing dashboard", () => {
  it("shows a pending sender and approves it through the explicit dashboard action", async () => {
    const root = makeTempDir("vibekit-pairing-dashboard-");
    roots.push(root);
    writeProjectDocument(root, createDefaultProject({ slug: "pairing-dashboard", name: "Pairing Dashboard", defaultAgent: "assistant" }));
    writeInstalledManifest(root, emptyInstalledManifest());
    const pending = issuePairingCode(root, "42", "Ada");
    registerProject(root);
    const gateway = await startGateway(0);
    gateways.push(gateway);
    const base = `http://127.0.0.1:${gateway.status.port}`;
    const headers = { "x-vibekit-token": gateway.token };

    const listed = await fetch(`${base}/api/projects/${encodeURIComponent("project:pairing-dashboard")}/pairings`, { headers });
    expect(listed.status).toBe(200);
    const listedBody = await listed.json() as { pending: Array<{ code: string; userId: string; displayName?: string }> };
    expect(listedBody.pending[0]).toMatchObject({ code: pending.code, userId: "42", displayName: "Ada" });

    const approved = await fetch(`${base}/api/projects/${encodeURIComponent("project:pairing-dashboard")}/pairings/${pending.code}/approve`, { method: "POST", headers });
    expect(approved.status).toBe(200);
    const approvedBody = await approved.json() as { owner: { userId: string; displayName?: string } };
    expect(approvedBody.owner).toMatchObject({ userId: "42", displayName: "Ada" });
    expect(listPairings(root).pending).toEqual([]);
    expect(listPairings(root).owner?.userId).toBe("42");
    expect(dashboardHtml("token")).toContain("approve-pairing");
  });
});
