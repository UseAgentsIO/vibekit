import fs from "node:fs";
import path from "node:path";

import {
  RUNTIME_GITIGNORE_RULE,
  VibeKitError,
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  formatModuleId,
  isModuleName,
  planInstall,
  readInstalledManifest,
  readProjectDocument,
  resolveProjectWorkspace,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "../internal/core/index.js";

import { assertProjectIdentityAvailable, registerProject } from "../project-registry.js";

import { hasSetupFlags, type GlobalFlags } from "../args.js";
import {
  formatModelSummary,
  pickProviderId,
  providerDisplayName,
  selectProviderAndModel,
  type SelectedModel,
} from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import {
  resolveProjectDir,
  resolveRegistry,
  resolveRegistrySelection,
  slugify,
} from "../paths.js";
import { canPrompt } from "../prompt.js";
import { ensureInstalledSecrets } from "../secrets.js";
import {
  abilityRoots,
  connectionItems,
  DEFAULT_SETUP_ABILITIES,
  normalizeWorkspaceSelection,
  restrictProjectAbilities,
  SETUP_ABILITIES,
} from "../setup-language.js";
import {
  SETUP_AGENTS,
  SETUP_INTERFACES,
  SETUP_POLICIES,
  SETUP_SKILLS,
  SETUP_TOOLS,
  asMenuOptions,
  delegationContractsFromRegistry,
  deriveDelegation,
  expandDelegationAgents,
  inferDefaultAgent,
  labelFor,
  labelsFor,
  normalizeAgentIds,
  projectPolicyItems,
  setupItemsFromRegistry,
  type SetupItem,
} from "../setup-catalog.js";
import {
  BACK,
  CANCEL,
  confirm,
  printCompletion,
  printIntro,
  resolveMultiSelect,
  runWizard,
  submit,
  symbols,
  text,
  writeln,
} from "../ui/index.js";
import { clearRenderedLines } from "../ui/theme.js";
import { printDoctor } from "./doctor.js";

interface SetupPlan {
  readonly provider?: string;
  readonly model?: SelectedModel;
  readonly agents: readonly string[];
  readonly defaultAgent?: string;
  readonly ifaces: readonly string[];
  readonly skills: readonly string[];
  readonly policies: readonly string[];
  readonly tools: readonly string[];
  readonly abilities: readonly string[];
  readonly workspace: string;
  readonly ordinary: boolean;
}

interface SetupCatalog {
  readonly agents: readonly SetupItem[];
  readonly interfaces: readonly SetupItem[];
  readonly policies: readonly SetupItem[];
  readonly skills: readonly SetupItem[];
  readonly tools: readonly SetupItem[];
}

export async function runInit(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const started = Date.now();
  const target = resolveProjectDir(positionals[0] ?? flags.dir);
  const created: string[] = [];
  const changed: string[] = [];
  const setupFlags = hasSetupFlags(flags);
  const skipSetup = (flags.defaults || flags.yes || !canPrompt()) && !setupFlags;
  const showFiles = flags.showFiles || flags.verbose;

  const name = path.basename(target);
  const slug = isModuleName(slugify(name)) ? slugify(name) : "app";
  const projectFile = path.join(target, ".vibekit/project.yaml");
  const existed = fs.existsSync(projectFile);
  assertProjectIdentityAvailable(existed ? readProjectDocument(target).id : `project:${slug}`, target);

  fs.mkdirSync(target, { recursive: true });
  if (existed && skipSetup) {
    throw new VibeKitError({
      category: "conflict",
      code: "project_exists",
      message: `A VibeKit Project already exists in ${target}`,
    });
  }

  if (!existed) {
    writeProjectSkeleton(target, created, changed);
  }
  registerProject(target);

  if (skipSetup) {
    printCompletion(out, {
      title: `Initialized VibeKit Project in ${target}`,
      fileCount: uniqueExisting([...created, ...changed]).length,
      files: uniqueExisting([...created, ...changed]),
      showFiles,
      skipped: "Skipped setup. Use `vibekit add` or run `vibekit init` without --defaults.",
    });
    return finishDoctor(target, flags, out);
  }

  const interactive = canPrompt() && !flags.yes && !flags.defaults && !setupFlags;
  if (interactive) {
    printIntro("Configure this project", "Choose a model, abilities, workspace, and connections.");
  }

  const plan = await collectSetup(target, flags, out, {
    interactive: canPrompt() && !flags.yes && !setupFlags,
    verbose: flags.verbose,
  });
  if (plan === undefined) {
    out.log(existed ? "Setup cancelled." : "Setup cancelled. Empty project kept.");
    return finishDoctor(target, flags, out);
  }

  const catalog = setupCatalog(tryRegistry(flags.registry));
  const installed = applySetup(target, flags, plan);
  await ensureInstalledSecrets({
    projectRoot: target,
    registry: resolveRegistry(flags.registry),
    yes: flags.yes,
    out,
  });
  const files = uniqueExisting([...created, ...changed, ...installed]);
  printCompletion(out, {
    title: existed ? "Updated VibeKit project" : "Initialized VibeKit Project",
    lines: summaryLines(plan, flags.verbose, catalog),
    fileCount: files.length,
    files,
    showFiles,
    doctorOk: false,
    next: ['vibekit msg "Hello"'],
    elapsedMs: Date.now() - started,
  });
  return finishDoctor(target, flags, out);
}

async function collectSetup(
  target: string,
  flags: GlobalFlags,
  out: OutputBuffer,
  input: { readonly interactive: boolean; readonly verbose: boolean },
): Promise<SetupPlan | undefined> {
  if (!input.interactive) {
    if (flags.model !== undefined && flags.provider === undefined) {
      throw new VibeKitError({
        category: "invalid_input",
        code: "provider_required",
        message: "Pass --provider with --model",
      });
    }
    const agents = flags.agents.length > 0 ? flags.agents : ["assistant"];
    return {
      provider: flags.provider,
      model:
        flags.provider !== undefined && flags.model !== undefined
          ? { provider: flags.provider, id: flags.model, name: flags.model }
          : undefined,
      agents: normalizeAgentIds(agents),
      defaultAgent: inferDefaultAgent(agents),
      ifaces: flags.interface === undefined ? [] : [flags.interface],
      skills: flags.skills,
      policies: flags.policies,
      tools: flags.tools,
      abilities: DEFAULT_SETUP_ABILITIES,
      workspace: ".",
      ordinary: false,
    };
  }

  const registry = tryRegistry(flags.registry);
  const catalog = setupCatalog(registry);
  const project = readProjectDocument(target);
  const empty: SetupPlan = {
    provider: flags.provider,
    model: undefined,
    agents: normalizeAgentIds(flags.agents.length > 0 ? flags.agents : ["assistant"]),
    defaultAgent: inferDefaultAgent(flags.agents.length > 0 ? flags.agents : ["assistant"]),
    ifaces: flags.interface === undefined ? ["terminal"] : [flags.interface],
    skills: flags.skills,
    policies: flags.policies,
    tools: flags.tools,
    abilities: [...DEFAULT_SETUP_ABILITIES],
    workspace: ".",
    ordinary: true,
  };

  return runWizard({
    initial: empty,
    steps: [
      async (state) => {
        const provider = await pickProviderId({
          value: flags.provider,
          interactive: true,
          verbose: input.verbose,
          registry,
        });
        if (provider.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, provider: provider.value, model: undefined });
      },
      async (state) => {
        if (state.provider === undefined) {
          return submit({ ...state, model: undefined }, 0);
        }
        const model = await selectProviderAndModel({
          out,
          projectId: project.id,
          provider: state.provider,
          model: flags.model,
          yes: false,
          verbose: input.verbose,
          registry,
        });
        if (model.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, model: model.value });
      },
      async (state) => {
        const selected = await resolveMultiSelect({
          message: "Abilities",
          description: "What should this Project be able to do by default?",
          interactive: true,
          searchable: true,
          initial: [...DEFAULT_SETUP_ABILITIES],
          min: 1,
          hintBelow: true,
          options: asMenuOptions(SETUP_ABILITIES),
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, abilities: selected.value }, selected.lines ?? 1);
      },
      async (state) => {
        const selected = await resolveMultiSelect({
          message: "Connections",
          description: "Where should messages come from?",
          interactive: true,
          noneLabel: "None",
          hintBelow: true,
          initial: ["terminal"],
          options: asMenuOptions(connectionItems(catalog.interfaces)),
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, ifaces: selected.value });
      },
      async (state) => {
        const selected = await text({
          message: "Workspace folder (relative to this Project, blank for the Project root)",
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, workspace: normalizeWorkspaceSelection(selected.value) }, 1);
      },
      async (state) => {
        const rows = reviewRows(state, input.verbose, catalog);
        writeln("");
        writeln(`${symbols.open}  Ready to create?`);
        for (const row of rows) {
          writeln(`   ${row.label.padEnd(14)}${row.value}`);
        }
        writeln("");
        const tableLines = 3 + rows.length;
        const confirmed = await confirm({ message: "Create project?", initial: true });
        if (confirmed.status === "back") {
          clearRenderedLines(tableLines);
          return BACK;
        }
        if (confirmed.status !== "submit" || confirmed.value !== true) {
          clearRenderedLines(tableLines);
          return CANCEL;
        }
        return submit(state, tableLines + 1);
      },
    ],
  });
}

