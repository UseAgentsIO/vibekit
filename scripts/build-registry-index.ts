import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeRegistryIndex } from "@useagentsio/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const registryRoot = path.resolve(here, "../registry");
const result = writeRegistryIndex(registryRoot);
process.stdout.write(
  `Wrote ${result.index.modules.length} registry entries to ${path.join(registryRoot, "index.json")}\n`,
);
