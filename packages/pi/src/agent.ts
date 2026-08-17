import fs from "node:fs";
import path from "node:path";

import {
  assertFileTarget,
  parseModuleId,
  type AgentDocument,
  type ModuleId,
  type ProjectDocument,
} from "@vibekit/core";

import { assertValidDocument, readValidatedYaml } from "./documents.js";
import { configurationInvalid } from "./fail.js";

export interface LoadedAgent {
  readonly document: AgentDocument;
  readonly bindingName: string;
  readonly definition: ModuleId;
  readonly directory: string;
  readonly path: string;
  readonly instructions: string;
  readonly instructionsPath: string;
}

export interface LoadAgentOptions {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly bindingName: string;
  readonly agent?: AgentDocument;
  readonly agentPath?: string;
}

export function agentDocumentPath(projectRoot: string, bindingName: string): string {
  return path.join(path.resolve(projectRoot), ".vibekit", "agents", bindingName, "agent.yaml");
}

export function resolveAgentBinding(
  project: ProjectDocument,
  bindingName: string,
): ModuleId {
  const binding = project.agentBindings[bindingName];
  if (binding === undefined) {
    throw configurationInvalid(
      "agent_binding_missing",
      `Project has no Agent binding "${bindingName}"`,
      { bindingName, projectId: project.id },
    );
  }
  return binding.definition;
}

export function loadAgentDocument(options: LoadAgentOptions): LoadedAgent {
  const bindingName = options.bindingName;
  const definition = resolveAgentBinding(options.project, bindingName);
  const filePath =
    options.agentPath === undefined
      ? agentDocumentPath(options.projectRoot, bindingName)
      : path.resolve(options.agentPath);

  const document =
    options.agent === undefined
      ? readValidatedYaml("agent", filePath, {
          missing: "agent_missing",
          invalid: "agent_invalid",
        })
      : assertValidDocument("agent", options.agent, "agent_invalid");

  if (document.id !== definition) {
    throw configurationInvalid(
      "agent_binding_mismatch",
      `Agent document ${document.id} does not match binding ${bindingName} → ${definition}`,
      { bindingName, definition, agentId: document.id },
    );
  }

  const expectedName = parseModuleId(definition).name;
  if (document.name !== expectedName && document.name !== bindingName) {
    throw configurationInvalid(
      "agent_name_mismatch",
      `Agent name ${document.name} does not match binding "${bindingName}"`,
      { bindingName, agentName: document.name, definition },
    );
  }

  const directory = path.dirname(filePath);
  const { instructions, instructionsPath } = loadAgentInstructions(directory, document);
  return {
    document,
    bindingName,
    definition,
    directory,
    path: filePath,
    instructions,
    instructionsPath,
  };
}

function loadAgentInstructions(
  directory: string,
  document: AgentDocument,
): { instructions: string; instructionsPath: string } {
  assertFileTarget(document.instructions);
  const resolved = path.resolve(directory, document.instructions);
  const relative = path.relative(directory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw configurationInvalid(
      "agent_instructions_escape",
      `Agent instructions path escapes the Agent directory`,
      { instructions: document.instructions },
    );
  }
  if (!fs.existsSync(resolved)) {
    throw configurationInvalid(
      "agent_instructions_missing",
      `Agent instructions file not found`,
      { path: resolved, instructions: document.instructions },
    );
  }
  const instructions = fs.readFileSync(resolved, "utf8");
  if (instructions.trim().length === 0) {
    throw configurationInvalid(
      "agent_instructions_empty",
      `Agent instructions file is empty`,
      { path: resolved },
    );
  }
  return { instructions, instructionsPath: resolved };
}
