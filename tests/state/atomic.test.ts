import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  atomicWriteFile,
  cleanupPartialWrites,
  createRepositoryState,
} from "../../packages/core/src/state/index.js";

import { taskDoc, tempProject } from "./helpers.js";

describe("atomic State writes", () => {
  it("leaves the target untouched when a crash happens between write and rename", () => {
    const root = tempProject();
    const target = path.join(root, "record.yaml");
    fs.writeFileSync(target, "original\n", "utf8");
    let leftover: string | undefined;
    expect(() =>
      atomicWriteFile(target, "replacement\n", {
        afterWriteBeforeRename: (tempPath) => {
          leftover = tempPath;
          expect(fs.existsSync(tempPath)).toBe(true);
          expect(fs.readFileSync(tempPath, "utf8")).toBe("replacement\n");
          throw new Error("simulated crash");
        },
      }),
    ).toThrow("simulated crash");
    expect(fs.readFileSync(target, "utf8")).toBe("original\n");
    expect(leftover).toBeDefined();
    expect(fs.existsSync(leftover as string)).toBe(true);

    const removed = cleanupPartialWrites(root);
    expect(removed).toContain(leftover);
    expect(fs.existsSync(leftover as string)).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("original\n");
  });

  it("does not create a target file when the first write crashes before rename", () => {
    const root = tempProject();
    const target = path.join(root, "missing.yaml");
    expect(() =>
      atomicWriteFile(target, "partial\n", {
        afterWriteBeforeRename: () => {
          throw new Error("simulated crash");
        },
      }),
    ).toThrow("simulated crash");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(true);
    cleanupPartialWrites(root);
    expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("cleans leftover temp files on open so no partial State writes remain", () => {
    const root = tempProject();
    const first = createRepositoryState({ projectRoot: root });
    const stored = first.tasks.create(taskDoc());
    const leftover = path.join(first.paths.tasks, `.${path.basename(stored.path)}.crash.tmp`);
    fs.writeFileSync(leftover, "partial-task\n", "utf8");
    first.close();

    const second = createRepositoryState({ projectRoot: root });
    expect(fs.existsSync(leftover)).toBe(false);
    expect(second.tasks.get(stored.document.id).document).toEqual(stored.document);
    expect(
      fs.readdirSync(second.paths.tasks).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  });
});
