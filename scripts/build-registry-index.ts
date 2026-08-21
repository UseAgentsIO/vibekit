import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeRegistryIndex } from "../packages/cli/src/internal/core/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const registryRoot = path.resolve(here, "../registry");
const result = writeRegistryIndex(registryRoot);
process.stdout.write(
  `Wrote ${result.index.modules.length} registry entries to ${path.join(registryRoot, "index.json")}\n`,
);
