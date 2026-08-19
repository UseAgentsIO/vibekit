import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@useagentsio/core": path.resolve(root, "packages/core/src/index.ts"),
      "@useagentsio/pi": path.resolve(root, "packages/pi/src/index.ts"),
      "@useagentsio/interface-sdk": path.resolve(root, "packages/interface-sdk/src/index.ts"),
      "@useagentsio/interface-terminal": path.resolve(root, "packages/interface-terminal/src/index.ts"),
      "@useagentsio/interface-http": path.resolve(root, "packages/interface-http/src/index.ts"),
      "@useagentsio/interface-webhook": path.resolve(root, "packages/interface-webhook/src/index.ts"),
      "@useagentsio/schedule-core": path.resolve(root, "packages/schedule-core/src/index.ts"),
      "@useagentsio/interface-schedule": path.resolve(root, "packages/interface-schedule/src/index.ts"),
      "@useagentsio/tool-scheduler": path.resolve(root, "packages/tool-scheduler/src/index.ts"),
      "@useagentsio/interface-slack": path.resolve(root, "packages/interface-slack/src/index.ts"),
      "@useagentsio/interface-telegram": path.resolve(root, "packages/interface-telegram/src/index.ts"),
      "@useagentsio/state-memory": path.resolve(root, "packages/state-memory/src/index.ts"),
      "@useagentsio/tool-web": path.resolve(root, "packages/tool-web/src/index.ts"),
      "@useagentsio/tool-browser": path.resolve(root, "packages/tool-browser/src/index.ts"),
      "@useagentsio/tool-github": path.resolve(root, "packages/tool-github/src/index.ts"),
      "@useagentsio/tool-mcp": path.resolve(root, "packages/tool-mcp/src/index.ts"),
      "@useagentsio/tool-process": path.resolve(root, "packages/tool-process/src/index.ts"),
      "@useagentsio/verifier-schema": path.resolve(root, "packages/verifier-schema/src/index.ts"),
      "@useagentsio/host": path.resolve(root, "packages/host/src/index.ts"),
      vibekit: path.resolve(root, "packages/cli/src/index.ts"),
    },
  },
});
