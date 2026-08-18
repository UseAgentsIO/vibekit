import {
  type AgentDocument,
  type ProjectDocument,
  type TaskDocument,
} from "@useagentsio/core";

import { assertValidDocument, readValidatedYaml } from "./documents.js";
import { configurationInvalid, fail } from "./fail.js";

export function loadTaskDocument(filePath: string): TaskDocument {
  return readValidatedYaml("task", filePath, {
    missing: "task_missing",
    invalid: "task_invalid",
  });
}

export function resolveTaskDocument(task: TaskDocument | string): TaskDocument {
  if (typeof task === "string") {
    return loadTaskDocument(task);
  }
  return assertValidDocument("task", task, "task_invalid");
}

export function assertTaskMatchesProject(task: TaskDocument, project: ProjectDocument): void {
  if (task.projectId !== project.id) {
    throw configurationInvalid(
      "task_project_mismatch",
      `Task ${task.id} belongs to ${task.projectId}, not ${project.id}`,
      { taskId: task.id, taskProjectId: task.projectId, projectId: project.id },
    );
  }
}

export function assertTaskAssignedAgent(
  task: TaskDocument,
  definition: TaskDocument["assignedAgent"],
): void {
  if (task.assignedAgent !== null && task.assignedAgent !== definition) {
    throw configurationInvalid(
      "task_agent_mismatch",
      `Task ${task.id} is assigned to ${task.assignedAgent}, not ${definition}`,
      { taskId: task.id, assignedAgent: task.assignedAgent, definition },
    );
  }
}

export function assertRequiredTaskInputs(task: TaskDocument, agent: AgentDocument): void {
  const missing: string[] = [];
  for (const field of agent.inputs.required) {
    if (!taskHasInput(task, field)) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw configurationInvalid(
      "task_input_missing",
      `Task is missing required Agent inputs: ${missing.join(", ")}`,
      { taskId: task.id, agentId: agent.id, missing },
    );
  }
}

export function assertTaskAuthorization(task: TaskDocument): void {
  if (task.authorization.state === "deny") {
    throw fail(
      "authorization_required",
      "task_authorization_denied",
      `Task ${task.id} is not authorized to run`,
      { taskId: task.id, authorization: task.authorization.state },
    );
  }
}

function taskHasInput(task: TaskDocument, field: string): boolean {
  switch (field) {
    case "objective":
      return task.objective.trim().length > 0;
    case "constraints":
      return Array.isArray(task.constraints);
    case "acceptanceCriteria":
      return Array.isArray(task.acceptanceCriteria);
    case "context":
      return task.context !== undefined;
    case "scope":
      return task.scope !== undefined;
    case "candidate":
      return task.context.references.some((reference) => reference.trim().length > 0);
    case "questions":
      return task.objective.trim().length > 0 || task.context.references.length > 0;
    case "producingAgent":
      return task.context.references.some((reference) => /producing|agent:/.test(reference));
    default: {
      const record = task as unknown as Record<string, unknown>;
      const value = record[field];
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      return true;
    }
  }
}
