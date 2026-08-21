import fs from "node:fs";
import path from "node:path";

import { PROJECT_RELATIVE_PATH } from "./constants.js";
import { VibeKitError } from "./errors.js";
import { formatProjectId } from "./ids.js";
import { PROJECT_SCHEMA_VERSION } from "./schema-version.js";
import type { ProjectDocument } from "./types.js";
import { parseAndValidateYaml, validateDocument } from "./validate.js";
import { stringifyYaml } from "./yaml.js";
import { safeResolve } from "./paths.js";

const DEFAULT_RUNTIME = {
  adapter: "vibekit:pi",
  host: "vibekit:host",
} as const;

const DEFAULT_HOST = {
  retainedConversations: 20,
  maxParallelConversations: 4,
  sameConversationPolicy: "serialize",
  shutdownGraceMs: 30000,
} as const;

const DEFAULT_TRACKING = {
  conversations: "local",
  decisions: "git",
  tasks: "local",
  results: "local",
  approvals: "local",
  verifications: "local",
  events: "local",
  runtime: "ephemeral",
} as const;

const DEFAULT_EXECUTION = {
  maxParallelRuns: 4,
  defaultIsolation: "process",
  mutationIsolation: "worktree",
  defaultTimeoutMs: 600000,
  maxDelegationDepth: 2,
} as const;

const DEFAULT_AUTHORIZATION = {
  default: "deny",
  actions: {
    "source.read": "standing",
    "source.write": "standing",
    "command.execute": "standing",
    "web.fetch": "standing",
    "web.search": "standing",
    "memory.read": "standing",
    "memory.write": "standing",
    "agent.delegate": "standing",
    "repository.issue.write": "explicit",
    "repository.write": "explicit",
    "schedule.write": "explicit",
    "outbound.send": "explicit",
    "purchase.execute": "explicit",
    "deploy.apply": "explicit",
    "destructive.delete": "explicit",
    "project.configure": "explicit",
  },
} as const;

const DEFAULT_SOURCES = {
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
} as const;

const EXPLICIT_PROJECT_FIELDS = Symbol("vibekit.explicitProjectFields");

interface ExplicitProjectFields {
  readonly paths: ReadonlySet<string>;
}

type ProjectWithPresence = ProjectDocument & {
  readonly [EXPLICIT_PROJECT_FIELDS]?: ExplicitProjectFields;
};

export const PROJECT_RUNTIME_DEFAULTS = {
  runtime: DEFAULT_RUNTIME,
  host: DEFAULT_HOST,
  root: ".",
  workspace: ".",
  pi: { compatibility: ">=0.50.0" },
  state: {
    backend: "state:repository",
    path: ".vibekit/state",
    tracking: DEFAULT_TRACKING,
  },
  execution: DEFAULT_EXECUTION,
  authorization: DEFAULT_AUTHORIZATION,
  verification: { default: [] as readonly never[] },
  sources: DEFAULT_SOURCES,
} as const;

export function projectDocumentPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_RELATIVE_PATH);
}

/** Resolve the user-selected working area without allowing it to escape the Project. */
export function resolveProjectWorkspace(projectRoot: string, workspace = "."): string {
  const resolvedRoot = path.resolve(projectRoot);
  const resolved = safeResolve(resolvedRoot, workspace.length > 0 ? workspace : ".");
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor) && existingAncestor !== resolvedRoot) {
    existingAncestor = path.dirname(existingAncestor);
  }
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realAncestor = fs.realpathSync(existingAncestor);
    const relative = path.relative(realRoot, realAncestor);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "file_target_symlink_escape",
        message: `Workspace "${workspace}" escapes the Project through a symlink`,
        details: { workspace, root: resolvedRoot },
      });
    }
  } catch (error) {
    if (error instanceof VibeKitError) throw error;
  }
  return resolved;
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
  const filePath = projectDocumentPath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, serializeProjectDocument(project), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function serializeProjectDocument(project: ProjectDocument): string {
  const normalized = normalizeProjectDocument(project);
  const validated = validateDocument("project", compactProjectDocument(normalized));
  if (!validated.valid || validated.data === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "project_invalid",
      message: validated.errors[0]?.message ?? "project.yaml is invalid",
      details: { errors: validated.errors },
    });
  }
  return stringifyYaml(validated.data);
}

/**
 * Fill runtime-owned defaults at the load boundary so Project files can stay
 * focused on identity, choices, and explicit overrides.
 */
