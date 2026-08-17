import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sha256Checksum } from "../checksum.js";

import { TEMP_FILE_MARKER } from "./constants.js";
import type { AtomicWriteOptions } from "./types.js";

export function isPartialWriteName(name: string): boolean {
  return name.endsWith(TEMP_FILE_MARKER);
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function contentHash(contents: string | Buffer): string {
  return sha256Checksum(contents);
}

export function atomicWriteFile(
  targetPath: string,
  contents: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true });
  const nonce = crypto.randomBytes(8).toString("hex");
  const tempPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${nonce}${TEMP_FILE_MARKER}`,
  );
  fs.writeFileSync(tempPath, contents, { flag: "wx" });
  try {
    options.afterWriteBeforeRename?.(tempPath, targetPath);
  } catch (error) {
    // Leave the temp file so a later open() can prove no partial target write.
    throw error;
  }
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // open() removes leftovers if unlink fails here
    }
    throw error;
  }
}

export function cleanupPartialWrites(root: string): string[] {
  const removed: string[] = [];
  if (!fs.existsSync(root)) {
    return removed;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && isPartialWriteName(entry.name)) {
        try {
          fs.unlinkSync(full);
          removed.push(full);
        } catch {
          // another process may have already cleaned it
        }
      }
    }
  }
  return removed;
}
