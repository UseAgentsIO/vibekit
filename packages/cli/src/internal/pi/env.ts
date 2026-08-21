import type { SecretReference } from "../core/index.js";

import { configurationInvalid } from "./fail.js";

export const REQUIRED_RUNTIME_ENV = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
] as const;

export interface FilteredEnvironment {
  readonly env: Readonly<Record<string, string>>;
  readonly runtimeNames: readonly string[];
  readonly secretNames: readonly string[];
}

export interface FilterEnvironmentInput {
  readonly secrets: readonly SecretReference[];
  readonly source?: NodeJS.ProcessEnv;
  readonly extra?: Readonly<Record<string, string>>;
}

export function filterEnvironment(input: FilterEnvironmentInput): FilteredEnvironment {
  const source = input.source ?? process.env;
  const env: Record<string, string> = {};
  const runtimeNames: string[] = [];

  for (const name of REQUIRED_RUNTIME_ENV) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) {
      env[name] = value;
      runtimeNames.push(name);
    }
  }

  if (input.extra !== undefined) {
    for (const [name, value] of Object.entries(input.extra)) {
      if (!isAuthorizedName(name, input.secrets) && !isRuntimeName(name)) {
        throw configurationInvalid(
          "env_extra_unauthorized",
          `Refusing to pass unauthorized environment variable ${name}`,
          { name },
        );
      }
      env[name] = value;
    }
  }

  const secretNames: string[] = [];
  const missing: string[] = [];
  for (const secret of input.secrets) {
    if (secret.source !== "environment" && secret.source !== "deployment") {
      throw configurationInvalid(
        "secret_source_unsupported",
        `Secret ${secret.name} uses unsupported source ${secret.source}`,
        { name: secret.name, source: secret.source },
      );
    }
    const value = source[secret.name];
    const required = secret.required !== false;
    if (typeof value === "string" && value.length > 0) {
      env[secret.name] = value;
      secretNames.push(secret.name);
      continue;
    }
    if (required) {
      missing.push(secret.name);
    }
  }

  if (missing.length > 0) {
    throw configurationInvalid(
      "secret_missing",
      `Required secret references are not present in the environment: ${missing.join(", ")}`,
      { missing },
    );
  }

  return { env, runtimeNames, secretNames };
}

function isRuntimeName(name: string): boolean {
  return (REQUIRED_RUNTIME_ENV as readonly string[]).includes(name);
}

function isAuthorizedName(name: string, secrets: readonly SecretReference[]): boolean {
  return secrets.some((secret) => secret.name === name);
}
