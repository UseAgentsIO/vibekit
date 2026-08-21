import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { readProjectDocument, VibeKitError } from "../internal/core/index.js";
import { approvePairing, listPairings, type PairedSender } from "../internal/interfaces/telegram/index.js";

import type { GatewayStatus, ProjectDashboardSnapshot, ProjectDashboardState, ProjectLifecycleResult } from "../contracts.js";
import { gatewayHostEnvironment, inspectProject, readProjectLog, startProjectHost, stopProjectHost } from "../host-control.js";
import { locateProject, readProjectRegistry, registerProject, registeredProject, unregisterProject, vibekitConfigDir } from "../project-registry.js";
import { dashboardHtml } from "./dashboard.js";
import { DEFAULT_GATEWAY_PORT } from "./service.js";

const LOOPBACK = "127.0.0.1" as const;
const MAX_BODY = 64 * 1024;

export interface GatewayHandle {
  readonly status: GatewayStatus;
  readonly token: string;
  close(): Promise<void>;
}

export async function startGateway(port = DEFAULT_GATEWAY_PORT): Promise<GatewayHandle> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new VibeKitError({ category: "invalid_input", code: "gateway_port_invalid", message: `Invalid Gateway port: ${port}` });
  const token = gatewayToken();
  const startedAt = new Date().toISOString();
  let status: GatewayStatus = { ok: true, pid: process.pid, host: LOOPBACK, port, startedAt, projectCount: readProjectRegistry().length };
  const server = http.createServer((request, response) => { void route(request, response, token, status).catch((error) => sendError(response, error)); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Gateway failed to bind");
  status = { ...status, port: address.port };
  writeGatewayStatus(status);
  return {
    status,
    token,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => { fs.rmSync(gatewayStatusPath(), { force: true }); error ? reject(error) : resolve(); })),
  };
}

export async function dashboardSnapshot(): Promise<ProjectDashboardSnapshot> {
  const projects = await Promise.all(readProjectRegistry().map((entry) => inspectProject(entry.projectId, entry.path, entry.registeredAt)));
  const counts: Record<ProjectDashboardState, number> = { running: 0, starting: 0, stopped: 0, unhealthy: 0, missing: 0, invalid: 0 };
  for (const project of projects) counts[project.state] += 1;
  return { generatedAt: new Date().toISOString(), projects, counts };
}

async function route(request: IncomingMessage, response: ServerResponse, token: string, gateway: GatewayStatus): Promise<void> {
  if (!validSource(request, gateway.port)) return sendJson(response, 403, { error: "Loopback Host and Origin required" });
  const url = new URL(request.url ?? "/", `http://${LOOPBACK}:${gateway.port}`);
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, "text/html; charset=utf-8", dashboardHtml(token));
  if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ...gateway, projectCount: readProjectRegistry().length });
  if (!url.pathname.startsWith("/api/") || !validToken(request, token)) return sendJson(response, 401, { error: "Gateway token required" });
  if (request.method === "GET" && url.pathname === "/api/projects") return sendJson(response, 200, await dashboardSnapshot());
  if (request.method === "POST" && url.pathname === "/api/projects") return sendJson(response, 201, registerProject(requirePath(await readBody(request))));
  if (request.method === "POST" && url.pathname === "/api/projects/start-all") return sendJson(response, 200, await bulk("start"));
  if (request.method === "POST" && url.pathname === "/api/projects/stop-all") {
    const body = await readBody(request);
    if (body.confirm !== true) return sendJson(response, 400, { error: "Stop All requires confirm: true" });
    return sendJson(response, 200, await bulk("stop"));
  }
  const pairingMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/pairings(?:\/([^/]+)\/approve)?$/);
  if (pairingMatch !== null) {
    const projectId = decodeURIComponent(pairingMatch[1]);
    const entry = registeredProject(projectId);
    if (pairingMatch[2] === undefined) {
      if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
      return sendJson(response, 200, { projectId, ...listPairings(entry.path) });
    }
    if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
    let paired: PairedSender;
    try {
      paired = approvePairing(entry.path, decodeURIComponent(pairingMatch[2]));
    } catch (error) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "pairing_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return sendJson(response, 200, { projectId, paired, owner: listPairings(entry.path).owner });
  }
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(start|stop|restart|open|locate|logs|config))?$/);
  if (match === null) return sendJson(response, 404, { error: "Not found" });
  const projectId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "DELETE" && action === undefined) return sendJson(response, 200, await unregisterProject(projectId));
  const entry = registeredProject(projectId);
  if (request.method === "GET" && action === "logs") return sendJson(response, 200, { projectId, logs: readProjectLog(entry.path) });
  if (request.method === "GET" && action === "config") return sendJson(response, 200, { projectId, project: readProjectDocument(entry.path) });
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  if (action === "start" || action === "stop" || action === "restart" || action === "open") await assertLifecycleTarget(entry);
  if (action === "start") return sendJson(response, 200, await startProjectHost(projectId, entry.path, { env: gatewayHostEnvironment(), requireSecrets: true }));
  if (action === "stop") return sendJson(response, 200, await stopProjectHost(projectId, entry.path));
  if (action === "restart") {
    const stopped = await stopProjectHost(projectId, entry.path);
    return sendJson(response, 200, stopped.ok ? { ...await startProjectHost(projectId, entry.path, { env: gatewayHostEnvironment(), requireSecrets: true }), action: "restart" } : { ...stopped, action: "restart" });
  }
  if (action === "open") return sendJson(response, 200, openFolder(projectId, entry.path));
  if (action === "locate") return sendJson(response, 200, locateProject(projectId, requirePath(await readBody(request))));
  return sendJson(response, 404, { error: "Not found" });
}