function applySetup(target: string, flags: GlobalFlags, plan: SetupPlan): string[] {
  const { registry, source } = resolveRegistrySelection(flags.registry);
  const project = readProjectDocument(target);
  const agents = expandDelegationAgents(registry, plan.agents);
  fs.mkdirSync(resolveProjectWorkspace(target, plan.workspace), { recursive: true });
  const composedProject = plan.ordinary
    ? restrictProjectAbilities(project, plan.abilities)
    : project;
  const roots = [
    ...(plan.provider === undefined ? [] : [formatModuleId("provider", plan.provider)]),
    ...agents.map((name) => formatModuleId("agent", name)),
    ...plan.ifaces.map((name) => formatModuleId("interface", name)),
    ...plan.skills.map((name) => formatModuleId("skill", name)),
    ...plan.policies.map((name) => formatModuleId("policy", name)),
    ...plan.tools.map((name) => formatModuleId("tool", name)),
    ...(plan.ordinary ? abilityRoots(plan.abilities) : []),
  ];
  const result = applyInstall({
    projectRoot: target,
    plan: planInstall({
      projectRoot: target,
      registry,
      roots,
      project: composedProject,
      manifest: readInstalledManifest(target),
      registrySource: source,
    }),
  });

  const installed = readProjectDocument(target);
  const defaultAgent = plan.defaultAgent ?? installed.defaultAgent;
  const delegation = agents.length === 0
    ? {}
    : deriveDelegation(agents, delegationContractsFromRegistry(registry, agents));
  const interfaceBindings = { ...installed.interfaceBindings };
  for (const iface of plan.ifaces) {
    writeInterfaceConfig(target, iface);
    interfaceBindings[`${iface}-main`] = {
      definition: `interface:${iface}`,
      enabled: true,
      defaultAgent: defaultAgent ?? "chief",
      config: `.vibekit/config/interfaces/${iface}.yaml`,
    };
  }
  writeProjectDocument(target, {
    ...installed,
    defaultAgent,
    defaults: plan.model === undefined
      ? installed.defaults
      : { ...installed.defaults, model: { provider: plan.model.provider, id: plan.model.id } },
    interfaceBindings,
    delegation: { ...installed.delegation, ...delegation },
    workspace: plan.workspace,
    authorization: Object.values(delegation).some((targets) => targets.length > 0)
      ? {
          ...composedProject.authorization,
          actions: { ...composedProject.authorization.actions, "agent.delegate": "standing" },
        }
      : composedProject.authorization,
  });
  return [...result.created, ...result.changed];
}

