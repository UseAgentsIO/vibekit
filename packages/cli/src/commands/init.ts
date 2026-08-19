import fs from "node:fs";
import path from "node:path";

import {
  RUNTIME_GITIGNORE_RULE,
  VibeKitError,
  createDefaultProject,
  emptyInstalledManifest,
  isModuleName,
  readProjectDocument,
  runDoctor,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";

import { publishedRange } from "../published-deps.js";

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
  isWorkspaceRoot,
  resolveProjectDir,
  resolveRegistry,
  slugify,
} from "../paths.js";
import { canPrompt } from "../prompt.js";
import { resolveProjectAgents } from "../setup-agents.js";
import {
  SETUP_AGENTS,
  SETUP_INTERFACES,
  SETUP_POLICIES,
  SETUP_SKILLS,
  SETUP_TOOLS,
  asMenuOptions,
  delegationContractsFromRegistry,
  deriveDelegation,
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
  writeln,
} from "../ui/index.js";
import { clearRenderedLines } from "../ui/theme.js";
import { printDoctor } from "./doctor.js";
import { installRegistryModule } from "./install-module.js";

interface SetupPlan {
  readonly provider?: string;
  readonly model?: SelectedModel;
  readonly agents: readonly string[];
  readonly defaultAgent?: string;
  readonly ifaces: readonly string[];
  readonly skills: readonly string[];
  readonly policies: readonly string[];
  readonly tools: readonly string[];
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

  fs.mkdirSync(target, { recursive: true });

