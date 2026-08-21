import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VibeKitError } from "../internal/core/index.js";

import { vibekitConfigDir } from "../project-registry.js";

const LABEL = "io.useagents.vibekit.gateway";
export const DEFAULT_GATEWAY_PORT = 9467;
export const GATEWAY_PORT_ENV = "VIBEKIT_GATEWAY_PORT";

export type ServicePlatform = "launchd" | "systemd" | "windows";

export interface GatewayServiceDefinition {
  readonly platform: ServicePlatform;
  readonly file: string;
  readonly contents: string;
}

export function readGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env[GATEWAY_PORT_ENV];
  if (configured !== undefined) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new VibeKitError({ category: "invalid_input", code: "gateway_port_invalid", message: `${GATEWAY_PORT_ENV} must be an integer from 1 to 65535` });
    }
    return port;
  }
  try {
    const value = JSON.parse(fs.readFileSync(path.join(vibekitConfigDir(), "gateway", "config.json"), "utf8")) as { port?: unknown };
    return typeof value.port === "number" && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 ? value.port : DEFAULT_GATEWAY_PORT;
  } catch { return DEFAULT_GATEWAY_PORT; }
}

export function writeGatewayPort(port: number): void {
  const file = path.join(vibekitConfigDir(), "gateway", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, `${JSON.stringify({ port }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}

export async function gatewayIsRunning(port: number, timeoutMs = 500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json() as { readonly ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the local dashboard only for the current user session. Installing a
 * login service remains an explicit advanced action or an approved caller's
 * follow-up, so opening the dashboard never mutates operating-system services.
 */
export async function ensureGatewayRunning(port = readGatewayPort()): Promise<void> {
  if (await gatewayIsRunning(port)) return;
  const entry = process.env.VIBEKIT_CLI_ENTRY ?? process.argv[1];
  if (entry === undefined || entry.length === 0) {
    throw new VibeKitError({ category: "unavailable", code: "gateway_entry_missing", message: "VibeKit could not locate its dashboard process" });
  }
  const gatewayDir = path.join(vibekitConfigDir(), "gateway");
  fs.mkdirSync(gatewayDir, { recursive: true, mode: 0o700 });
  const logPath = path.join(gatewayDir, "gateway.log");
  const logFd = fs.openSync(logPath, "a", 0o600);
  fs.chmodSync(logPath, 0o600);
  const child = spawn(process.execPath, [...runtimeLoaderArgs(entry), entry, "gateway", "run", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: process.cwd(),
    env: gatewayProcessEnvironment(process.env),
  });
  child.unref();
  fs.closeSync(logFd);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await gatewayIsRunning(port)) return;
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new VibeKitError({ category: "unavailable", code: "gateway_start_failed", message: `VibeKit could not open the dashboard. Check ${logPath} for the local diagnostic.` });
}

function gatewayProcessEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR", "APPDATA", "LOCALAPPDATA", "NODE_PATH", "VIBEKIT_CONFIG_DIR", "VIBEKIT_CLI_ENTRY"];
  return Object.fromEntries(names.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]]));
}

function runtimeLoaderArgs(entry: string): string[] {
  if (!/\.tsx?$/.test(entry)) return [];
  const args: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const current = process.execArgv[index];
    const next = process.execArgv[index + 1];
    if ((current === "--require" || current === "--import") && next?.includes("tsx")) {
      args.push(current, next);
      index += 1;
    } else if ((current.startsWith("--require=") || current.startsWith("--import=")) && current.includes("tsx")) {
      args.push(current);
    }
  }
  return args;
}

export function gatewayServiceDefinition(input: { cliEntry: string; nodePath?: string; port: number; platform?: NodeJS.Platform }): GatewayServiceDefinition {
  const platform = input.platform ?? process.platform;
  const node = input.nodePath ?? process.execPath;
  const args = [node, input.cliEntry, "gateway", "run", "--port", String(input.port)];
  const gatewayDir = path.join(vibekitConfigDir(), "gateway");
  if (platform === "darwin") {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    const values = args.map((value) => `      <string>${xml(value)}</string>`).join("\n");
    return { platform: "launchd", file, contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>\n${values}\n  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(path.join(gatewayDir, "gateway.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(gatewayDir, "gateway.log"))}</string>
</dict></plist>\n` };
  }
  if (platform === "win32") {
    const file = path.join(gatewayDir, "gateway-task.xml");
    const command = xml(node);
    const argumentsText = args.slice(1).map(windowsQuote).join(" ");
    return { platform: "windows", file, contents: `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><RestartOnFailure><Interval>PT30S</Interval><Count>3</Count></RestartOnFailure><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${command}</Command><Arguments>${xml(argumentsText)}</Arguments></Exec></Actions></Task>\n` };
  }
  const file = path.join(os.homedir(), ".config", "systemd", "user", "vibekit-gateway.service");
  return { platform: "systemd", file, contents: `[Unit]\nDescription=VibeKit local Gateway\n\n[Service]\nExecStart=${args.map(systemdQuote).join(" ")}\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n` };
}

export function installGatewayService(definition: GatewayServiceDefinition): void {
  fs.mkdirSync(path.dirname(definition.file), { recursive: true });
  fs.writeFileSync(definition.file, definition.contents, { mode: 0o600 });
  if (definition.platform === "launchd") run("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, definition.file]);
  else if (definition.platform === "systemd") { run("systemctl", ["--user", "daemon-reload"]); run("systemctl", ["--user", "enable", "--now", "vibekit-gateway.service"]); }
  else run("schtasks", ["/Create", "/TN", "VibeKit Gateway", "/XML", definition.file, "/F"]);
}

export function uninstallGatewayService(definition: GatewayServiceDefinition): void {
  if (definition.platform === "launchd") spawnSync("launchctl", ["bootout", `gui/${process.getuid?.()}`, definition.file], { stdio: "ignore" });
  else if (definition.platform === "systemd") spawnSync("systemctl", ["--user", "disable", "--now", "vibekit-gateway.service"], { stdio: "ignore" });
  else spawnSync("schtasks", ["/Delete", "/TN", "VibeKit Gateway", "/F"], { stdio: "ignore" });
  fs.rmSync(definition.file, { force: true });
}

export function controlGatewayService(definition: GatewayServiceDefinition, action: "start" | "stop" | "restart"): void {
  if (definition.platform === "launchd") {
    const target = `gui/${process.getuid?.()}/${LABEL}`;
    if (action === "restart") { run("launchctl", ["kickstart", "-k", target]); return; }
    run("launchctl", [action === "start" ? "kickstart" : "kill", ...(action === "stop" ? ["SIGTERM"] : []), target]);
  } else if (definition.platform === "systemd") run("systemctl", ["--user", action, "vibekit-gateway.service"]);
  else if (action === "restart") { run("schtasks", ["/End", "/TN", "VibeKit Gateway"]); run("schtasks", ["/Run", "/TN", "VibeKit Gateway"]); }
  else run("schtasks", [action === "stop" ? "/End" : "/Run", "/TN", "VibeKit Gateway"]);
}

export function openDashboard(port: number): void {
  const url = `http://127.0.0.1:${port}`;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new VibeKitError({ category: "external_error", code: "gateway_service_failed", message: result.stderr?.trim() || `${command} failed` });
}
function xml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char); }
function systemdQuote(value: string): string { return `"${value.replace(/([\\"])/g, "\\$1")}"`; }
function windowsQuote(value: string): string { return `"${value.replace(/"/g, '\\"')}"`; }
