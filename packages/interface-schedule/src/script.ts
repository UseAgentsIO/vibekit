import { spawn } from "node:child_process";
import path from "node:path";

import { resolveInsideProject } from "@useagentsio/schedule-core";

export interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const JS_EXT = new Set([".js", ".mjs", ".cjs"]);

export function runJobScript(input: {
  readonly projectRoot: string;
  readonly script: string;
  readonly timeoutMs: number;
}): Promise<ScriptResult> {
  const resolved = resolveInsideProject(input.projectRoot, input.script, "script");
  const cwd = path.resolve(input.projectRoot);
  const ext = path.extname(resolved).toLowerCase();
  const command = JS_EXT.has(ext) ? process.execPath : resolved;
  const args = JS_EXT.has(ext) ? [resolved] : [];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "",
  };

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? (timedOut ? 124 : 1),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export function isSilentOutput(stdout: string): boolean {
  const text = stdout.trim();
  return text.length === 0 || text === "[SILENT]";
}
