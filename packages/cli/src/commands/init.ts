import fs from "node:fs";
import path from "node:path";

import {
  RUNTIME_GITIGNORE_RULE,
  VibeKitError,
  createDefaultProject,
  emptyInstalledManifest,
  isModuleName,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "@vibekit/core";

import type { GlobalFlags } from "../args.js";
import type { OutputBuffer } from "../output.js";
import {
  detectPackageManager,
  isPiProject,
  isWorkspaceRoot,
  resolveProjectDir,
  resolveRegistry,
  slugify,
} from "../paths.js";
import { printDoctor } from "./doctor.js";

export function runInit(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): number {
  const target = resolveProjectDir(positionals[0] ?? flags.dir);
  const created: string[] = [];
  const changed: string[] = [];

  fs.mkdirSync(target, { recursive: true });

  if (fs.existsSync(path.join(target, ".vibekit/project.yaml"))) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_exists",
      message: `A VibeKit Project already exists in ${target}`,
    });
  }

  if (!isPiProject(target)) {
    writeNewFile(path.join(target, ".pi/settings.json"), `${JSON.stringify({
      extensions: ["./extensions/vibekit"],
    }, null, 2)}\n`, created);
    fs.mkdirSync(path.join(target, ".pi/extensions"), { recursive: true });
    fs.mkdirSync(path.join(target, ".pi/skills"), { recursive: true });
    created.push(".pi/extensions/");
    created.push(".pi/skills/");
  }

  const extensionDir = path.join(target, ".pi/extensions/vibekit");
  if (!fs.existsSync(path.join(extensionDir, "index.ts"))) {
    fs.mkdirSync(extensionDir, { recursive: true });
    writeNewFile(
      path.join(extensionDir, "index.ts"),
      `/** VibeKit Pi extension stub. The runtime adapter is implemented in a later phase. */\nexport default { name: "vibekit" };\n`,
      created,
    );
    writeNewFile(
      path.join(extensionDir, "package.json"),
      `${JSON.stringify({ name: "vibekit-pi-extension", private: true, type: "module" }, null, 2)}\n`,
      created,
    );
  }

  const name = path.basename(target);
  const slug = isModuleName(slugify(name)) ? slugify(name) : "app";
  const project = createDefaultProject({ slug, name });
  writeProjectDocument(target, project);
  created.push(".vibekit/project.yaml");
  writeInstalledManifest(target, emptyInstalledManifest());
  created.push(".vibekit/installed.json");
  fs.mkdirSync(path.join(target, ".vibekit/runtime"), { recursive: true });

  const gitignorePath = path.join(target, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    writeNewFile(gitignorePath, `# VibeKit\n${RUNTIME_GITIGNORE_RULE}\n`, created);
  } else {
    const existing = fs.readFileSync(gitignorePath, "utf8");
    if (!existing.split(/\r?\n/).includes(RUNTIME_GITIGNORE_RULE.replace(/\/$/, "")) &&
        !existing.includes(RUNTIME_GITIGNORE_RULE)) {
      const prefix = existing.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(
        gitignorePath,
        `${existing}${prefix}\n# VibeKit\n${RUNTIME_GITIGNORE_RULE}\n`,
        "utf8",
      );
      changed.push(".gitignore");
    }
  }

  if (isWorkspaceRoot(target)) {
    recordWorkspaceDependencies(target, changed);
  }

  const packageManager = detectPackageManager(target);
  out.log(`Initialized VibeKit Project in ${target}`);
  out.log(`Package manager: ${packageManager ?? "none detected"}`);

  const createdUnique = uniqueExisting(target, created);
  const changedUnique = uniqueExisting(target, changed);
  if (createdUnique.length > 0) {
    out.log("Created:");
    for (const file of createdUnique) {
      out.log(`  ${file}`);
    }
  }
  if (changedUnique.length > 0) {
    out.log("Changed:");
    for (const file of changedUnique) {
      out.log(`  ${file}`);
    }
  }

  const registry = tryRegistry(flags.registry);
  const report = runDoctor({
    projectRoot: target,
    registry,
  });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function writeNewFile(abs: string, contents: string, created: string[]): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
  created.push(toRelativeCreated(abs));
}

function toRelativeCreated(abs: string): string {
  const marker = `${path.sep}.pi${path.sep}`;
  const vibe = `${path.sep}.vibekit${path.sep}`;
  const git = `${path.sep}.gitignore`;
  if (abs.endsWith(git) || abs.endsWith("/.gitignore")) {
    return ".gitignore";
  }
  const piIndex = abs.lastIndexOf(marker);
  if (piIndex !== -1) {
    return abs.slice(piIndex + 1).split(path.sep).join("/");
  }
  const vibeIndex = abs.lastIndexOf(vibe);
  if (vibeIndex !== -1) {
    return abs.slice(vibeIndex + 1).split(path.sep).join("/");
  }
  return path.basename(abs);
}

function uniqueExisting(_root: string, items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function tryRegistry(registryFlag?: string) {
  try {
    return resolveRegistry(registryFlag);
  } catch {
    return undefined;
  }
}

function recordWorkspaceDependencies(target: string, changed: string[]): void {
  const packagePath = path.join(target, "package.json");
  if (!fs.existsSync(packagePath)) {
    return;
  }
  const raw = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = raw.dependencies ?? {};
  let mutated = false;
  if (!deps["@vibekit/core"] && !raw.devDependencies?.["@vibekit/core"]) {
    deps["@vibekit/core"] = "workspace:*";
    mutated = true;
  }
  if (!deps["@vibekit/pi"] && !raw.devDependencies?.["@vibekit/pi"]) {
    deps["@vibekit/pi"] = "workspace:*";
    mutated = true;
  }
  if (!mutated) {
    return;
  }
  raw.dependencies = deps;
  fs.writeFileSync(packagePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  changed.push("package.json");
}