  const existed = fs.existsSync(path.join(target, ".vibekit/project.yaml"));
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
    printIntro("Configure this project", "Choose your project's agents and runtime.");
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
    return {
      provider: flags.provider,
      model:
        flags.provider !== undefined && flags.model !== undefined
          ? { provider: flags.provider, id: flags.model, name: flags.model }
          : undefined,
      agents: normalizeAgentIds(flags.agents),
      defaultAgent: inferDefaultAgent(flags.agents),
      ifaces: flags.interface === undefined ? [] : [flags.interface],
      skills: flags.skills,
      policies: flags.policies,
      tools: flags.tools,
    };
  }

  const registry = tryRegistry(flags.registry);
  const catalog = setupCatalog(registry);
  const project = readProjectDocument(target);
  const empty: SetupPlan = {
    provider: flags.provider,
    model: undefined,
    agents: normalizeAgentIds(flags.agents),
    defaultAgent: inferDefaultAgent(flags.agents),
    ifaces: flags.interface === undefined ? [] : [flags.interface],
    skills: flags.skills,
    policies: flags.policies,
    tools: flags.tools,
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
        const selected = await resolveProjectAgents({
          values: flags.agents.length > 0 ? flags.agents : undefined,
          required: false,
          interactive: true,
          items: catalog.agents,
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit(
          {
            ...state,
            agents: selected.value.agents,
            defaultAgent: selected.value.defaultAgent,
          },
          selected.lines ?? 1,
        );
      },
      async (state) => {
        const selected = await resolveMultiSelect({
          message: "Interfaces",
          description: "How people and systems send messages into this project.",
          values: flags.interface === undefined ? undefined : [flags.interface],
          interactive: true,
          noneLabel: "None",
          hintBelow: true,
          options: asMenuOptions(catalog.interfaces),
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, ifaces: selected.value });
      },
      async (state) => {
        const selected = await resolveMultiSelect({
          message: "Policies",
          description: "Project-wide safety and governance rules.",
          values: flags.policies.length > 0 ? flags.policies : undefined,
          interactive: true,
          noneLabel: "None",
          hintBelow: true,
          options: asMenuOptions(catalog.policies),
        });
        if (selected.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, policies: selected.value });
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
  const created: string[] = [];
  if (plan.provider !== undefined) {
    created.push(
      ...installRegistryModule({
        projectRoot: target,
        type: "provider",
        name: plan.provider,
        registry: flags.registry,
      }).created,
    );
    if (plan.model !== undefined) {
      const current = readProjectDocument(target);
      writeProjectDocument(target, {
        ...current,
        defaults: {
          ...current.defaults,
          model: { provider: plan.model.provider, id: plan.model.id },
        },
      });
    }
  }

  if (plan.agents.length > 0) {
    for (const agent of plan.agents) {
      created.push(
        ...installRegistryModule({
          projectRoot: target,
          type: "agent",
          name: agent,
          registry: flags.registry,
        }).created,
      );
    }
    const current = readProjectDocument(target);
    writeProjectDocument(target, {
      ...current,
      defaultAgent: plan.defaultAgent,
      delegation: {
        ...current.delegation,
        ...deriveDelegation(
          plan.agents,
          (() => {
            const registry = tryRegistry(flags.registry);
            return registry === undefined
              ? undefined
              : delegationContractsFromRegistry(registry, plan.agents);
          })(),
        ),
      },
    });
  }

  for (const iface of plan.ifaces) {
    created.push(
      ...installRegistryModule({
        projectRoot: target,
        type: "interface",
        name: iface,
        registry: flags.registry,
      }).created,
    );
    const current = readProjectDocument(target);
    const defaultAgent = current.defaultAgent ?? plan.defaultAgent ?? "chief";
    writeInterfaceConfig(target, iface);
    writeProjectDocument(target, {
      ...current,
      interfaceBindings: {
        ...current.interfaceBindings,
        [`${iface}-main`]: {
          definition: `interface:${iface}`,
          enabled: true,
          defaultAgent,
          config: `.vibekit/config/interfaces/${iface}.yaml`,
        },
      },
    });
  }

  for (const skill of plan.skills) {
    created.push(
      ...installRegistryModule({
        projectRoot: target,
        type: "skill",
        name: skill,
        registry: flags.registry,
      }).created,
    );
  }
  for (const policy of plan.policies) {
    created.push(
      ...installRegistryModule({
        projectRoot: target,
        type: "policy",
        name: policy,
        registry: flags.registry,
      }).created,
    );
  }
  for (const tool of plan.tools) {
    created.push(
      ...installRegistryModule({
        projectRoot: target,
        type: "tool",
        name: tool,
        registry: flags.registry,
      }).created,
    );
  }
  return created;
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
  if (plan.agents.length > 0) {
    lines.push(verbose ? plan.agents.join(", ") : labelsFor(catalog.agents, plan.agents));
  }
  if (plan.model !== undefined) {
    lines.push(
      verbose
        ? `${plan.model.provider} / ${plan.model.id}`
        : formatModelSummary(plan.model, providerDisplayName(plan.model.provider)),
    );
  } else if (plan.provider !== undefined) {
    lines.push(verbose ? plan.provider : providerDisplayName(plan.provider));
  }
  const extras = [
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
  ].filter((item): item is string => item !== undefined && item !== "None");
  if (extras.length > 0) {
    lines.push(extras.join(" · "));
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

  if (isWorkspaceRoot(target)) {
    recordWorkspaceDependencies(target, changed);
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

function recordWorkspaceDependencies(target: string, changed: string[]): void {
  const packagePath = path.join(target, "package.json");
  if (!fs.existsSync(packagePath)) {
    return;
  }
  const raw = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = raw.dependencies ?? {};
  let mutated = false;
  if (!deps["@useagentsio/core"] && !raw.devDependencies?.["@useagentsio/core"]) {
    deps["@useagentsio/core"] = publishedRange("@useagentsio/core");
    mutated = true;
  }
  if (!deps["@useagentsio/pi"] && !raw.devDependencies?.["@useagentsio/pi"]) {
    deps["@useagentsio/pi"] = publishedRange("@useagentsio/pi");
    mutated = true;
  }
  if (!mutated) {
    return;
  }
  raw.dependencies = deps;
  fs.writeFileSync(packagePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  changed.push("package.json");
}
