import fs from "node:fs";
import path from "node:path";

import {
  parseAndValidateYaml,
  stringifyYaml,
  type AgentDocument,
  type ProjectDocument,
  type TaskDocument,
} from "@vibekit/core";

import { makeTempDir, readFixture } from "../helpers.js";

export interface RuntimeFixtureOptions {
  readonly bindingName?: string;
  readonly project?: Partial<ProjectDocument>;
  readonly agent?: Partial<AgentDocument>;
  readonly task?: Partial<TaskDocument>;
  readonly instructions?: string;
  readonly agentConfig?: Record<string, unknown>;
}

export interface RuntimeFixture {
  readonly root: string;
  readonly bindingName: string;
  readonly project: ProjectDocument;
  readonly agent: AgentDocument;
  readonly task: TaskDocument;
}

export function writeRuntimeFixture(options: RuntimeFixtureOptions = {}): RuntimeFixture {
  const root = makeTempDir("vibekit-pi-");
  const bindingName = options.bindingName ?? "coder";
  const project = {
    ...mustParse("project", "project.yaml"),
    ...options.project,
  } as ProjectDocument;
  const agent = {
    ...mustParse("agent", "agent-coder.yaml"),
    ...options.agent,
  } as AgentDocument;
  const task = {
    ...mustParse("task", "task.yaml"),
    projectId: project.id,
    ...options.task,
  } as TaskDocument;

  fs.mkdirSync(path.join(root, ".vibekit", "agents", bindingName), { recursive: true });
  fs.writeFileSync(path.join(root, ".vibekit", "project.yaml"), stringifyYaml(project), "utf8");
  fs.writeFileSync(
    path.join(root, ".vibekit", "agents", bindingName, "agent.yaml"),
    stringifyYaml(agent),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".vibekit", "agents", bindingName, "instructions.md"),
    options.instructions ?? "# Coder\n\nStay inside the Task scope.\n",
    "utf8",
  );
  if (options.agentConfig !== undefined) {
    fs.mkdirSync(path.join(root, ".vibekit", "config", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".vibekit", "config", "agents", `${bindingName}.yaml`),
      stringifyYaml(options.agentConfig),
      "utf8",
    );
  }

  return { root, bindingName, project, agent, task };
}

function mustParse<K extends "project" | "agent" | "task">(
  kind: K,
  name: string,
): K extends "project" ? ProjectDocument : K extends "agent" ? AgentDocument : TaskDocument {
  const result = parseAndValidateYaml(kind, readFixture("valid", name));
  if (!result.valid || result.data === undefined) {
    throw new Error(`fixture ${name} is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.data as K extends "project"
    ? ProjectDocument
    : K extends "agent"
      ? AgentDocument
      : TaskDocument;
}