export function normalizeProjectDocument(project: ProjectDocument): ProjectDocument {
  const normalized = {
    schemaVersion: project.schemaVersion,
    id: project.id,
    name: project.name,
    root: project.root ?? PROJECT_RUNTIME_DEFAULTS.root,
    workspace: project.workspace ?? PROJECT_RUNTIME_DEFAULTS.workspace,
    runtime: {
      ...PROJECT_RUNTIME_DEFAULTS.runtime,
      ...project.runtime,
    },
    ...(project.defaultAgent !== undefined ? { defaultAgent: project.defaultAgent } : {}),
    host: {
      ...PROJECT_RUNTIME_DEFAULTS.host,
      ...project.host,
    },
    interfaceBindings: project.interfaceBindings ?? {},
    pi: {
      ...PROJECT_RUNTIME_DEFAULTS.pi,
      ...project.pi,
    },
    ...(project.defaults !== undefined ? { defaults: project.defaults } : {}),
    state: {
      ...PROJECT_RUNTIME_DEFAULTS.state,
      ...project.state,
      tracking: {
        ...PROJECT_RUNTIME_DEFAULTS.state.tracking,
        ...project.state?.tracking,
      },
    },
    agentBindings: project.agentBindings ?? {},
    delegation: project.delegation ?? {},
    capabilityBindings: project.capabilityBindings ?? {},
    policies: project.policies ?? [],
    execution: {
      ...PROJECT_RUNTIME_DEFAULTS.execution,
      ...project.execution,
    },
    authorization: {
      ...PROJECT_RUNTIME_DEFAULTS.authorization,
      ...project.authorization,
      actions: project.authorization?.actions === undefined
        ? PROJECT_RUNTIME_DEFAULTS.authorization.actions
        : project.authorization.actions,
    },
    verification: {
      default: project.verification?.default ?? [],
    },
    sources: {
      ...PROJECT_RUNTIME_DEFAULTS.sources,
      ...project.sources,
      canonical: project.sources?.canonical ?? PROJECT_RUNTIME_DEFAULTS.sources.canonical,
      untrusted: project.sources?.untrusted ?? PROJECT_RUNTIME_DEFAULTS.sources.untrusted,
    },
  };
  attachExplicitProjectFields(
    normalized,
    getExplicitProjectFields(project) ?? captureExplicitProjectFields(project),
  );
  return normalized;
}

function compactProjectDocument(project: ProjectDocument): Record<string, unknown> {
  const persisted: Record<string, unknown> = { ...project };
  delete persisted[EXPLICIT_PROJECT_FIELDS as unknown as string];
  const explicit = getExplicitProjectFields(project);
  if (project.root === PROJECT_RUNTIME_DEFAULTS.root && !hasExplicitPath(explicit, "root")) {
    delete persisted.root;
  }
  if (project.workspace === PROJECT_RUNTIME_DEFAULTS.workspace && !hasExplicitPath(explicit, "workspace")) {
    delete persisted.workspace;
  }
  compactSection(persisted, "runtime", project.runtime, PROJECT_RUNTIME_DEFAULTS.runtime, explicit);
  compactSection(persisted, "host", project.host, PROJECT_RUNTIME_DEFAULTS.host, explicit);
  compactSection(persisted, "pi", project.pi, PROJECT_RUNTIME_DEFAULTS.pi, explicit);
  compactSection(persisted, "execution", project.execution, PROJECT_RUNTIME_DEFAULTS.execution, explicit);

  const authorization = compactNestedSection(
    project.authorization,
    PROJECT_RUNTIME_DEFAULTS.authorization,
    "authorization",
    explicit,
  );
  if (Object.keys(authorization).length === 0 && !hasExplicitPath(explicit, "authorization")) {
    delete persisted.authorization;
  } else {
    persisted.authorization = authorization;
  }
  if (
    project.verification.default.length === 0 &&
    !hasExplicitPath(explicit, "verification") &&
    !hasExplicitPath(explicit, "verification.default")
  ) {
    delete persisted.verification;
  }
  const sources = compactNestedSection(project.sources, PROJECT_RUNTIME_DEFAULTS.sources, "sources", explicit);
  if (Object.keys(sources).length === 0 && !hasExplicitPath(explicit, "sources")) {
    delete persisted.sources;
  } else {
    persisted.sources = sources;
  }

  const tracking = project.state.tracking;
  const state = {
    backend: project.state.backend,
    path: project.state.path,
    ...(Object.keys(compactNestedSection(
      tracking,
      PROJECT_RUNTIME_DEFAULTS.state.tracking,
      "state.tracking",
      explicit,
    )).length === 0
      ? {}
      : {
          tracking: compactNestedSection(
            tracking,
            PROJECT_RUNTIME_DEFAULTS.state.tracking,
            "state.tracking",
            explicit,
          ),
        }),
  };
  persisted.state = state;
  if (Object.keys(project.interfaceBindings ?? {}).length === 0 && !hasExplicitPath(explicit, "interfaceBindings")) {
    delete persisted.interfaceBindings;
  }
  if (Object.keys(project.agentBindings).length === 0 && !hasExplicitPath(explicit, "agentBindings")) {
    delete persisted.agentBindings;
  }
  if (Object.keys(project.delegation).length === 0 && !hasExplicitPath(explicit, "delegation")) {
    delete persisted.delegation;
  }
  if (Object.keys(project.capabilityBindings).length === 0 && !hasExplicitPath(explicit, "capabilityBindings")) {
    delete persisted.capabilityBindings;
  }
  if (project.policies.length === 0 && !hasExplicitPath(explicit, "policies")) {
    delete persisted.policies;
  }
  return persisted;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compactSection(
  persisted: Record<string, unknown>,
  key: string,
  value: object | undefined,
  defaults: object,
  explicit: ExplicitProjectFields | undefined,
): void {
  const compacted = compactNestedSection(value, defaults, key, explicit);
  if (Object.keys(compacted).length === 0 && !hasExplicitPath(explicit, key)) {
    delete persisted[key];
  } else {
    persisted[key] = compacted;
  }
}

function compactNestedSection(
  value: object | undefined,
  defaults: object,
  prefix: string,
  explicit: ExplicitProjectFields | undefined,
): Record<string, unknown> {
  const defaultValues = defaults as Record<string, unknown>;
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    const path = `${prefix}.${key}`;
    const defaultEntry = defaultValues[key];
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      defaultEntry !== null &&
      typeof defaultEntry === "object" &&
      !Array.isArray(defaultEntry)
    ) {
      const nested = compactNestedSection(entry as object, defaultEntry as object, path, explicit);
      if (Object.keys(nested).length > 0 || hasExplicitPath(explicit, path)) {
        compacted[key] = nested;
      }
    } else if (!deepEqual(entry, defaultEntry) || hasExplicitPath(explicit, path)) {
      compacted[key] = entry;
    }
  }
  return compacted;
}

