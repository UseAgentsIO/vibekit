import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  formatModuleId,
  isModuleName,
  planInstall,
  readProjectDocument,
  resolveProjectWorkspace,
  VibeKitError,
  writeInstalledManifest,
  writeProjectDocument,
} from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import { formatModelSummary, formatSelectedModel, providerDisplayName, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection, slugify } from "../paths.js";
import { canPrompt } from "../prompt.js";
import { ensureInstalledSecrets } from "../secrets.js";
import { assertProjectIdentityAvailable, registerProject } from "../project-registry.js";
import { resolveProjectAgents } from "../setup-agents.js";
import {
  asMenuOptions,
  SETUP_AGENTS,
  SETUP_INTERFACES,
  delegationContractsFromRegistry,
  deriveDelegation,
  expandDelegationAgents,
  inferDefaultAgent,
  setupItemsFromRegistry,
} from "../setup-catalog.js";
import {
  SETUP_ABILITIES,
  DEFAULT_SETUP_ABILITIES,
  abilityRoots,
  connectionItems,
  normalizeWorkspaceSelection,
  restrictProjectAbilities,
} from "../setup-language.js";
import { omitProductRuntimeDependencies } from "../internal/runtime-identifiers.js";
import { runProductDoctor } from "../product-doctor.js";
import { printDoctor } from "./doctor.js";
import { confirm, isSubmit, resolveMultiSelect, resolveSelect, text } from "../ui/index.js";

const HEADQUARTERS_EXAMPLE = "headquarters";
const DEFAULT_AGENTS = ["assistant"] as const;
const DEFAULT_POLICY_ROOTS = [formatModuleId("policy", "least-privilege")] as const;
const CODING_AGENTS = ["coder"] as const;
const CHIEF_TEAM_AGENTS = [
  "chief",
  "project-manager",
  "coder",
  "reviewer",
  "researcher",
  "personal",
] as const;

export interface CreateRunOptions {
  /** Setup uses the same composition path while choosing the amount of copy to show. */
  readonly setupMode?: "default" | "custom" | "prompt";
}

