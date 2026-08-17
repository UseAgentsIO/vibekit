import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const fixturesDir = path.resolve(here, "../fixtures");

export function readFixture(kind: "valid" | "invalid", name: string): string {
  return fs.readFileSync(path.join(fixturesDir, kind, name), "utf8");
}