function captureExplicitProjectFields(project: ProjectDocument): ExplicitProjectFields {
  const paths = new Set<string>();
  const visit = (value: unknown, prefix: string): void => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      const current = prefix.length > 0 ? `${prefix}.${key}` : key;
      paths.add(current);
      visit(entry, current);
    }
  };
  visit(project, "");
  return { paths };
}

function getExplicitProjectFields(project: ProjectDocument): ExplicitProjectFields | undefined {
  return (project as ProjectWithPresence)[EXPLICIT_PROJECT_FIELDS];
}

export function copyProjectFieldPresence(source: ProjectDocument, target: ProjectDocument): void {
  attachExplicitProjectFields(
    target,
    getExplicitProjectFields(source) ?? captureExplicitProjectFields(source),
  );
}

function attachExplicitProjectFields(
  project: ProjectDocument,
  explicit: ExplicitProjectFields,
): void {
  Object.defineProperty(project, EXPLICIT_PROJECT_FIELDS, {
    configurable: true,
    enumerable: true,
    value: explicit,
    writable: false,
  });
}

function hasExplicitPath(explicit: ExplicitProjectFields | undefined, path: string): boolean {
  return explicit?.paths.has(path) ?? false;
}

export function createDefaultProject(options: {
  slug: string;
  name: string;
  defaultAgent?: string;
}): ProjectDocument {
  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: formatProjectId(options.slug),
    name: options.name,
    root: ".",
    workspace: ".",
    runtime: { ...PROJECT_RUNTIME_DEFAULTS.runtime },
    ...(options.defaultAgent !== undefined ? { defaultAgent: options.defaultAgent } : {}),
    host: { ...PROJECT_RUNTIME_DEFAULTS.host },
    interfaceBindings: {},
    pi: {
      ...PROJECT_RUNTIME_DEFAULTS.pi,
    },
    state: {
      backend: PROJECT_RUNTIME_DEFAULTS.state.backend,
      path: PROJECT_RUNTIME_DEFAULTS.state.path,
      tracking: { ...PROJECT_RUNTIME_DEFAULTS.state.tracking },
    },
    agentBindings: {},
    delegation: {},
    capabilityBindings: {},
    policies: [],
    execution: { ...PROJECT_RUNTIME_DEFAULTS.execution },
    authorization: structuredClone(PROJECT_RUNTIME_DEFAULTS.authorization),
    verification: { default: [] },
    sources: structuredClone(PROJECT_RUNTIME_DEFAULTS.sources),
  };
  attachExplicitProjectFields(project, { paths: new Set<string>() });
  return project;
}
