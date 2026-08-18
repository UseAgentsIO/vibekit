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
import {
  SETUP_AGENTS,
  SETUP_INTERFACES,
  SETUP_POLICIES,
  SETUP_SKILLS,
  SETUP_TOOLS,
  asMenuOptions,
  labelFor,
  labelsFor,
} from "../setup-catalog.js";
import {
  BACK,
  CANCEL,
  confirm,
  printCompletion,
  printIntro,
  resolveMultiSelect,
  resolveSelect,
  runWizard,
  submit,
  symbols,
  writeln,
} from "../ui/index.js";
import { clearRenderedLines } from "../ui/theme.js";
import { printDoctor } from "./doctor.js";
import { installOfficialModule } from "./install-module.js";

interface SetupPlan {
  readonly provider?: string;
  readonly model?: SelectedModel;
  readonly agent?: string;
  readonly iface?: string;
  readonly skills: readonly string[];
  readonly policies: readonly string[];
  readonly tools: readonly string[];
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
    printIntro("Configure this project", "Choose components now — you can change them later.");
  }

  const plan = await collectSetup(target, flags, out, {
    interactive: canPrompt() && !flags.yes && !setupFlags,
    verbose: flags.verbose,
  });
  if (plan === undefined) {
    out.log(existed ? "Setup cancelled." : "Setup cancelled. Empty project kept.");
    return finishDoctor(target, flags, out);
  }

  const installed = applySetup(target, flags, plan);
  const files = uniqueExisting([...created, ...changed, ...installed]);
  printCompletion(out, {
    title: existed ? "Updated VibeKit project" : "Initialized VibeKit Project",
    lines: summaryLines(plan, flags.verbose),
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
      agent: flags.agent,
      iface: flags.interface,
      skills: flags.skills,
      policies: flags.policies,
      tools: flags.tools,
    };
  }

  const project = readProjectDocument(target);
  const empty: SetupPlan = {
    provider: flags.provider,
    model: undefined,
    agent: flags.agent,
    iface: flags.interface,
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
        });
        if (model.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, model: model.value });
      },
      async (state) => {
        const agent = await resolveSelect({
          message: "Agent",
          value: flags.agent,
          interactive: true,
          skippable: true,
          searchable: true,
          options: asMenuOptions(SETUP_AGENTS),
        });
        if (agent.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, agent: agent.value });
      },
      async (state) => {
        const iface = await resolveSelect({
          message: "Interface",
          value: flags.interface,
          interactive: true,
          skippable: true,
          searchable: false,
          options: asMenuOptions(SETUP_INTERFACES),
        });
        if (iface.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, iface: iface.value });
      },
      async (state) => {
        const skills = await resolveMultiSelect({
          message: "Skills",
          values: flags.skills.length > 0 ? flags.skills : undefined,
          interactive: true,
          options: asMenuOptions(SETUP_SKILLS),
        });
        if (skills.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, skills: skills.value });
      },
      async (state) => {
        const policies = await resolveMultiSelect({
          message: "Policies",
          values: flags.policies.length > 0 ? flags.policies : undefined,
          interactive: true,
          noneLabel: "None",
          options: asMenuOptions(SETUP_POLICIES),
        });
        if (policies.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, policies: policies.value });
      },
      async (state) => {
        const tools = await resolveMultiSelect({
          message: "Tools",
          values: flags.tools.length > 0 ? flags.tools : undefined,
          interactive: true,
          options: asMenuOptions(SETUP_TOOLS),
        });
        if (tools.status !== "submit") {
          return BACK;
        }
        return submit({ ...state, tools: tools.value });
      },
      async (state) => {
        const rows = reviewRows(state, input.verbose);
        writeln("");
        writeln(`${symbols.open}  Ready to create?`);
        for (const row of rows) {
          writeln(`   ${row.label.padEnd(12)}${row.value}`);
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
      ...installOfficialModule({
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

  if (plan.agent !== undefined) {
    created.push(
      ...installOfficialModule({
        projectRoot: target,
        type: "agent",
        name: plan.agent,
        registry: flags.registry,
      }).created,
    );
    writeProjectDocument(target, {
      ...readProjectDocument(target),
      defaultAgent: plan.agent,
    });
  }

  if (plan.iface !== undefined) {
    created.push(
      ...installOfficialModule({
        projectRoot: target,
        type: "interface",
        name: plan.iface,
        registry: flags.registry,
      }).created,
    );
    const current = readProjectDocument(target);
    const defaultAgent = current.defaultAgent ?? plan.agent ?? "chief";
    writeInterfaceConfig(target, plan.iface);
    writeProjectDocument(target, {
      ...current,
      interfaceBindings: {
        ...current.interfaceBindings,
        [`${plan.iface}-main`]: {
          definition: `interface:${plan.iface}`,
          enabled: true,
          defaultAgent,
          config: `.vibekit/config/interfaces/${plan.iface}-main.yaml`,
        },
      },
    });
  }

  for (const skill of plan.skills) {
    created.push(
      ...installOfficialModule({
        projectRoot: target,
        type: "skill",
        name: skill,
        registry: flags.registry,
      }).created,
    );
  }
  for (const policy of plan.policies) {
    created.push(
      ...installOfficialModule({
        projectRoot: target,
        type: "policy",
        name: policy,
        registry: flags.registry,
      }).created,
    );
  }
  for (const tool of plan.tools) {
    created.push(
      ...installOfficialModule({
        projectRoot: target,
        type: "tool",
        name: tool,
        registry: flags.registry,
      }).created,
    );
  }
  return created;
}

function reviewRows(
  plan: SetupPlan,
  verbose: boolean,
): Array<{ label: string; value: string }> {
  return [
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
    { label: "Agent", value: verbose ? plan.agent ?? "None" : labelFor(SETUP_AGENTS, plan.agent) },
    {
      label: "Interface",
      value: verbose ? plan.iface ?? "None" : labelFor(SETUP_INTERFACES, plan.iface),
    },
    {
      label: "Skills",
      value: verbose ? joinOrNone(plan.skills) : labelsFor(SETUP_SKILLS, plan.skills),
    },
    {
      label: "Policies",
      value: verbose ? joinOrNone(plan.policies) : labelsFor(SETUP_POLICIES, plan.policies),
    },
    { label: "Tools", value: verbose ? joinOrNone(plan.tools) : labelsFor(SETUP_TOOLS, plan.tools) },
  ];
}

function summaryLines(plan: SetupPlan, verbose: boolean): string[] {
  const lines: string[] = [];
  if (plan.agent !== undefined) {
    lines.push(verbose ? plan.agent : labelFor(SETUP_AGENTS, plan.agent));
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
    plan.iface === undefined ? undefined : verbose ? plan.iface : labelFor(SETUP_INTERFACES, plan.iface),
    ...(verbose ? [...plan.skills] : plan.skills.map((id) => labelFor(SETUP_SKILLS, id))),
    ...(verbose ? [...plan.tools] : plan.tools.map((id) => labelFor(SETUP_TOOLS, id))),
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
  const filePath = path.join(target, ".vibekit/config/interfaces", `${iface}-main.yaml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `schemaVersion: 1\nenabled: true\nmode: local\n`, "utf8");
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
    deps["@useagentsio/core"] = "workspace:*";
    mutated = true;
  }
  if (!deps["@useagentsio/pi"] && !raw.devDependencies?.["@useagentsio/pi"]) {
    deps["@useagentsio/pi"] = "workspace:*";
    mutated = true;
  }
  if (!mutated) {
    return;
  }
  raw.dependencies = deps;
  fs.writeFileSync(packagePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  changed.push("package.json");
}
