#!/usr/bin/env node

import { VibeKitHost } from "./host.js";

const args = process.argv.slice(2);
const projectRoot = args.find((value) => !value.startsWith("--")) ?? process.cwd();

const host = await VibeKitHost.start({
  projectRoot,
  requireSecrets: args.includes("--require-secrets"),
  onStop: () => {
    process.exit(0);
  },
});

const shutdown = async (): Promise<void> => {
  await host.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

process.stderr.write(`vibekit-host ready in ${projectRoot}\n`);
