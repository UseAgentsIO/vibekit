#!/usr/bin/env node

import { VibeKitHost } from "./host.js";

const projectRoot = process.argv[2] ?? process.cwd();

const host = await VibeKitHost.start({ projectRoot });

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
