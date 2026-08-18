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
      vibekit: path.resolve(root, "packages/cli/src/index.ts"),
    },
  },
});
