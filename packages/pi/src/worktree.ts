import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type {
  IsolationMode,
  ProjectDocument,
  RuntimeId,
  TaskDocument,
} from "@useagentsio/core";

import { fail } from "./fail.js";
import { MUTATING_TOOLS } from "./tools.js";

export interface WorktreeRecord {
  readonly runId: RuntimeId;
  readonly repoRoot: string;
  readonly path: string;
  readonly branch: string;
  readonly head: string;
}

export interface CreateWorktreeInput {
  readonly repoRoot: string;
  readonly runId: RuntimeId;
  readonly baseRef?: string;
}

const MUTATING_CAPABILITIES = new Set([
  "source.write",
  "command.execute",
  "repository.write",
]);

export function isMutatingTask(
  task: TaskDocument,
  tools: readonly string[] = [],
): boolean {
  if (task.requiredCapabilities.some((capability) => MUTATING_CAPABILITIES.has(capability))) {
    return true;
  }
  return tools.some((tool) => MUTATING_TOOLS.has(tool));
}

export function shouldUseWorktree(input: {
  readonly isolation: IsolationMode;
  readonly mutationIsolation: IsolationMode;
  readonly mutating: boolean;
}): boolean {
  if (input.isolation === "worktree") {
    return true;
  }
  return input.mutating && input.mutationIsolation === "worktree";
}

export function worktreePathFor(repoRoot: string, runId: RuntimeId): string {
  const resolved = path.resolve(repoRoot);
  const root = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  return path.join(root, ".vibekit", "runtime", "worktrees", runId);
}

export function isGitRepository(directory: string): boolean {
  try {
    const result = git(directory, ["rev-parse", "--is-inside-work-tree"]);
    return result === "true";
  } catch {
    return false;
  }
}

export function resolveRepoRoot(directory: string): string {
  try {
    return git(directory, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw fail(
      "configuration_invalid",
      "worktree_repo_missing",
      `Not a git repository: ${directory}`,
      { directory },
    );
  }
}

export function createWorktree(input: CreateWorktreeInput): WorktreeRecord {
  const repoRoot = resolveRepoRoot(input.repoRoot);
  const worktreeDir = worktreePathFor(repoRoot, input.runId);
  if (fs.existsSync(worktreeDir)) {
    throw fail(
      "conflict",
      "worktree_exists",
      `Worktree for ${input.runId} already exists`,
      { path: worktreeDir, runId: input.runId },
    );
  }
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  const branch = `vibekit/${input.runId}`;
  const baseRef = input.baseRef ?? "HEAD";
  try {
    git(repoRoot, ["worktree", "add", "-b", branch, worktreeDir, baseRef]);
  } catch (error) {
    throw fail(
      "external_error",
      "worktree_create_failed",
      `Failed to create worktree for ${input.runId}`,
      {
        runId: input.runId,
        path: worktreeDir,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const head = git(worktreeDir, ["rev-parse", "HEAD"]);
  return {
    runId: input.runId,
    repoRoot,
    path: worktreeDir,
    branch,
    head,
  };
}

export function removeWorktree(record: WorktreeRecord): void {
  if (fs.existsSync(record.path)) {
    try {
      git(record.repoRoot, ["worktree", "remove", "--force", record.path]);
    } catch {
      fs.rmSync(record.path, { recursive: true, force: true });
      try {
        git(record.repoRoot, ["worktree", "prune"]);
      } catch {
        // Directory already removed; prune is best-effort.
      }
    }
  } else {
    try {
      git(record.repoRoot, ["worktree", "prune"]);
    } catch {
      // Missing worktree is already clean.
    }
  }
  try {
    git(record.repoRoot, ["branch", "-D", record.branch]);
  } catch {
    // Branch may already be gone after worktree remove.
  }
}

export function listWorktrees(repoRoot: string): readonly string[] {
  const root = resolveRepoRoot(repoRoot);
  const output = git(root, ["worktree", "list", "--porcelain"]);
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
