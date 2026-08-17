import fs from "node:fs";
import path from "node:path";

import { PROJECT_RELATIVE_PATH } from "./constants.js";
import { VibeKitError } from "./errors.js";
import { formatProjectId } from "./ids.js";
import type { ProjectDocument } from "./types.js";
import { parseAndValidateYaml, validateDocument } from "./validate.js";
import { stringifyYaml } from "./yaml.js";

export function projectDocumentPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_RELATIVE_PATH);
}

export function readProjectDocument(projectRoot: string): ProjectDocument {
  const filePath = projectDocumentPath(projectRoot);
  if (!fs.existsSync(filePath)) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_missing",
      message: `Project contract not found at ${PROJECT_RELATIVE_PATH}`,
      details: { path: filePath },
    });
  }
  const result = parseAndValidateYaml("project", fs.readFileSync(filePath, "utf8"));
  if (!result.valid || result.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_invalid",
      message: result.errors[0]?.message ?? "project.yaml is invalid",
      details: { errors: result.errors },
    });
  }
  return result.data;
}

export function writeProjectDocument(projectRoot: string, project: ProjectDocument): void {
  const validated = validateDocument("project", project);
  if (!validated.valid || validated.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_invalid",
      message: validated.errors[0]?.message ?? "project.yaml is invalid",
      details: { errors: validated.errors },
    });
  }
  const filePath = projectDocumentPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, stringifyYaml(validated.data), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function createDefaultProject(options: {
  slug: string;
  name: string;
}): ProjectDocument {
  return {
    schemaVersion: 1,
    id: formatProjectId(options.slug),
    name: options.name,
    root: ".",
    runtime: {
      adapter: "@vibekit/pi",
    },
    pi: {
      compatibility: ">=0.50.0",
    },
    state: {
      backend: "state:repository",
      path: ".vibekit/state",
      tracking: {
        decisions: "git",
        tasks: "local",
        results: "local",
        approvals: "local",
        verifications: "local",
        events: "local",
        runtime: "ephemeral",
      },
    },
    agentBindings: {},
    delegation: {},
    capabilityBindings: {},
    policies: [],
    execution: {
      maxParallelRuns: 4,
      defaultIsolation: "process",
      mutationIsolation: "worktree",
      defaultTimeoutMs: 600000,
      maxDelegationDepth: 2,
    },
    authorization: {
      default: "deny",
      actions: {
        "source.read": "standing",
        "source.write": "standing",
        "deploy.apply": "explicit",
        "destructive.delete": "explicit",
        "project.configure": "explicit",
      },
    },
    verification: {
      default: [],
    },
    sources: {
      canonical: [
        ".vibekit/project.yaml",
        ".vibekit/agents/",
        ".vibekit/state/decisions/",
      ],
      untrusted: [
        "external documents",
        "issue text",
        "web content",
        "tool output",
        "retrieved memory",
      ],
    },
  };
}
