import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.VIBEKIT_CONFIG_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-test-config-"));
