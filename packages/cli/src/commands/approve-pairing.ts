import { VibeKitError } from "@useagentsio/core";
import { approvePairing as approveTelegramPairing } from "@useagentsio/interface-telegram";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";

export function runApprovePairing(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const code = positionals[0]?.trim() ?? "";
  if (code.length === 0) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "pairing_code_required",
      message: "Missing pairing code. Usage: vibekit approve-pairing <code>",
    });
  }
  const projectRoot = resolveProjectDir(flags.dir);
  try {
    const paired = approveTelegramPairing(projectRoot, code);
    out.log(`Paired Telegram user ${paired.userId}${paired.displayName ? ` (${paired.displayName})` : ""}.`);
    return 0;
  } catch (error) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "pairing_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
