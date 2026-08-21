import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  formatModuleId,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  type ProjectDocument,
  type Registry,
  VibeKitError,
} from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import {
  ensurePersistentAvailability,
  projectRequiresPersistentAvailability,
} from "../host-control.js";
import { formatSelectedModel, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection } from "../paths.js";
import { canPrompt } from "../prompt.js";
import { runProductDoctor } from "../product-doctor.js";
import { registerProject } from "../project-registry.js";
import {
  abilityRoots,
  DEFAULT_SETUP_ABILITIES,
  restrictProjectAbilities,
} from "../setup-language.js";
import { expandDelegationAgents } from "../setup-catalog.js";
import { confirm, isSubmit } from "../ui/index.js";
import { omitProductRuntimeDependencies } from "../internal/runtime-identifiers.js";
import { ensureInstalledSecrets } from "../secrets.js";
import { printDoctor } from "./doctor.js";
import { runCreate } from "./create.js";
import { runMsg } from "./msg.js";
import { runStart } from "./start.js";

const DEFAULT_AGENT = "assistant";
const DEFAULT_INTERFACE = "terminal";
const DEFAULT_POLICY = formatModuleId("policy", "least-privilege");
const CONVERSATION_PROOF = "Reply with exactly READY. Do not use tools.";

export interface SetupRunOptions {
  /** Bare invocation uses setup and then opens the primary Interface. */
  readonly openInterface?: boolean;
}

export async function runSetup(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
  options?: SetupRunOptions,
): Promise<number> {
  const projectRoot = resolveProjectDir(positionals[0] ?? flags.dir);
  const projectPath = path.join(projectRoot, ".vibekit", "project.yaml");
  const fresh = !fs.existsSync(projectPath);
  if (fresh) {
    await runCreate(positionals, flags, out, {
      setupMode: flags.customize ? "custom" : "prompt",
    });
  } else {
    await updateExistingProject(projectRoot, flags, out);
  }

  if (options?.openInterface === false) {
    return 0;
  }
  return finishFirstRun(projectRoot, flags, out);
}

/** Open an existing Project's configured primary connection without re-running setup. */
export async function openPrimaryInterface(
  projectRoot: string,
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const project = readProjectDocument(projectRoot);
  const enabled = Object.values(project.interfaceBindings ?? {}).filter((binding) => binding.enabled);
  if (enabled.some((binding) => binding.definition === "interface:terminal") && canPrompt()) {
    return runStart([], { ...flags, dir: projectRoot, foreground: true }, out);
  }
  const started = await ensurePersistentAvailability(projectRoot, {
    ensureGateway: projectRequiresPersistentAvailability(project),
  });
  if (!started.ok) {
    out.error(started.error ?? "VibeKit could not start this Project.");
    return 1;
  }
  out.log("VibeKit is ready.");
  return 0;
}

async function finishFirstRun(
  projectRoot: string,
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const project = readProjectDocument(projectRoot);
  const terminal = Object.values(project.interfaceBindings ?? {})
    .some((binding) => binding.enabled && binding.definition === "interface:terminal");
  const needsPersistence = projectRequiresPersistentAvailability(project);
  let installGateway = false;
  if (needsPersistence && canPrompt() && !flags.yes) {
    const persistence = await confirm({
      message: "Keep VibeKit available after login?",
      initial: true,
    });
    installGateway = isSubmit(persistence) && persistence.value === true;
  }

  out.log("Checking the first conversation...");
  if (!terminal && needsPersistence) {
    const started = await ensurePersistentAvailability(projectRoot, {
      ensureGateway: true,
      installGateway,
    });
    if (!started.ok) {
      out.error(started.error ?? "VibeKit could not start this Project.");
      return 1;
    }
  }

  const proof = await runMsg([CONVERSATION_PROOF], { ...flags, dir: projectRoot }, out);
  if (proof !== 0) {
    out.error("The Project is installed, but the first conversation check failed. Check model authentication and rerun `vibekit setup`.");
    return proof;
  }
  out.log("Conversation check: ready.");

  if (terminal && canPrompt()) {
    return runStart([], { ...flags, dir: projectRoot, foreground: true }, out);
  }
  out.log("VibeKit is ready.");
  return 0;
}