function setupCatalog(registry: ReturnType<typeof tryRegistry>): SetupCatalog {
  return {
    agents: setupItemsFromRegistry(SETUP_AGENTS, registry, "agent"),
    interfaces: setupItemsFromRegistry(SETUP_INTERFACES, registry, "interface"),
    policies: projectPolicyItems(setupItemsFromRegistry(SETUP_POLICIES, registry, "policy")),
    skills: setupItemsFromRegistry(SETUP_SKILLS, registry, "skill"),
    tools: setupItemsFromRegistry(SETUP_TOOLS, registry, "tool"),
  };
}

function reviewRows(
  plan: SetupPlan,
  verbose: boolean,
  catalog: SetupCatalog,
): Array<{ label: string; value: string }> {
  if (plan.ordinary) {
    return [
      {
        label: "Model",
        value:
          plan.model === undefined
            ? "None"
            : verbose
              ? `${plan.model.provider} / ${plan.model.id}`
              : formatModelSummary(plan.model, providerDisplayName(plan.model.provider)),
      },
      {
        label: "Instructions",
        value: labelFor(catalog.agents, plan.defaultAgent ?? "assistant"),
      },
      {
        label: "Abilities",
        value: verbose ? joinOrNone(plan.abilities) : labelsFor(SETUP_ABILITIES, plan.abilities),
      },
      {
        label: "Connections",
        value: verbose
          ? joinOrNone(plan.ifaces)
          : labelsFor(connectionItems(catalog.interfaces), plan.ifaces),
      },
      { label: "Workspace", value: plan.workspace },
    ];
  }
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Provider",
      value:
        plan.provider === undefined
          ? "None"
          : verbose
            ? plan.provider
            : providerDisplayName(plan.provider),
    },
    {
      label: "Model",
      value:
        plan.model === undefined
          ? "None"
          : verbose
            ? `${plan.model.provider} / ${plan.model.id}`
            : formatModelSummary(plan.model, providerDisplayName(plan.model.provider)),
    },
    {
      label: "Agents",
      value: verbose ? joinOrNone(plan.agents) : labelsFor(catalog.agents, plan.agents),
    },
  ];
  if (plan.defaultAgent !== undefined) {
    rows.push({
      label: "Default agent",
      value: verbose ? plan.defaultAgent : labelFor(catalog.agents, plan.defaultAgent),
    });
  }
  rows.push(
    {
      label: "Interfaces",
      value: verbose ? joinOrNone(plan.ifaces) : labelsFor(catalog.interfaces, plan.ifaces),
    },
    {
      label: "Policies",
      value: verbose ? joinOrNone(plan.policies) : labelsFor(catalog.policies, plan.policies),
    },
  );
  if (plan.skills.length > 0) {
    rows.push({
      label: "Skills",
      value: verbose ? joinOrNone(plan.skills) : labelsFor(catalog.skills, plan.skills),
    });
  }
  if (plan.tools.length > 0) {
    rows.push({
      label: "Tools",
      value: verbose ? joinOrNone(plan.tools) : labelsFor(catalog.tools, plan.tools),
    });
  }
  return rows;
}

