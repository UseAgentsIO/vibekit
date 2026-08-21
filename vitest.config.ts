import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: [path.resolve(root, "tests/setup.ts")],
    environment: "node",
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@useagentsio/core": path.resolve(root, "packages/cli/src/internal/core/index.ts"),
      "@useagentsio/pi": path.resolve(root, "packages/cli/src/internal/pi/index.ts"),
      "@useagentsio/interface-sdk": path.resolve(root, "packages/cli/src/internal/interfaces/sdk/index.ts"),
      "@useagentsio/interface-terminal": path.resolve(root, "packages/cli/src/internal/interfaces/terminal/index.ts"),
      "@useagentsio/interface-http": path.resolve(root, "packages/cli/src/internal/interfaces/http/index.ts"),
      "@useagentsio/interface-webhook": path.resolve(root, "packages/cli/src/internal/interfaces/webhook/index.ts"),
      "@useagentsio/schedule-core": path.resolve(root, "packages/cli/src/internal/schedule/index.ts"),
      "@useagentsio/interface-schedule": path.resolve(root, "packages/cli/src/internal/interfaces/schedule/index.ts"),
      "@useagentsio/tool-scheduler": path.resolve(root, "packages/cli/src/internal/tools/scheduler/index.ts"),
      "@useagentsio/interface-slack": path.resolve(root, "packages/cli/src/internal/interfaces/slack/index.ts"),
      "@useagentsio/interface-telegram": path.resolve(root, "packages/cli/src/internal/interfaces/telegram/index.ts"),
      "@useagentsio/state-memory": path.resolve(root, "packages/cli/src/internal/state/memory/index.ts"),
      "@useagentsio/tool-web": path.resolve(root, "packages/cli/src/internal/tools/web/index.ts"),
      "@useagentsio/tool-browser": path.resolve(root, "packages/cli/src/internal/tools/browser/index.ts"),
      "@useagentsio/tool-github": path.resolve(root, "packages/cli/src/internal/tools/github/index.ts"),
      "@useagentsio/tool-mcp": path.resolve(root, "packages/cli/src/internal/tools/mcp/index.ts"),
      "@useagentsio/tool-process": path.resolve(root, "packages/cli/src/internal/tools/process/index.ts"),
      "@useagentsio/verifier-schema": path.resolve(root, "packages/cli/src/internal/verifiers/schema/index.ts"),
      "@useagentsio/host": path.resolve(root, "packages/cli/src/internal/host/index.ts"),
      vibekit: path.resolve(root, "packages/cli/src/index.ts"),
    },
  },
});
