import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  authorizeInvocation,
  invocationFromToolCall,
  type ApprovalDocument,
  type EffectiveAuthority,
  type ModuleId,
  type ProjectDocument,
  type TaskDocument,
} from "@useagentsio/core";

import type { PiCustomTool } from "./session.js";

export interface GuardedToolContext {
  readonly cwd: string;
  readonly authority: EffectiveAuthority;
  readonly project: ProjectDocument;
  readonly task: TaskDocument;
  readonly approvals?: readonly ApprovalDocument[] | (() => readonly ApprovalDocument[]);
  readonly now?: Date | (() => Date);
}

export function createGuardedBuiltinTools(context: GuardedToolContext): PiCustomTool[] {
  const tools: PiCustomTool[] = [];
  for (const name of context.authority.builtinTools) {
    if (name === "agent_delegate") {
      continue;
    }
    tools.push(guardedBuiltin(name, context));
  }
  return tools;
}

export function guardCustomTool(
  tool: PiCustomTool,
  context: GuardedToolContext,
  moduleId?: ModuleId,
): PiCustomTool {
  const inner = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (args: unknown) => {
      authorizeToolCall(tool.name, args, context, moduleId);
      return inner(args);
    },
  };
}

export function authorizeToolCall(
  toolName: string,
  args: unknown,
  context: GuardedToolContext,
  moduleId?: ModuleId,
): void {
  const invocation = invocationFromToolCall({
    toolName,
    args,
    authority: context.authority,
    moduleId,
  });
  const approvals = typeof context.approvals === "function" ? context.approvals() : context.approvals;
  const now = typeof context.now === "function" ? context.now() : context.now;
  authorizeInvocation({
    authority: context.authority,
    invocation,
    project: context.project,
    task: context.task,
    approvals,
    now,
  });
}

function guardedBuiltin(name: string, context: GuardedToolContext): PiCustomTool {
  return {
    name,
    description: `Scoped ${name} tool`,
    parameters: { type: "object", additionalProperties: true },
    execute: async (args: unknown) => {
      authorizeToolCall(name, args, context);
      return executeBuiltin(name, args, context.cwd);
    },
  };
}

function executeBuiltin(name: string, args: unknown, cwd: string): unknown {
  const record = isRecord(args) ? args : {};
  if (name === "read") {
    const target = resolvePath(cwd, stringField(record, "path") ?? stringField(record, "file_path") ?? "");
    return fs.readFileSync(target, "utf8");
  }
  if (name === "write") {
    const target = resolvePath(cwd, stringField(record, "path") ?? stringField(record, "file_path") ?? "");
    const contents = typeof record.contents === "string" ? record.contents : String(record.content ?? "");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
    return { ok: true, path: path.relative(cwd, target) };
  }
  if (name === "edit") {
    const target = resolvePath(cwd, stringField(record, "path") ?? stringField(record, "file_path") ?? "");
    const oldText = typeof record.oldText === "string" ? record.oldText : String(record.old_string ?? "");
    const newText = typeof record.newText === "string" ? record.newText : String(record.new_string ?? "");
    const current = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, current.replace(oldText, newText), "utf8");
    return { ok: true, path: path.relative(cwd, target) };
  }
  if (name === "bash") {
    const command = stringField(record, "command") ?? "";
    const result = spawnSync(command, {
      cwd,
      encoding: "utf8",
      shell: true,
      timeout: 60_000,
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  if (name === "ls") {
    const target = resolvePath(cwd, stringField(record, "path") ?? ".");
    return fs.readdirSync(target);
  }
  if (name === "grep" || name === "find") {
    return { matches: [] };
  }
  return { ok: true };
}

function resolvePath(cwd: string, requested: string): string {
  const resolved = path.resolve(cwd, requested);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path ${requested} escapes the working directory`);
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
