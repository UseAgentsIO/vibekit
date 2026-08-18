import { conversationKeyOf } from "@useagentsio/interface-sdk";
import { VibeKitHost } from "@useagentsio/host";

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
  const host = await VibeKitHost.start({
    projectRoot,
    startInterfaces: false,
    env: process.env,
  });

  try {
    const conversationKey = conversationKeyOf({
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
    });
    const result = await host.submit({
      eventId: `cli-${Date.now()}`,
      interfaceBinding: "terminal-main",
      accountId: "local",
      conversationId: "cli",
      conversationKey,
      sender: { id: "local", displayName: "operator", trusted: true },
      text,
      attachments: [],
      timestamp: new Date().toISOString(),
    });
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
  } finally {
    await host.stop();
  }
}
