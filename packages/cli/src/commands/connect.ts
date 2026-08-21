import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  formatModuleId,
  normalizeProjectDocument,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  VibeKitError,
  writeProjectDocument,
} from "../internal/core/index.js";
import {
  approvePairing,
  listPairings,
  type PendingPairing,
} from "../internal/interfaces/telegram/index.js";
import {
  isHostIpcAvailable,
  readDeploymentSecrets,
  writeDeploymentSecret,
} from "../internal/host/index.js";

import type { GlobalFlags } from "../args.js";
import { ensurePersistentAvailability, restartProjectHost } from "../host-control.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";
import { registerProject } from "../project-registry.js";
import { canPrompt } from "../prompt.js";
import { confirm, isSubmit, text } from "../ui/index.js";

const TELEGRAM_TOKEN = "TELEGRAM_BOT_TOKEN";
const TELEGRAM_CONFIG = ".vibekit/config/interfaces/telegram.yaml";
const PAIRING_POLICY = formatModuleId("policy", "interface-pairing");
const UNTRUSTED_POLICY = formatModuleId("policy", "untrusted-inbound");
const PAIRING_WAIT_MS = 60_000;

export async function runConnect(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const channel = positionals[0]?.toLowerCase();
  if (channel !== "telegram") {
    throw new VibeKitError({
      category: "invalid_input",
      code: "connection_invalid",
      message: "Use `vibekit connect telegram`.",
    });
  }

  const projectRoot = resolveProjectDir(flags.dir);
  const existing = readProjectDocument(projectRoot);
  const project = normalizeProjectDocument(existing);
  const defaultAgent = project.defaultAgent ?? Object.keys(project.agentBindings)[0];
  if (defaultAgent === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "connection_agent_missing",
      message: "Connect Telegram after choosing an Agent with `vibekit create` or `vibekit init`.",
    });
  }

  const { registry, source } = resolveRegistrySelection(flags.registry);
  const manifest = readInstalledManifest(projectRoot);
  const install = applyInstall({
    projectRoot,
    plan: planInstall({
      projectRoot,
      registry,
      roots: [
        formatModuleId("interface", "telegram"),
        formatModuleId("policy", "interface-pairing"),
        formatModuleId("policy", "untrusted-inbound"),
      ],
      project,
      manifest,
      registrySource: source,
    }),
  });

  const installed = readProjectDocument(projectRoot);
  const bindingName = Object.entries(installed.interfaceBindings ?? {})
    .find(([, binding]) => binding.definition === "interface:telegram")?.[0] ?? "telegram-main";
  ensureTelegramConfig(projectRoot);
  writeProjectDocument(projectRoot, {
    ...installed,
    defaultAgent,
    policies: unique([...installed.policies, PAIRING_POLICY, UNTRUSTED_POLICY]),
    interfaceBindings: {
      ...installed.interfaceBindings,
      [bindingName]: {
        definition: "interface:telegram",
        enabled: true,
        defaultAgent,
        config: TELEGRAM_CONFIG,
      },
    },
  });

  const persisted = readProjectDocument(projectRoot);
  await ensureTelegramToken(persisted.id, flags, out);
  registerProject(projectRoot);

  let installGateway = false;
  if (!flags.yes && canPrompt()) {
    const persistence = await confirm({
      message: "Keep VibeKit available after login?",
      initial: true,
    });
    if (isSubmit(persistence)) {
      installGateway = persistence.value === true;
    }
  }
  const running = await isHostIpcAvailable(projectRoot);
  const restarted = running ? await restartProjectHost(persisted.id, projectRoot) : undefined;
  if (restarted !== undefined && !restarted.ok) {
    throw new VibeKitError({
      category: "unavailable",
      code: "connection_start_failed",
      message: restarted.error ?? "Telegram could not be restarted.",
    });
  }
  const started = await ensurePersistentAvailability(projectRoot, {
    ensureGateway: true,
    installGateway,
    requireSecrets: true,
  });
  if (!started.ok) {
    throw new VibeKitError({
      category: "unavailable",
      code: "connection_start_failed",
      message: started.error ?? "Telegram could not be started.",
    });
  }

  out.log("Telegram is connected and will remain available through the VibeKit Host.");
  if (install.created.length > 0 || install.changed.length > 0) {
    out.log("Telegram connection and sender authorization are saved to this Project.");
  }
  return await waitForFirstSender(projectRoot, flags, out);
}