async function assertLifecycleTarget(entry: { projectId: string; path: string; registeredAt: string }): Promise<void> {
  const snapshot = await inspectProject(entry.projectId, entry.path, entry.registeredAt);
  if (snapshot.state === "missing" || snapshot.state === "invalid") {
    throw new VibeKitError({ category: "conflict", code: "project_unavailable", message: snapshot.error ?? `Project is ${snapshot.state}` });
  }
}

async function bulk(action: "start" | "stop"): Promise<{ results: ProjectLifecycleResult[] }> {
  const results = await Promise.all(readProjectRegistry().map(async (entry): Promise<ProjectLifecycleResult> => {
    try {
      const snapshot = await inspectProject(entry.projectId, entry.path, entry.registeredAt);
      if (snapshot.state === "missing" || snapshot.state === "invalid") {
        return { projectId: entry.projectId, action, ok: false, state: snapshot.state, error: snapshot.error ?? `Project is ${snapshot.state}` };
      }
      return action === "start" ? await startProjectHost(entry.projectId, entry.path, { env: gatewayHostEnvironment(), requireSecrets: true }) : await stopProjectHost(entry.projectId, entry.path);
    } catch (error) {
      return { projectId: entry.projectId, action, ok: false, state: "invalid", error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return { results };
}

function gatewayToken(): string {
  const dir = path.join(vibekitConfigDir(), "gateway");
  const file = path.join(dir, "token");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return fs.readFileSync(file, "utf8").trim();
}

function validToken(request: IncomingMessage, expected: string): boolean {
  const value = request.headers["x-vibekit-token"];
  if (typeof value !== "string") return false;
  const a = createHash("sha256").update(value).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function validSource(request: IncomingMessage, port: number): boolean {
  const hosts = new Set([`${LOOPBACK}:${port}`, `localhost:${port}`]);
  if (!hosts.has(request.headers.host ?? "")) return false;
  const origin = request.headers.origin;
  return origin === undefined || origin === `http://${LOOPBACK}:${port}` || origin === `http://localhost:${port}`;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_BODY) throw new VibeKitError({ category: "invalid_input", code: "request_too_large", message: "Request body exceeds 64 KiB" });
    chunks.push(value);
  }
  try { return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { throw new VibeKitError({ category: "invalid_input", code: "request_invalid", message: "Request body must be JSON" }); }
}

function requirePath(body: Record<string, unknown>): string {
  if (typeof body.path !== "string" || !path.isAbsolute(body.path)) throw new VibeKitError({ category: "invalid_input", code: "project_path_invalid", message: "An absolute Project path is required" });
  return body.path;
}

function openFolder(projectId: string, projectRoot: string): ProjectLifecycleResult {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = spawn(command, [projectRoot], { detached: true, stdio: "ignore" });
  child.unref();
  return { projectId, action: "open", ok: true, state: "stopped" };
}

function gatewayStatusPath(): string { return path.join(vibekitConfigDir(), "gateway", "status.json"); }
function writeGatewayStatus(status: GatewayStatus): void {
  const file = gatewayStatusPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void { send(response, status, "application/json; charset=utf-8", JSON.stringify(body)); }
function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
  response.end(body);
}
function sendError(response: ServerResponse, error: unknown): void {
  const category = error instanceof VibeKitError ? error.category : undefined;
  const status = category === "invalid_input" || category === "configuration_invalid" ? 400
    : category === "permission_denied" ? 403
      : category === "conflict" || category === "resource_busy" ? 409
        : category === "unavailable" ? 503 : 500;
  sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
}
