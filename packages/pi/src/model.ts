import path from "node:path";

import type { AgentDocument, ProjectDocument } from "@useagentsio/core";

import { configurationInvalid } from "./fail.js";
import { readBoolean, readObject, readString, readYamlObject } from "./yaml-fragment.js";

export const INHERIT_MODEL = "inherit";

export type ModelSource = "task" | "project-agent-binding" | "agent" | "project";

export interface ModelRef {
  readonly provider: string;
  readonly id: string;
}

export interface ResolvedModel extends ModelRef {
  readonly source: ModelSource;
}

export interface ResolveModelInput {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly agent: AgentDocument;
  readonly bindingName: string;
  readonly taskModel?: ModelRef;
  readonly projectAgentModel?: ModelRef;
  readonly projectAllowsTaskOverride?: boolean;
}

export function isInheritModelValue(value: string): boolean {
  return value.trim().toLowerCase() === INHERIT_MODEL;
}

export function isUsableModel(model: ModelRef | undefined): boolean {
  return usableModel(model) !== undefined;
}

export function usableModel(model: ModelRef | undefined): ModelRef | undefined {
  if (
    model !== undefined &&
    !isInheritModelValue(model.provider) &&
    !isInheritModelValue(model.id) &&
    model.provider.trim().length > 0 &&
    model.id.trim().length > 0
  ) {
    return model;
  }
  return undefined;
}

export function loadProjectAgentConfig(
  projectRoot: string,
  bindingName: string,
): {
  readonly model?: ModelRef;
  readonly allowTaskOverride?: boolean;
  readonly allowProjectOverride?: boolean;
} {
  const fragmentPath = path.join(
    path.resolve(projectRoot),
    ".vibekit",
    "config",
    "agents",
    `${bindingName}.yaml`,
  );
  const fragment = readYamlObject(fragmentPath, "agent_config_invalid");
  if (fragment === undefined) {
    return {};
  }
  const modelObject = readObject(fragment.model);
  const provider = readString(modelObject?.provider);
  const id = readString(modelObject?.id);
  return {
    model: provider !== undefined && id !== undefined ? { provider, id } : undefined,
    allowTaskOverride: readBoolean(fragment.allowTaskOverride),
    allowProjectOverride: readBoolean(fragment.allowProjectOverride),
  };
}

export function resolveModel(input: ResolveModelInput): ResolvedModel {
  const agentAllowsTask = input.agent.model.allowTaskOverride;
  const agentAllowsProject = input.agent.model.allowProjectOverride;
  const projectAllowsTask = input.projectAllowsTaskOverride !== false;

  if (input.taskModel !== undefined) {
    if (!agentAllowsTask || !projectAllowsTask) {
      throw configurationInvalid(
        "model_task_override_forbidden",
        "Task model override is not allowed by the Agent and Project",
        {
          allowTaskOverride: agentAllowsTask,
          projectAllowsTaskOverride: projectAllowsTask,
        },
      );
    }
    const taskModel = usableModel(input.taskModel);
    if (taskModel === undefined) {
      throw configurationInvalid(
        "model_unresolved",
        "Task model override is not a usable provider/id pair",
        { provider: input.taskModel.provider, id: input.taskModel.id },
      );
    }
    return { ...taskModel, source: "task" };
  }

  const bindingModel = usableModel(input.projectAgentModel);
  if (bindingModel !== undefined) {
    if (!agentAllowsProject) {
      throw configurationInvalid(
        "model_project_override_forbidden",
        "Project Agent binding model is not allowed by the Agent",
        { allowProjectOverride: agentAllowsProject },
      );
    }
    return { ...bindingModel, source: "project-agent-binding" };
  }

  const agentModel = usableModel({
    provider: input.agent.model.provider,
    id: input.agent.model.id,
  });
  if (agentModel !== undefined) {
    return { ...agentModel, source: "agent" };
  }

  const projectModel = usableModel(input.project.defaults?.model);
  if (projectModel !== undefined) {
    if (!agentAllowsProject) {
      throw configurationInvalid(
        "model_project_override_forbidden",
        "Project default model is not allowed by the Agent",
        { allowProjectOverride: agentAllowsProject },
      );
    }
    return { ...projectModel, source: "project" };
  }

  throw configurationInvalid(
    "model_unresolved",
    "No usable model could be resolved from Task, Project Agent binding, Agent, or Project defaults",
    {
      agentProvider: input.agent.model.provider,
      agentId: input.agent.model.id,
      hasProjectDefault: input.project.defaults?.model !== undefined,
    },
  );
}
