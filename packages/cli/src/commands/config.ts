import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  readProjectDocument,
  stringifyYaml,
  VibeKitError,
} from "../internal/core/index.js";
import {
  removeDeploymentSecret,
  writeDeploymentSecret,
} from "../internal/host/index.js";

import type { GlobalFlags } from "../args.js";
import { installedSecretStatus } from "../secrets.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";
import { canPrompt } from "../prompt.js";
import { text, isSubmit } from "../ui/index.js";

export async function runConfig(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const action = positionals[0] ?? "effective";
  const projectRoot = resolveProjectDir(flags.dir);
  if (action === "effective") {
    out.log(stringifyYaml(readProjectDocument(projectRoot)));
    return 0;
  }
  if (action === "secrets") {
    return runSecrets(positionals.slice(1), flags, projectRoot, out);
  }
  if (action === "instructions") {
    return runInstructions(positionals.slice(1), projectRoot, out);
  }
  throw new VibeKitError({
    category: "invalid_input",
    code: "config_action_invalid",
    message: "Use `vibekit config effective`, `vibekit config secrets`, or `vibekit config instructions`.",
  });
}

async function runSecrets(
  positionals: readonly string[],
  flags: GlobalFlags,
  projectRoot: string,
  out: OutputBuffer,
): Promise<number> {
  const action = positionals[0] ?? "status";
  const project = readProjectDocument(projectRoot);
  const { registry } = resolveRegistrySelection(flags.registry);
  if (action === "status") {
    const statuses = installedSecretStatus(projectRoot, registry, project.id);
    if (statuses.length === 0) {
      out.log("No deployment secrets are declared by this Project.");
      return 0;
    }
    out.log("Deployment secrets:");
    for (const secret of statuses) {
      const required = secret.required ? "required" : "optional";
      const configured = secret.configured ? "configured" : "missing";
      out.log(`  ${secret.name}: ${configured} (${required}, ${secret.source})`);
    }
    return 0;
  }

  const name = positionals[1];
  if (name === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "secret_name_missing",
      message: "Pass a deployment secret name, for example `vibekit config secrets set OPENAI_API_KEY`.",
    });
  }
  if (action === "remove") {
    const removed = removeDeploymentSecret(project.id, name);
    out.log(removed ? `Removed ${name} from the local deployment store.` : `${name} was not present in the local deployment store.`);
    return 0;
  }
  if (action !== "set" && action !== "rotate") {
    throw new VibeKitError({
      category: "invalid_input",
      code: "secret_action_invalid",
      message: "Use `status`, `set`, `rotate`, or `remove` with `vibekit config secrets`.",
    });
  }
  if (!canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "secret_prompt_required",
      message: "Setting or rotating a secret requires an interactive terminal so its value is never placed in command history.",
    });
  }
  const value = await text({ message: `${action === "rotate" ? "New value for" : "Value for"} ${name}`, secret: true, collapse: "saved" });
  if (!isSubmit(value) || value.value.length === 0) {
    throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
  }
  writeDeploymentSecret(project.id, name, value.value);
  out.log(`${action === "rotate" ? "Rotated" : "Saved"} ${name} in the local deployment store.`);
  return 0;
}

async function runInstructions(
  positionals: readonly string[],
  projectRoot: string,
  out: OutputBuffer,
): Promise<number> {
  const project = readProjectDocument(projectRoot);
  const requested = positionals[0]?.replace(/^agent:/, "");
  const binding = requested ?? project.defaultAgent ?? Object.keys(project.agentBindings)[0];
  if (binding === undefined || project.agentBindings[binding] === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "agent_instructions_missing",
      message: "No Agent is configured. Add an Agent first, or pass its binding name.",
    });
  }
  const filePath = path.join(projectRoot, ".vibekit", "agents", binding, "instructions.md");
  if (!fs.existsSync(filePath)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "agent_instructions_missing",
      message: `Instructions for ${binding} were not found at .vibekit/agents/${binding}/instructions.md`,
    });
  }
  const configuredEditor = process.env.VISUAL ?? process.env.EDITOR;
  const editor = configuredEditor ?? (process.platform === "darwin" ? "open" : process.platform === "win32" ? "notepad.exe" : "xdg-open");
  const args = configuredEditor === undefined && process.platform === "darwin" ? ["-W", filePath] : [filePath];
  out.log(`Opening instructions for ${binding}: ${path.relative(projectRoot, filePath)}`);
  const result = spawnSync(editor, args, { stdio: "inherit" });
  if (result.error !== undefined || result.status !== 0) {
    throw new VibeKitError({
      category: "external_error",
      code: "editor_failed",
      message: `Unable to open ${editor} for Agent instructions`,
      details: { editor, path: filePath },
    });
  }
  return 0;
}