export async function waitForFirstSender(
  projectRoot: string,
  flags: Pick<GlobalFlags, "yes">,
  out: OutputBuffer,
  options?: { readonly timeoutMs?: number; readonly pollMs?: number },
): Promise<number> {
  const current = listPairings(projectRoot);
  const pending = current.pending[0];
  if (pending !== undefined) {
    return presentFirstSender(projectRoot, pending, flags, out);
  }
  if (current.owner !== undefined) {
    out.log(`Owner identity: ${senderLabel(current.owner.userId, current.owner.displayName)}.`);
    return 0;
  }
  if (!canPrompt()) {
    out.log("Send the Telegram bot a message. Pending pairing requests will appear in the dashboard.");
    out.log("Approve with `vibekit approve-pairing <code>` after the first sender appears.");
    return 0;
  }

  out.log("Send the Telegram bot a message now. Waiting for the first sender...");
  const timeoutMs = options?.timeoutMs ?? PAIRING_WAIT_MS;
  const pollMs = options?.pollMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollMs);
    const next = listPairings(projectRoot);
    const first = next.pending[0];
    if (first !== undefined) {
      return presentFirstSender(projectRoot, first, flags, out);
    }
    if (next.owner !== undefined) {
      out.log(`Owner identity: ${senderLabel(next.owner.userId, next.owner.displayName)}.`);
      return 0;
    }
  }
  out.log("No Telegram message arrived yet. The Host is still running; send the bot a message to continue pairing.");
  return 0;
}

async function presentFirstSender(
  projectRoot: string,
  pending: PendingPairing,
  flags: Pick<GlobalFlags, "yes">,
  out: OutputBuffer,
): Promise<number> {
  out.log(`First Telegram sender detected: ${senderLabel(pending.userId, pending.displayName)}.`);
  out.log(`Pairing code ${pending.code} expires at ${pending.expiresAt}.`);
  if (flags.yes || !canPrompt()) {
    out.log("Approve this sender with `vibekit approve-pairing <code>` or the dashboard Approve action.");
    return 0;
  }
  const decision = await confirm({
    message: `Approve ${senderLabel(pending.userId, pending.displayName)} as the Project owner?`,
    initial: true,
  });
  if (!isSubmit(decision) || decision.value !== true) {
    out.log("Sender remains pending. Approve it later from the dashboard or with `vibekit approve-pairing`.");
    return 0;
  }
  const paired = approvePairing(projectRoot, pending.code);
  out.log(`Owner identity: ${senderLabel(paired.userId, paired.displayName)}.`);
  out.log("This sender is verified for Telegram messages. Pairing authorization remains enabled for other senders.");
  return 0;
}

async function ensureTelegramToken(
  projectId: string,
  flags: Pick<GlobalFlags, "yes">,
  out: OutputBuffer,
): Promise<void> {
  const stored = readDeploymentSecrets(projectId)[TELEGRAM_TOKEN];
  if (typeof stored === "string" && stored.length > 0) {
    out.log("Telegram bot token: configured in the owner-only deployment store.");
    return;
  }
  const fromEnvironment = process.env[TELEGRAM_TOKEN];
  if (typeof fromEnvironment === "string" && fromEnvironment.length > 0 && (flags.yes || !canPrompt())) {
    writeDeploymentSecret(projectId, TELEGRAM_TOKEN, fromEnvironment);
    out.log("Telegram bot token: saved to the owner-only deployment store.");
    return;
  }
  if (!canPrompt()) {
    throw new VibeKitError({
      category: "authorization_required",
      code: "telegram_token_required",
      message: "Telegram needs TELEGRAM_BOT_TOKEN. Run this command in a terminal and enter it when prompted, or set the environment variable with --yes.",
    });
  }
  const value = await text({ message: "Telegram bot token", secret: true, collapse: "saved" });
  if (!isSubmit(value) || value.value.length === 0) {
    throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
  }
  writeDeploymentSecret(projectId, TELEGRAM_TOKEN, value.value);
  out.log("Telegram bot token: saved to the owner-only deployment store.");
}

function ensureTelegramConfig(projectRoot: string): void {
  const filePath = path.join(projectRoot, TELEGRAM_CONFIG);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "{}\n", "utf8");
  }
}

function senderLabel(userId: string, displayName: string | undefined): string {
  return displayName === undefined ? `Telegram user ${userId}` : `${displayName} (Telegram user ${userId})`;
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
