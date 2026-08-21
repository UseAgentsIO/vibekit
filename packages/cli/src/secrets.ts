import {
  readInstalledManifest,
  readProjectDocument,
  resolveInstalledModule,
  type Registry,
  type SecretReference,
} from "./internal/core/index.js";
import { readDeploymentSecrets, writeDeploymentSecret } from "./internal/host/index.js";

import type { OutputBuffer } from "./output.js";
import { canPrompt } from "./prompt.js";
import { confirm, isSubmit, text } from "./ui/index.js";

export function requiredSecretsFromInstalled(
  projectRoot: string,
  registry: Registry,
): SecretReference[] {
  const manifest = readInstalledManifest(projectRoot);
  const seen = new Set<string>();
  const secrets: SecretReference[] = [];
  for (const module of manifest.modules) {
    let loaded;
    try {
      loaded = resolveInstalledModule(module, registry);
    } catch {
      continue;
    }
    const refs = loaded.secrets ?? [];
    for (const secret of refs) {
      if (secret.required !== true || seen.has(secret.name)) {
        continue;
      }
      seen.add(secret.name);
      secrets.push(secret);
    }
  }
  return secrets;
}

export interface InstalledSecretStatus {
  readonly name: string;
  readonly source: SecretReference["source"];
  readonly required: boolean;
  readonly configured: boolean;
}

export function installedSecretStatus(
  projectRoot: string,
  registry: Registry,
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): InstalledSecretStatus[] {
  const manifest = readInstalledManifest(projectRoot);
  const stored = readDeploymentSecrets(projectId);
  const seen = new Set<string>();
  const statuses: InstalledSecretStatus[] = [];
  for (const module of manifest.modules) {
    let loaded;
    try {
      loaded = resolveInstalledModule(module, registry);
    } catch {
      continue;
    }
    for (const secret of loaded.secrets ?? []) {
      if (seen.has(secret.name)) {
        continue;
      }
      seen.add(secret.name);
      const configured =
        (typeof stored[secret.name] === "string" && stored[secret.name]!.length > 0) ||
        (typeof env[secret.name] === "string" && env[secret.name]!.length > 0);
      statuses.push({
        name: secret.name,
        source: secret.source,
        required: secret.required === true,
        configured,
      });
    }
  }
  return statuses.sort((left, right) => left.name.localeCompare(right.name));
}

export function missingRequiredSecrets(
  projectId: string,
  secrets: readonly SecretReference[],
  env: NodeJS.ProcessEnv = process.env,
): SecretReference[] {
  const stored = readDeploymentSecrets(projectId);
  return secrets.filter((secret) => {
    const fromEnv = env[secret.name];
    const fromStore = stored[secret.name];
    return !(
      (typeof fromEnv === "string" && fromEnv.length > 0) ||
      (typeof fromStore === "string" && fromStore.length > 0)
    );
  });
}

export async function ensureInstalledSecrets(input: {
  readonly projectRoot: string;
  readonly registry: Registry;
  readonly yes: boolean;
  readonly out: OutputBuffer;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const project = readProjectDocument(input.projectRoot);
  const required = requiredSecretsFromInstalled(input.projectRoot, input.registry);
  const stored = readDeploymentSecrets(project.id);
  for (const secret of required) {
    if (typeof stored[secret.name] === "string" && stored[secret.name]!.length > 0) {
      continue;
    }
    const environmentValue = env[secret.name];
    if (typeof environmentValue === "string" && environmentValue.length > 0) {
      if (input.yes || !canPrompt()) {
        if (input.yes) {
          writeDeploymentSecret(project.id, secret.name, environmentValue);
          input.out.log(`Saved ${secret.name} to the local deployment store for ${project.id}.`);
        } else {
          input.out.log(`Using ${secret.name} from the environment.`);
        }
        continue;
      }
      const useEnvironment = await confirm({
        message: `Use ${secret.name} from the environment for ${project.id}?`,
        initial: false,
      });
      if (isSubmit(useEnvironment) && useEnvironment.value) {
        writeDeploymentSecret(project.id, secret.name, environmentValue);
        input.out.log(`Saved ${secret.name} to the local deployment store for ${project.id}.`);
        continue;
      }
    }
    if (input.yes || !canPrompt()) {
      input.out.log(`${secret.name} is not set. Runtime calls that need it will fail until it is.`);
      continue;
    }
    const value = await text({
      message: secret.name,
      secret: true,
      collapse: "saved",
    });
    if (!isSubmit(value) || value.value.length === 0) {
      input.out.log(`${secret.name} skipped.`);
      continue;
    }
    writeDeploymentSecret(project.id, secret.name, value.value);
    env[secret.name] = value.value;
    input.out.log(`Saved ${secret.name} to the local deployment store for ${project.id}.`);
  }
}
