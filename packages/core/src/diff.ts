import fs from "node:fs";
import path from "node:path";

import { VibeKitError } from "./errors.js";
import type { ModuleId } from "./ids.js";
import { getInstalledModule } from "./installed.js";
import type { InstalledManifestDocument } from "./types.js";
import type { Registry } from "./registry.js";
import { resolveModule } from "./registry.js";
import {
  analyzeInstalledModule,
  findNewestCompatible,
  tryResolveModule,
  type AnalyzedFile,
  type ThreeWayDecision,
} from "./update.js";

export type FileDiffStatus = "unchanged" | "local" | "upstream" | "both" | "current";

export interface FileDiff {
  readonly path: string;
  readonly kind: AnalyzedFile["kind"];
  readonly ownership: AnalyzedFile["ownership"];
  readonly status: FileDiffStatus;
  readonly decision: ThreeWayDecision;
  readonly baseHash?: string;
  readonly localHash?: string;
  readonly upstreamHash?: string;
  readonly localChanged: boolean;
  readonly upstreamChanged: boolean;
  readonly unifiedDiff?: string;
}

export interface ModuleDiff {
  readonly id: ModuleId;
  readonly installedVersion: string;
  readonly newestCompatibleVersion?: string;
  readonly files: readonly FileDiff[];
  readonly localChanged: boolean;
  readonly upstreamAvailable: boolean;
}

export function diffInstalledModule(options: {
  readonly projectRoot: string;
  readonly registry: Registry;
  readonly id: ModuleId;
  readonly manifest: InstalledManifestDocument;
}): ModuleDiff {
  const record = getInstalledModule(options.manifest, options.id);
  if (record === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "module_not_installed",
      message: `${options.id} is not installed`,
      details: { id: options.id },
    });
  }

  const newest = findNewestCompatible(options.registry, options.id);
  const compareVersion = newest?.version ?? record.version;
  const upstream =
    tryResolveModule(options.registry, options.id, compareVersion) ??
    resolveModule(options.registry, options.id, record.version);
  const base = tryResolveModule(options.registry, options.id, record.version);
  const analyzed = analyzeInstalledModule({
    projectRoot: options.projectRoot,
    record,
    upstream,
    base,
  });

  const files = analyzed.map((file) => toFileDiff(options.projectRoot, file, record.version));
  return {
    id: options.id,
    installedVersion: record.version,
    newestCompatibleVersion: newest?.version,
    files,
    localChanged: files.some((file) => file.localChanged),
    upstreamAvailable:
      newest !== undefined &&
      (newest.version !== record.version || files.some((file) => file.upstreamChanged)),
  };
}

export function statusForDecision(
  decision: ThreeWayDecision,
  localChanged: boolean,
  upstreamChanged: boolean,
): FileDiffStatus {
  if (decision === "conflict") {
    return "both";
  }
  if (decision === "keep-local") {
    return localChanged ? "local" : "unchanged";
  }
  if (decision === "replace-upstream") {
    return upstreamChanged ? "upstream" : "unchanged";
  }
  if (localChanged && upstreamChanged) {
    return "current";
  }
  return "unchanged";
}

function toFileDiff(projectRoot: string, file: AnalyzedFile, installedVersion: string): FileDiff {
  const status = statusForDecision(file.decision, file.localChanged, file.upstreamChanged);
  return {
    path: file.path,
    kind: file.kind,
    ownership: file.ownership,
    status,
    decision: file.decision,
    baseHash: file.baseHash,
    localHash: file.localHash,
    upstreamHash: file.upstreamHash,
    localChanged: file.localChanged,
    upstreamChanged: file.upstreamChanged,
    unifiedDiff: file.localChanged ? formatLocalDiff(projectRoot, file, installedVersion) : undefined,
  };
}

function formatLocalDiff(
  projectRoot: string,
  file: AnalyzedFile,
  installedVersion: string,
): string | undefined {
  const localAbs = path.join(projectRoot, file.path);
  if (!fs.existsSync(localAbs) || !fs.statSync(localAbs).isFile()) {
    return `--- installed ${installedVersion}\n+++ local\n(file missing)`;
  }
  const local = fs.readFileSync(localAbs);
  if (looksBinary(local)) {
    return `--- installed ${installedVersion}\n+++ local\n(binary file differs)`;
  }
  return unifiedLines(
    `installed ${installedVersion}`,
    "local",
    "(content unavailable)",
    local.toString("utf8"),
  );
}

function unifiedLines(
  fromLabel: string,
  toLabel: string,
  _fromText: string,
  toText: string,
): string {
  const toLines = toText.split("\n");
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const line of toLines) {
    lines.push(`+${line}`);
  }
  return lines.join("\n");
}

function looksBinary(contents: Buffer): boolean {
  return contents.includes(0);
}