async function updateExistingProject(
  projectRoot: string,
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<void> {
  const { registry, source } = resolveRegistrySelection(flags.registry);
  const current = readProjectDocument(projectRoot);
  const currentModel = current.defaults?.model;
  let model = currentModel;
  if (flags.provider !== undefined || flags.model !== undefined || currentModel === undefined) {
    const selected = await selectProviderAndModel({
      out,
      projectId: current.id,
      provider: flags.provider ?? currentModel?.provider,
      model: flags.model ?? currentModel?.id,
      yes: flags.yes,
      verbose: flags.verbose,
      registry,
    });
    if (selected.status !== "submit") {
      throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
    }
    model = selected.value;
    out.log(formatSelectedModel(selected.value));
  }

  const existingAgentNames = agentNames(current);
  const existingInterfaces = current.interfaceBindings ?? {};
  const isEmptyProject = existingAgentNames.length === 0 && Object.keys(existingInterfaces).length === 0;
  const selectedAgents = flags.agents.length > 0 ? [...flags.agents] : existingAgentNames.length > 0 ? existingAgentNames : [DEFAULT_AGENT];
  const agents = expandDelegationAgents(registry, selectedAgents);
  const interfaceBindings = flags.interface !== undefined
    ? { ...existingInterfaces, ...defaultInterfaceBinding(flags.interface, agents[0] ?? DEFAULT_AGENT) }
    : Object.keys(existingInterfaces).length > 0 || !isEmptyProject
      ? existingInterfaces
      : defaultInterfaceBinding(DEFAULT_INTERFACE, agents[0] ?? DEFAULT_AGENT);
  const enabledInterfaces = Object.values(interfaceBindings)
    .filter((binding) => binding.enabled)
    .map((binding) => binding.definition.slice("interface:".length));

  let project: ProjectDocument = {
    ...current,
    ...(current.defaultAgent === undefined ? { defaultAgent: agents[0] ?? DEFAULT_AGENT } : {}),
    ...(model === undefined ? {} : { defaults: { ...current.defaults, model: { provider: model.provider, id: model.id } } }),
    interfaceBindings,
  };
  if (isEmptyProject) {
    project = restrictProjectAbilities(project, DEFAULT_SETUP_ABILITIES);
  }

  const roots = [
    ...agents.map((agent) => formatModuleId("agent", agent)),
    ...(model === undefined ? [] : [formatModuleId("provider", model.provider)]),
    ...enabledInterfaces.map((iface) => formatModuleId("interface", iface)),
    ...(isEmptyProject ? abilityRoots(DEFAULT_SETUP_ABILITIES) : []),
    ...(isEmptyProject ? [DEFAULT_POLICY] : []),
    ...flags.skills.map((skill) => formatModuleId("skill", skill)),
    ...flags.tools.map((tool) => formatModuleId("tool", tool)),
    ...flags.policies.map((policy) => formatModuleId("policy", policy)),
  ];
  const planned = planInstall({
    projectRoot,
    registry,
    roots,
    project,
    manifest: readInstalledManifest(projectRoot),
    registrySource: source,
  });
  applyInstall({
    projectRoot,
    plan: {
      ...planned,
      packageDependencies: omitProductRuntimeDependencies(planned.packageDependencies),
    },
  });
  registerProject(projectRoot);
  await ensureInstalledSecretsForSetup(projectRoot, registry, flags, out);

  const report = await runProductDoctor({ projectRoot, registry });
  printDoctor(report, out);
  if (report.errorCount > 0) {
    const firstError = report.findings.find((finding) => finding.severity === "error");
    throw new VibeKitError({
      category: "unavailable",
      code: "project_not_ready",
      message: firstError?.message ?? "The Project is not ready",
    });
  }
  out.log("Setup is complete and your existing choices were preserved.");
}

function agentNames(project: ProjectDocument): string[] {
  return Object.values(project.agentBindings)
    .map((binding) => binding.definition)
    .filter((definition) => definition.startsWith("agent:"))
    .map((definition) => definition.slice("agent:".length));
}

function defaultInterfaceBinding(
  iface: string,
  defaultAgent: string,
): NonNullable<ProjectDocument["interfaceBindings"]> {
  return {
    [`${iface}-main`]: {
      definition: formatModuleId("interface", iface),
      enabled: true,
      defaultAgent,
      config: `.vibekit/config/interfaces/${iface}.yaml`,
    },
  };
}

async function ensureInstalledSecretsForSetup(
  projectRoot: string,
  registry: Registry,
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<void> {
  await ensureInstalledSecrets({ projectRoot, registry, yes: flags.yes, out });
}
