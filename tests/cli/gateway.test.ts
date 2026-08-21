import fs from "node:fs";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { applyInstall, createDefaultProject, emptyInstalledManifest, loadRegistry, planInstall, readInstalledManifest, readProjectDocument, writeInstalledManifest, writeProjectDocument } from "@useagentsio/core";
import { VibeKitHost, hostSocketPath, isHostIpcAvailable } from "@useagentsio/host";
import { startGateway, type GatewayHandle } from "../../packages/cli/src/gateway/server.js";
import { dashboardHtml } from "../../packages/cli/src/gateway/dashboard.js";
import { gatewayServiceDefinition, readGatewayPort } from "../../packages/cli/src/gateway/service.js";
import { gatewayHostEnvironment, stopProjectHost } from "../../packages/cli/src/host-control.js";
import { projectRegistryPath, readProjectRegistry, registerProject } from "../../packages/cli/src/project-registry.js";
import { buildTempRegistry, makeTempDir } from "../helpers.js";

const roots: string[] = [];
const gateways: GatewayHandle[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(readProjectRegistry().map((entry) => fs.existsSync(entry.path) ? stopProjectHost(entry.projectId, entry.path) : Promise.resolve()));
  fs.rmSync(projectRegistryPath(), { force: true });
  fs.rmSync(`${projectRegistryPath()}.backup`, { force: true });
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local Gateway", () => {
  it("presents the Project Dashboard and lists every Agent binding", async () => {
    const root = project("dashboard");
    const document = readProjectDocument(root);
    writeProjectDocument(root, {
      ...document,
      agentBindings: {
        chief: { definition: "agent:chief" },
        coder: { definition: "agent:coder" },
      },
    });
    registerProject(root);
    const gateway = await launch();
    const response = await fetch(`http://127.0.0.1:${gateway.status.port}/api/projects`, {
      headers: { "x-vibekit-token": gateway.token },
    });
    const body = await response.json() as { projects: Array<{ agentBindings: string[] }> };

    expect(dashboardHtml("token")).toContain("Project Dashboard");
    expect(dashboardHtml("token")).not.toContain("animation:arrive");
    expect(dashboardHtml("token")).toContain("if(markup!==projectMarkup){dashboard.innerHTML=markup;projectMarkup=markup}");
    expect(body.projects[0]?.agentBindings).toEqual(["chief", "coder"]);

    const configResponse = await fetch(`http://127.0.0.1:${gateway.status.port}/api/projects/${encodeURIComponent(document.id)}/config`, {
      headers: { "x-vibekit-token": gateway.token },
    });
    const config = await configResponse.json() as { project: { execution: { defaultTimeoutMs: number } } };
    expect(configResponse.status).toBe(200);
    expect(config.project.execution.defaultTimeoutMs).toBe(600000);
  });

  it("uses and validates the Gateway port environment override", () => {
    expect(readGatewayPort({ VIBEKIT_GATEWAY_PORT: "9583" })).toBe(9583);
    expect(() => readGatewayPort({ VIBEKIT_GATEWAY_PORT: "invalid" })).toThrow(/VIBEKIT_GATEWAY_PORT/);
  });

  it("enforces token, Host and Origin and bounds/redacts registered logs", async () => {
    const root = project("secure-api");
    registerProject(root);
    fs.mkdirSync(`${root}/.vibekit/runtime`, { recursive: true });
    fs.writeFileSync(`${root}/.vibekit/runtime/host.log`, `${"old\n".repeat(250)}api_key=super-secret-value\nlatest\n`);
    const gateway = await launch();
    const base = `http://127.0.0.1:${gateway.status.port}`;

    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects`, { headers: { "x-vibekit-token": gateway.token, origin: "https://evil.example" } })).status).toBe(403);
    expect(await rawStatus(gateway.status.port, { "x-vibekit-token": gateway.token, host: "evil.example" })).toBe(403);

    const response = await fetch(`${base}/api/projects/project%3Asecure-api/logs`, { headers: { "x-vibekit-token": gateway.token } });
    const body = await response.json() as { logs: string };
    expect(response.status).toBe(200);
    expect(body.logs.split("\n").length).toBeLessThanOrEqual(200);
    expect(body.logs).toContain("[redacted]");
    expect(body.logs).not.toContain("super-secret-value");
  });

  it("preserves partial Start All and confirmed Stop All results across ten Projects", async () => {
    const projectRoots = Array.from({ length: 10 }, (_, index) => project(`dashboard-${index}`));
    for (const root of projectRoots) registerProject(root);
    fs.rmSync(projectRoots[8], { recursive: true });
    fs.writeFileSync(`${projectRoots[9]}/.vibekit/project.yaml`, "invalid: [");
    const gateway = await launch();
    const base = `http://127.0.0.1:${gateway.status.port}`;
    const options = { method: "POST", headers: { "x-vibekit-token": gateway.token, "content-type": "application/json" } };

    const started = await (await fetch(`${base}/api/projects/start-all`, options)).json() as { results: Array<{ ok: boolean; state: string }> };
    expect(started.results).toHaveLength(10);
    expect(started.results.filter((result) => result.ok)).toHaveLength(8);
    expect(started.results.map((result) => result.state)).toEqual(expect.arrayContaining(["missing", "invalid"]));
    expect((await fetch(`${base}/api/projects/stop-all`, options)).status).toBe(400);
    const stopped = await (await fetch(`${base}/api/projects/stop-all`, { ...options, body: JSON.stringify({ confirm: true }) })).json() as { results: Array<{ ok: boolean }> };
    expect(stopped.results).toHaveLength(10);
    expect(stopped.results.filter((result) => result.ok)).toHaveLength(8);
  }, 30_000);

  it("reports a Project's missing credentials without inheriting Gateway secrets", async () => {
    const root = project(`missing-secret-${Date.now()}`, "locked", "model");
    const registryRoot = buildTempRegistry([{ type: "provider", name: "locked", secrets: [{ name: "LOCKED_API_KEY", source: "environment", required: true }] }]);
    roots.push(registryRoot);
    const registry = loadRegistry(registryRoot, `local:${fs.realpathSync(registryRoot)}`);
    applyInstall({ projectRoot: root, plan: planInstall({ projectRoot: root, registry, roots: ["provider:locked"], project: readProjectDocument(root), manifest: readInstalledManifest(root), registrySource: registry.source }) });
    registerProject(root);
    const gateway = await launch();
    const response = await fetch(`http://127.0.0.1:${gateway.status.port}/api/projects/${encodeURIComponent(readProjectDocument(root).id)}/start`, { method: "POST", headers: { "x-vibekit-token": gateway.token } });
    const result = await response.json() as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Missing required secrets: LOCKED_API_KEY");
    expect(fs.existsSync(`${root}/.vibekit/runtime/host.lock`)).toBe(false);
  });

  it("keeps Project Host sockets and configuration isolated when Hosts run together", async () => {
    const firstRoot = project("isolated-a", "openai", "model-a");
    const secondRoot = project("isolated-b", "anthropic", "model-b");
    const first = await VibeKitHost.start({ projectRoot: firstRoot, startInterfaces: false });
    const second = await VibeKitHost.start({ projectRoot: secondRoot, startInterfaces: false });
    try {
      expect(await isHostIpcAvailable(firstRoot)).toBe(true);
      expect(await isHostIpcAvailable(secondRoot)).toBe(true);
      expect(hostSocketPath(firstRoot)).not.toBe(hostSocketPath(secondRoot));
      expect(first.project.defaults?.model).toEqual({ provider: "openai", id: "model-a" });
      expect(second.project.defaults?.model).toEqual({ provider: "anthropic", id: "model-b" });
      expect(first.state.paths.state).not.toBe(second.state.paths.state);
      expect(first.state.paths.runtime).not.toBe(second.state.paths.runtime);
      registerProject(firstRoot);
      registerProject(secondRoot);
      const originalGateway = await startGateway(0);
      await originalGateway.close();
      expect(await isHostIpcAvailable(firstRoot)).toBe(true);
      expect(await isHostIpcAvailable(secondRoot)).toBe(true);
      const replacementGateway = await launch();
      const response = await fetch(`http://127.0.0.1:${replacementGateway.status.port}/api/projects`, { headers: { "x-vibekit-token": replacementGateway.token } });
      const dashboard = await response.json() as { projects: Array<{ state: string }> };
      expect(dashboard.projects.map((item) => item.state)).toEqual(["running", "running"]);
    } finally { await Promise.all([first.stop(), second.stop()]); }
  });

  it("generates login and failure-restart definitions for every supported service manager", () => {
    const base = { cliEntry: "/opt/vibekit/index.js", nodePath: "/usr/bin/node", port: 9467 };
    const launchd = gatewayServiceDefinition({ ...base, platform: "darwin" });
    const systemd = gatewayServiceDefinition({ ...base, platform: "linux" });
    const windows = gatewayServiceDefinition({ ...base, platform: "win32" });
    expect(launchd.contents).toContain("<key>RunAtLoad</key><true/>");
    expect(launchd.contents).toContain("<key>SuccessfulExit</key><false/>");
    expect(systemd.contents).toContain("Restart=on-failure");
    expect(windows.contents).toContain("<RestartOnFailure>");
    expect(windows.contents).toContain("<Count>3</Count>");
    expect(gatewayHostEnvironment({ PATH: "/bin", OPENAI_API_KEY: "secret" })).toEqual({ PATH: "/bin" });
  });
});

async function launch(): Promise<GatewayHandle> {
  const gateway = await startGateway(0);
  gateways.push(gateway);
  return gateway;
}

function project(slug: string, provider = "openai", model = "test-model"): string {
  const root = makeTempDir("vibekit-gateway-project-");
  roots.push(root);
  const document = createDefaultProject({ slug, name: slug, defaultAgent: "chief" });
  writeProjectDocument(root, { ...document, defaults: { model: { provider, id: model } } });
  writeInstalledManifest(root, emptyInstalledManifest());
  return root;
}

function rawStatus(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/api/projects", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end();
  });
}