export async function runCreate(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
  options?: CreateRunOptions,
): Promise<number> {
  const target = resolveProjectDir(positionals[0] ?? flags.dir);
  if (fs.existsSync(path.join(target, ".vibekit/project.yaml"))) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_exists",
      message: `A VibeKit Project already exists in ${target}`,
    });
  }

  const name = path.basename(target);
  const slug = isModuleName(slugify(name)) ? slugify(name) : "app";
  assertProjectIdentityAvailable(`project:${slug}`, target);
  const { registry, source: registrySource } = resolveRegistrySelection(flags.registry);
  const selectedResult = await selectProviderAndModel({
    out,
    projectId: `project:${slug}`,
    provider: flags.provider,
    model: flags.model,
    yes: flags.yes,
    verbose: flags.verbose,
    registry,
  });
  if (selectedResult.status !== "submit") {
    throw new VibeKitError({
      category: "cancelled",
      code: "prompt_cancelled",
      message: "Cancelled",
    });
  }
  const selected = selectedResult.value;
  const provider = selected.provider;
  const model = selected.id;
  const example = resolveExample(flags.example);
  const ordinary =
    flags.agents.length === 0 &&
    flags.interface === undefined &&
    flags.skills.length === 0 &&
    flags.tools.length === 0 &&
    flags.policies.length === 0;
  let defaultSetup = options?.setupMode === "default";
  if (
    options?.setupMode === "prompt" &&
    ordinary &&
    example === undefined &&
    !flags.yes &&
    canPrompt()
  ) {
    const customize = await confirm({
      message: "Customize setup? (No keeps the useful default)",
      initial: false,
    });
    if (!isSubmit(customize)) {
      throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
    }
    defaultSetup = customize.value !== true;
  }
  const promptOrdinary = ordinary && example === undefined && !defaultSetup;
  const fromFlags = flags.agents.length > 0 ? flags.agents : undefined;
  const skipAgentPrompt = flags.yes || !canPrompt();
  const defaultAgents =
    example === HEADQUARTERS_EXAMPLE
      ? CHIEF_TEAM_AGENTS
      : example === "coding"
        ? CODING_AGENTS
        : DEFAULT_AGENTS;
  let abilities = [...DEFAULT_SETUP_ABILITIES];
  let workspace = ".";
  let selectedConnections = flags.interface === undefined
    ? [example === HEADQUARTERS_EXAMPLE ? "telegram" : "terminal"]
    : [flags.interface];
  if (promptOrdinary && !skipAgentPrompt) {
    const pickedAbilities = await resolveMultiSelect({
      message: "Abilities",
      description: "What should this Project be able to do by default?",
      interactive: true,
      searchable: true,
      initial: [...DEFAULT_SETUP_ABILITIES],
      min: 1,
      hintBelow: true,
      options: asMenuOptions(SETUP_ABILITIES),
    });
    if (!isSubmit(pickedAbilities)) {
      throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
    }
    abilities = pickedAbilities.value;
    const pickedConnection = await resolveSelect({
      message: "Connections",
      description: "Where should messages come from?",
      interactive: true,
      value: undefined,
      searchable: true,
      options: asMenuOptions(connectionItems(setupItemsFromRegistry(SETUP_INTERFACES, registry, "interface"))),
    });
    if (!isSubmit(pickedConnection) || pickedConnection.value === undefined) {
      throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
    }
    selectedConnections = [pickedConnection.value];
    const pickedWorkspace = await text({
      message: "Workspace folder (relative to this Project, blank for the Project root)",
    });
    if (!isSubmit(pickedWorkspace)) {
      throw new VibeKitError({ category: "cancelled", code: "prompt_cancelled", message: "Cancelled" });
    }
    workspace = normalizeWorkspaceSelection(pickedWorkspace.value);
  }

  let agents: string[];
  let defaultAgent: string;
  if (ordinary && example === undefined) {
    agents = [...DEFAULT_AGENTS];
    defaultAgent = "assistant";
  } else if (ordinary && example !== undefined) {
    agents = [...defaultAgents];
    defaultAgent = inferDefaultAgent(agents) ?? agents[0] ?? "assistant";
  } else {
    const agentsResult = await resolveProjectAgents({
      values: fromFlags ?? (skipAgentPrompt || example !== undefined ? defaultAgents : undefined),
      required: true,
      interactive: canPrompt() && !flags.yes && example === undefined,
      items: setupItemsFromRegistry(SETUP_AGENTS, registry, "agent"),
    });
    if (agentsResult.status !== "submit") {
      throw new VibeKitError({
        category: "cancelled",
        code: "prompt_cancelled",
        message: "Cancelled",
      });
    }
    agents = [...agentsResult.value.agents];
    defaultAgent = agentsResult.value.defaultAgent ?? inferDefaultAgent(agents) ?? "assistant";
  }
  agents = expandDelegationAgents(registry, agents);
  const iface = flags.interface ?? selectedConnections[0] ?? (example === HEADQUARTERS_EXAMPLE ? "telegram" : "terminal");
  const extraRoots =
    example === HEADQUARTERS_EXAMPLE
      ? [formatModuleId("policy", "interface-pairing"), formatModuleId("policy", "untrusted-inbound")]
      : [];

  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(resolveProjectWorkspace(target, workspace), { recursive: true });
  ensureGitignore(target);

  let project = createDefaultProject({ slug, name, defaultAgent });
  project = {
    ...project,
    workspace,
    defaults: { model: { provider, id: model } },
    interfaceBindings: {
      [`${iface}-main`]: {
        definition: `interface:${iface}`,
        enabled: true,
        defaultAgent,
        config: `.vibekit/config/interfaces/${iface}.yaml`,
      },
    },
  };
  if (ordinary) {
    project = restrictProjectAbilities(project, abilities);
  }
  writeProjectDocument(target, project);
  writeInstalledManifest(target, emptyInstalledManifest());
  fs.mkdirSync(path.join(target, ".vibekit/runtime"), { recursive: true });
  writeInterfaceConfig(target, iface, example === HEADQUARTERS_EXAMPLE);

  const manifest = emptyInstalledManifest();
  const planned = planInstall({
    projectRoot: target,
    registry,
    roots: [
      ...agents.map((agent) => formatModuleId("agent", agent)),
      formatModuleId("provider", provider),
      formatModuleId("interface", iface),
      ...(ordinary && example === undefined ? abilityRoots(abilities) : []),
      ...(ordinary ? DEFAULT_POLICY_ROOTS : []),
      ...extraRoots,
    ],
    project,
    manifest,
    registrySource,
  });
  const plan = {
    ...planned,
    packageDependencies: omitProductRuntimeDependencies(planned.packageDependencies),
  };
  applyInstall({ projectRoot: target, plan });
  if (example === HEADQUARTERS_EXAMPLE) {
    applyExamplePolicies(target);
  }

  const updated = readProjectDocument(target);
  writeProjectDocument(target, {
    ...updated,
    defaultAgent,
    defaults: { model: { provider, id: model } },
    interfaceBindings: project.interfaceBindings,
    delegation: {
      ...updated.delegation,
      ...deriveDelegation(agents, delegationContractsFromRegistry(registry, agents)),
    },
  });

  // A Project is only created after its installed composition passes the same
  // integrity gate users can run later. This keeps a misleading `Created`
  // line out of failed release and clean-machine setup paths.
  const report = await runProductDoctor({ projectRoot: target, registry });
  if (report.errorCount > 0) {
    printDoctor(report, out);
    const firstError = report.findings.find((finding) => finding.severity === "error");
    throw new VibeKitError({
      category: "unavailable",
      code: "project_not_ready",
      message:
        `Project setup stopped because ${firstError?.message ?? "the Project is not ready"}. ` +
        `Run \`vibekit doctor --dir ${target}\` and apply the listed repair action, then retry create.`,
      details: { projectRoot: target, findings: report.findings },
    });
  }
  printDoctor(report, out);
  registerProject(target);

  out.log(`${options?.setupMode === undefined ? "Created" : "Set up"} VibeKit Project in ${target}`);
  if (ordinary) {
    const presetName = example === undefined
      ? "General Assistant"
      : example === "coding"
        ? "Coding Project"
        : "Chief-led team";
    out.log(`Instructions: ${presetName}`);
    out.log(`Abilities: ${SETUP_ABILITIES.filter((item) => abilities.includes(item.id)).map((item) => item.label).join(", ")}`);
    out.log(`Workspace: ${workspace}`);
    const connectionLabel = connectionItems(setupItemsFromRegistry(SETUP_INTERFACES, registry, "interface"))
      .find((item) => item.id === iface)?.label ?? iface;
    out.log(`Connections: ${connectionLabel}`);
  } else {
    if (agents.length === 1) {
      out.log(`Agent: ${agents[0]}`);
    } else {
      out.log(`Agents: ${agents.join(", ")}`);
      out.log(`Default agent: ${defaultAgent}`);
    }
  }
  out.log(ordinary ? `Model: ${formatModelSummary(selected, providerDisplayName(provider))}` : formatSelectedModel(selected));
  if (!ordinary) out.log(`Interface: ${iface}`);
  if (example !== undefined) {
    out.log(`Example: ${example}`);
  }
  await ensureInstalledSecrets({
    projectRoot: target,
    registry,
    yes: flags.yes,
    out,
  });
  if (options?.setupMode === undefined) {
    out.log("");
    out.log("Next:");
    out.log(`  cd ${target}`);
    if (iface === "telegram") {
      out.log(`  export TELEGRAM_BOT_TOKEN=...   # if not prompted`);
      out.log(`  vibekit start`);
      out.log(`  # then message the bot and run: vibekit approve-pairing <code>`);
    } else {
      out.log(`  vibekit msg "Hello"`);
      out.log(`  vibekit model`);
    }
  }

  return 0;
}

