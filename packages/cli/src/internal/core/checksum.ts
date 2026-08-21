import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function sha256Checksum(data: string | Buffer): string {
  return `sha256:${sha256Hex(data)}`;
}

export function sha256File(filePath: string): string {
  return sha256Checksum(fs.readFileSync(filePath));
}

export function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function checksumDirectory(root: string): string {
  const hash = crypto.createHash("sha256");
  const files = listFilesRecursive(root);
  for (const filePath of files) {
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}
