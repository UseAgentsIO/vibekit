import path from "node:path";

import {
  normalizeProjectDocument,
  PROJECT_RELATIVE_PATH,
  type ProjectDocument,
} from "../core/index.js";

import { assertValidDocument, readValidatedYaml } from "./documents.js";

export function projectDocumentPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), PROJECT_RELATIVE_PATH);
}

export function loadProjectDocument(projectRoot: string): ProjectDocument {
  return readValidatedYaml("project", projectDocumentPath(projectRoot), {
    missing: "project_missing",
    invalid: "project_invalid",
  });
}

export function resolveProjectDocument(
  projectRoot: string,
  project?: ProjectDocument,
): ProjectDocument {
  if (project !== undefined) {
    return normalizeProjectDocument(assertValidDocument("project", project, "project_invalid"));
  }
  return loadProjectDocument(projectRoot);
}
