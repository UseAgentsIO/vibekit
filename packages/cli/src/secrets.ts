import {
  readInstalledManifest,
  readProjectDocument,
  resolveInstalledModule,
  type Registry,
  type SecretReference,
} from "@useagentsio/core";
import { readDeploymentSecrets, writeDeploymentSecret } from "@useagentsio/host";

import type { OutputBuffer } from "./output.js";
import { canPrompt } from "./prompt.js";
import { isSubmit, text } from "./ui/index.js";

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
  const missing = missingRequiredSecrets(project.id, required, env);
  for (const secret of missing) {
    if (input.yes || !canPrompt()) {
      input.out.log(`${secret.name} is not set. ${secret.source} calls that need it will fail until it is.`);
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
    input.out.log(`Saved ${secret.name} to the local deployment store.`);
  }
}