function ensureGitignore(target: string): void {
  const filePath = path.join(target, ".gitignore");
  const rule = ".vibekit/runtime/";
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# VibeKit\n${rule}\n`, "utf8");
    return;
  }
  const existing = fs.readFileSync(filePath, "utf8");
  if (!existing.includes(rule)) {
    fs.appendFileSync(filePath, `\n# VibeKit\n${rule}\n`, "utf8");
  }
}

function writeInterfaceConfig(target: string, iface: string, optionalStart = false): void {
  const filePath = path.join(target, ".vibekit/config/interfaces", `${iface}.yaml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, interfaceConfigYaml(iface, optionalStart), "utf8");
}

function interfaceConfigYaml(iface: string, optionalStart: boolean): string {
  if (iface === "telegram") {
    return `optionalStart: ${optionalStart ? "true" : "false"}\n`;
  }
  if (iface === "terminal") {
    return `mode: print\n`;
  }
  return "{}\n";
}

function resolveExample(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const aliases: Readonly<Record<string, string>> = {
    assistant: "assistant",
    "general-assistant": "assistant",
    coding: "coding",
    "coding-project": "coding",
    headquarters: HEADQUARTERS_EXAMPLE,
    "chief-led-team": HEADQUARTERS_EXAMPLE,
  };
  const resolved = aliases[value];
  if (resolved === undefined) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "example_unknown",
      message: `Unknown example "${value}". Available: assistant, coding, ${HEADQUARTERS_EXAMPLE}`,
    });
  }
  return resolved;
}

function applyExamplePolicies(target: string): void {
  const current = readProjectDocument(target);
  const policies = [...current.policies];
  for (const id of ["policy:interface-pairing", "policy:untrusted-inbound"] as const) {
    if (!policies.includes(id)) {
      policies.push(id);
    }
  }
  writeProjectDocument(target, { ...current, policies });
}