function summaryLines(plan: SetupPlan, verbose: boolean, catalog: SetupCatalog): string[] {
  const lines: string[] = [];
  if (plan.ordinary) {
    lines.push(`Instructions: ${labelFor(catalog.agents, plan.defaultAgent ?? "assistant")}`);
  } else if (plan.agents.length > 0) {
    lines.push(verbose ? plan.agents.join(", ") : labelsFor(catalog.agents, plan.agents));
  }
  if (plan.model !== undefined) {
    const model = verbose
      ? `${plan.model.provider} / ${plan.model.id}`
      : formatModelSummary(plan.model, providerDisplayName(plan.model.provider));
    lines.push(plan.ordinary ? `Model: ${model}` : model);
  } else if (plan.provider !== undefined) {
    const provider = verbose ? plan.provider : providerDisplayName(plan.provider);
    lines.push(plan.ordinary ? `Model connection: ${provider}` : provider);
  }
  const extras = (plan.ordinary
    ? []
    : [
        plan.ifaces.length === 0
          ? undefined
          : verbose
            ? plan.ifaces.join(", ")
            : labelsFor(catalog.interfaces, plan.ifaces),
        plan.policies.length === 0
          ? undefined
          : verbose
            ? plan.policies.join(", ")
            : labelsFor(catalog.policies, plan.policies),
        ...(verbose ? [...plan.skills] : plan.skills.map((id) => labelFor(catalog.skills, id))),
        ...(verbose ? [...plan.tools] : plan.tools.map((id) => labelFor(catalog.tools, id))),
      ]).filter((item): item is string => item !== undefined && item !== "None");
  if (extras.length > 0) {
    lines.push(extras.join(" · "));
  }
  if (plan.ordinary) {
    lines.push(`Abilities: ${verbose ? joinOrNone(plan.abilities) : labelsFor(SETUP_ABILITIES, plan.abilities)}`);
    lines.push(`Connections: ${verbose ? joinOrNone(plan.ifaces) : labelsFor(connectionItems(catalog.interfaces), plan.ifaces)}`);
    lines.push(`Workspace: ${plan.workspace}`);
  }
  return lines;
}

