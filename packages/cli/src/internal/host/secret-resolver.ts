import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hostError } from "./errors.js";

export function deploymentSecretsPath(projectId: string): string {
  const slug = projectId.replace(/^project:/, "");
  const configRoot = process.env.VIBEKIT_CONFIG_DIR ?? path.join(os.homedir(), ".config", "vibekit");
  return path.join(configRoot, slug, "env");
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
  assertSecretName(name);
  if (value.includes("\n") || value.includes("\r") || value.includes("\u0000")) {
    throw hostError(
      "invalid_input",
      "secret_value_invalid",
      `Secret ${name} must be a single line`,
      { name },
    );
  }
  const filePath = deploymentSecretsPath(projectId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  const existing = fs.existsSync(filePath)
    ? parseEnvFile(fs.readFileSync(filePath, "utf8"))
    : {};
  existing[name] = value;
  writeSecretFile(filePath, existing);
  return filePath;
}

export function removeDeploymentSecret(projectId: string, name: string): boolean {
  assertSecretName(name);
  const filePath = deploymentSecretsPath(projectId);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const existing = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  if (!(name in existing)) {
    return false;
  }
  delete existing[name];
  if (Object.keys(existing).length === 0) {
    fs.rmSync(filePath, { force: true });
  } else {
    writeSecretFile(filePath, existing);
  }
  return true;
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
    const fromFile = this.fileValues[name];
    if (typeof fromFile === "string" && fromFile.length > 0) {
      return fromFile;
    }
    const fromEnv = this.env[name];
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
      return fromEnv;
    }
    throw hostError(
      "authorization_required",
      "secret_missing",
      `Missing secret ${name}`,
      { name, projectId: this.projectId },
    );
  }

  has(name: string): boolean {
    return (typeof this.fileValues[name] === "string" && this.fileValues[name]!.length > 0)
      || (typeof this.env[name] === "string" && this.env[name]!.length > 0);
  }
}

function writeSecretFile(filePath: string, values: Readonly<Record<string, string>>): void {
  const body = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, secret]) => `${key}=${secret}`)
    .join("\n");
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempPath, body.length === 0 ? "" : `${body}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function assertSecretName(name: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw hostError(
      "invalid_input",
      "secret_name_invalid",
      `Invalid deployment secret name ${name}`,
      { name },
    );
  }
}
