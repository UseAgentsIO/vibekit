import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hostError } from "./errors.js";

export function deploymentSecretsPath(projectId: string): string {
  const slug = projectId.replace(/^project:/, "");
  return path.join(os.homedir(), ".config", "vibekit", slug, "env");
}

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function readDeploymentSecrets(projectId: string): Record<string, string> {
  const filePath = deploymentSecretsPath(projectId);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

export function writeDeploymentSecret(
  projectId: string,
  name: string,
  value: string,
): string {
  const filePath = deploymentSecretsPath(projectId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = fs.existsSync(filePath)
    ? parseEnvFile(fs.readFileSync(filePath, "utf8"))
    : {};
  existing[name] = value;
  const body = Object.entries(existing)
    .map(([key, secret]) => `${key}=${secret}`)
    .join("\n");
  fs.writeFileSync(filePath, `${body}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

export class SecretResolver {
  private readonly fileValues: Record<string, string>;

  constructor(
    private readonly projectId: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    const filePath = deploymentSecretsPath(projectId);
    this.fileValues = fs.existsSync(filePath)
      ? parseEnvFile(fs.readFileSync(filePath, "utf8"))
      : {};
  }

  resolve(name: string): string {
    const fromEnv = this.env[name];
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
      return fromEnv;
    }
    const fromFile = this.fileValues[name];
    if (typeof fromFile === "string" && fromFile.length > 0) {
      return fromFile;
    }
    throw hostError(
      "authorization_required",
      "secret_missing",
      `Missing secret ${name}`,
      { name, projectId: this.projectId },
    );
  }
}
