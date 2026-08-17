import { spawnSync } from "node:child_process";

export const COMMAND_VERIFIER_ID = "verifier:command" as const;

export interface CommandVerifierRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CommandVerifierResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Run a declared Project command and return the exit status. */
export function runDeclaredCommand(request: CommandVerifierRequest): CommandVerifierResponse {
  const command = request.command.trim();
  if (command === "") {
    throw new Error("Command verifier requires a non-empty command");
  }
  if (request.cwd.trim() === "") {
    throw new Error("Command verifier requires a working directory");
  }
  const spawned = spawnSync(command, {
    cwd: request.cwd,
    shell: true,
    encoding: "utf8",
    timeout: request.timeoutMs ?? 60_000,
    env: request.env ?? process.env,
    maxBuffer: 1024 * 1024,
  });
  const timedOut =
    spawned.error?.message.includes("ETIMEDOUT") === true || spawned.signal === "SIGTERM";
  return {
    exitCode: spawned.status ?? 1,
    stdout: spawned.stdout ?? "",
    stderr: spawned.stderr ?? spawned.error?.message ?? "",
    timedOut,
  };
}

export const commandVerifier = {
  id: COMMAND_VERIFIER_ID,
  type: "command" as const,
  run: runDeclaredCommand,
};
