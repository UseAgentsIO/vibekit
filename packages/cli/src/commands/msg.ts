import { conversationKeyOf, type InboundMessage } from "@useagentsio/interface-sdk";
import {
  VibeKitHost,
  isHostIpcAvailable,
  submitViaIpc,
  type SubmitResult,
} from "@useagentsio/host";
import { readProjectDocument } from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export async function runMsg(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const text = positionals.join(" ").trim();
  if (text.length === 0) {
    out.error("Missing message. Usage: vibekit msg \"Hello\"");
    return 1;
  }

  const projectRoot = resolveProjectDir(flags.dir);
  const project = readProjectDocument(projectRoot);
  if (project.defaults?.model !== undefined) {
    out.log(`Using ${project.defaults.model.provider} / ${project.defaults.model.id}`);
  }

  const message = inboundFromCli(text);
  const result = (await isHostIpcAvailable(projectRoot))
    ? await submitViaIpc(projectRoot, message)
    : await submitInProcess(projectRoot, message);
  return printSubmitResult(result, out);
}

function inboundFromCli(text: string): InboundMessage {
  const conversationKey = conversationKeyOf({
    interfaceBinding: "terminal-main",
    accountId: "local",
    conversationId: "cli",
  });
  return {
    eventId: `cli-${Date.now()}`,
    interfaceBinding: "terminal-main",
    accountId: "local",
    conversationId: "cli",
    conversationKey,
    sender: { id: "local", displayName: "operator", trusted: true },
    text,
    attachments: [],
    timestamp: new Date().toISOString(),
  };
}

async function submitInProcess(
  projectRoot: string,
  message: InboundMessage,
): Promise<SubmitResult> {
  const host = await VibeKitHost.start({
    projectRoot,
    startInterfaces: false,
    env: process.env,
  });
  try {
    return await host.submit(message);
  } finally {
    await host.stop();
  }
}

function printSubmitResult(result: SubmitResult, out: OutputBuffer): number {
  if (result.text.length > 0) {
    out.log(result.text);
    return 0;
  }
  if (result.cancelled) {
    out.log("Cancelled.");
    return 0;
  }
  if (result.duplicate) {
    out.log("Duplicate event ignored.");
    return 0;
  }
  if (result.error !== undefined) {
    out.error(result.error);
    return 1;
  }
  out.error("The provider returned no text. Check provider credentials.");
  return 1;
}
