import { spawn, type ChildProcess } from "node:child_process";

import type { IsolationMode, ProjectDocument, SecretReference } from "@useagentsio/core";

import {
  filterEnvironment,
  type FilterEnvironmentInput,
  type FilteredEnvironment,
} from "./env.js";
import { fail } from "./fail.js";

export const ISOLATED_CHILD_PROTOCOL = {
  version: 1,
  messages: ["start", "abort", "result"],
} as const;

export interface ProcessIsolationPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly runtimeNames: readonly string[];
  readonly secretNames: readonly string[];
  readonly stripped: readonly string[];
  readonly protocol: typeof ISOLATED_CHILD_PROTOCOL;
}

export interface PlanProcessIsolationInput {
  readonly cwd: string;
  readonly secrets?: readonly SecretReference[];
  readonly source?: NodeJS.ProcessEnv;
  readonly extra?: Readonly<Record<string, string>>;
  readonly environment?: FilteredEnvironment;
  readonly execPath?: string;
  readonly scriptPath?: string;
  readonly args?: readonly string[];
}

export interface IsolatedChild {
  readonly pid: number | undefined;
  readonly process: ChildProcess;
  readonly plan: ProcessIsolationPlan;
  wait(): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  kill(signal?: NodeJS.Signals): boolean;
}

export function requiresProcessIsolation(input: {
  readonly project: Pick<ProjectDocument, "execution">;
  readonly isolation?: IsolationMode;
  readonly mutating?: boolean;
}): boolean {
  if (input.isolation === "process") {
    return true;
  }
  if (input.project.execution.defaultIsolation === "process") {
    return true;
  }
  if (input.mutating === true && input.project.execution.mutationIsolation === "process") {
    return true;
  }
  return false;
}

export function planProcessIsolation(input: PlanProcessIsolationInput): ProcessIsolationPlan {
  const source = input.source ?? process.env;
  const filtered =
    input.environment ??
    filterEnvironment({
      secrets: input.secrets ?? [],
      source,
      extra: input.extra,
    } satisfies FilterEnvironmentInput);

  const stripped = Object.keys(source)
    .filter((name) => {
      const value = source[name];
      return typeof value === "string" && value.length > 0 && filtered.env[name] === undefined;
    })
    .sort();

  const args: string[] = [];
  if (input.scriptPath !== undefined) {
    args.push(input.scriptPath);
  }
  if (input.args !== undefined) {
    args.push(...input.args);
  }

  return {
    command: input.execPath ?? process.execPath,
    args,
    cwd: input.cwd,
    env: { ...filtered.env },
    runtimeNames: [...filtered.runtimeNames],
    secretNames: [...filtered.secretNames],
    stripped,
    protocol: ISOLATED_CHILD_PROTOCOL,
  };
}

export function spawnIsolatedProcess(plan: ProcessIsolationPlan): IsolatedChild {
  const child = spawn(plan.command, [...plan.args], {
    cwd: plan.cwd,
    env: { ...plan.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const wait = (): Promise<{ stdout: string; stderr: string; exitCode: number | null }> =>
    new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({ stdout, stderr, exitCode: code });
      });
    });

  return {
    pid: child.pid,
    process: child,
    plan,
    wait,
    kill(signal?: NodeJS.Signals): boolean {
      return child.killed ? true : child.kill(signal);
    },
  };
}

export async function runIsolatedProcess(
  plan: ProcessIsolationPlan,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawnIsolatedProcess(plan);
  try {
    return await child.wait();
  } catch (error) {
    child.kill("SIGTERM");
    throw fail(
      "external_error",
      "isolated_process_failed",
      error instanceof Error ? error.message : "Isolated child process failed",
    );
  }
}