function joinOrNone(ids: readonly string[]): string {
  return ids.length === 0 ? "None" : ids.join(", ");
}

function finishDoctor(target: string, flags: GlobalFlags, out: OutputBuffer): number {
  const registry = tryRegistry(flags.registry);
  const report = runDoctor({
    projectRoot: target,
    registry,
  });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function writeProjectSkeleton(
  target: string,
  created: string[],
  changed: string[],
): void {
  const name = path.basename(target);
  const slug = isModuleName(slugify(name)) ? slugify(name) : "app";
  const project = createDefaultProject({ slug, name });
  writeProjectDocument(target, project);
  created.push(".vibekit/project.yaml");
  writeInstalledManifest(target, emptyInstalledManifest());
  created.push(".vibekit/installed.json");
  fs.mkdirSync(path.join(target, ".vibekit/runtime"), { recursive: true });

  const gitignorePath = path.join(target, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    writeNewFile(gitignorePath, `# VibeKit\n${RUNTIME_GITIGNORE_RULE}\n`, created);
  } else {
    const existing = fs.readFileSync(gitignorePath, "utf8");
    if (
      !existing.split(/\r?\n/).includes(RUNTIME_GITIGNORE_RULE.replace(/\/$/, "")) &&
      !existing.includes(RUNTIME_GITIGNORE_RULE)
    ) {
      const prefix = existing.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(
        gitignorePath,
        `${existing}${prefix}\n# VibeKit\n${RUNTIME_GITIGNORE_RULE}\n`,
        "utf8",
      );
      changed.push(".gitignore");
    }
  }

}

function writeInterfaceConfig(target: string, iface: string): void {
  const filePath = path.join(target, ".vibekit/config/interfaces", `${iface}.yaml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const body = iface === "terminal" ? "mode: print\n" : "{}\n";
    fs.writeFileSync(filePath, body, "utf8");
  }
}

function writeNewFile(abs: string, contents: string, created: string[]): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
  created.push(toRelativeCreated(abs));
}

function toRelativeCreated(abs: string): string {
  const vibe = `${path.sep}.vibekit${path.sep}`;
  const git = `${path.sep}.gitignore`;
  if (abs.endsWith(git) || abs.endsWith("/.gitignore")) {
    return ".gitignore";
  }
  const vibeIndex = abs.lastIndexOf(vibe);
  if (vibeIndex !== -1) {
    return abs.slice(vibeIndex + 1).split(path.sep).join("/");
  }
  return path.basename(abs);
}

function uniqueExisting(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function tryRegistry(registryFlag?: string) {
  try {
    return resolveRegistry(registryFlag);
  } catch {
    return undefined;
  }
}
