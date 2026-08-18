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

import type { GlobalFlags } from "../args.js";
import { formatSelectedModel, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import {
  detectPackageManager,
  isWorkspaceRoot,
  resolveProjectDir,
  resolveRegistry,
  slugify,
} from "../paths.js";
import { canPrompt, pickOrSkip, say } from "../prompt.js";
import { printDoctor } from "./doctor.js";
import { installOfficialModule } from "./install-module.js";

const SETUP_AGENTS = [
  { id: "chief", label: "Chief (chief)" },
  { id: "coder", label: "Coder (coder)" },
  { id: "reviewer", label: "Reviewer (reviewer)" },
  { id: "researcher", label: "Researcher (researcher)" },
  { id: "project-manager", label: "Project Manager (project-manager)" },
] as const;

const SETUP_INTERFACES = [{ id: "terminal", label: "Terminal (terminal)" }] as const;

const SETUP_SKILLS = [
  { id: "software-development", label: "Software development (software-development)" },
  { id: "research", label: "Research (research)" },
] as const;

const SETUP_POLICIES = [
  { id: "least-privilege", label: "Least privilege (least-privilege)" },
  { id: "require-verification", label: "Require verification (require-verification)" },
] as const;

const SETUP_TOOLS = [
  { id: "filesystem", label: "Filesystem (filesystem)" },
  { id: "execution", label: "Execution (execution)" },
] as const;

export async function runInit(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const target = resolveProjectDir(positionals[0] ?? flags.dir);
  const created: string[] = [];
  const changed: string[] = [];
  const skipSetup = flags.defaults || flags.yes || !canPrompt();

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

  const packageManager = detectPackageManager(target);
  out.log(`Initialized VibeKit Project in ${target}`);
  out.log(`Package manager: ${packageManager ?? "none detected"}`);

  const createdUnique = uniqueExisting(created);
  const changedUnique = uniqueExisting(changed);
  if (createdUnique.length > 0) {
    out.log("Created:");
    for (const file of createdUnique) {
      out.log(`  ${file}`);
    }
  }
  if (changedUnique.length > 0) {
    out.log("Changed:");
    for (const file of changedUnique) {
      out.log(`  ${file}`);
    }
  }

  if (!skipSetup) {
    await runSetupWizard(target, flags, out);
  } else {
    out.log("Skipped setup. Use `vibekit add` or run `vibekit init` without --defaults.");
  }

  const registry = tryRegistry(flags.registry);
  const report = runDoctor({
    projectRoot: target,
    registry,
  });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

async function runSetupWizard(
  target: string,
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<void> {
  say("");
  say("Configure your VibeKit Project. Skip any step.");

  const project = readProjectDocument(target);
  const provider = await pickOrSkip(
    "Which provider would you like to use?",
    [
      { id: "openai", label: "OpenAI (openai)" },
      { id: "openrouter", label: "OpenRouter (openrouter)" },
      { id: "xai", label: "xAI (xai)" },
      { id: "openai-codex", label: "OpenAI Codex (openai-codex)" },
      { id: "opencode-go", label: "OpenCode Go (opencode-go)" },
    ].map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (provider !== undefined) {
    const selected = await selectProviderAndModel({
      out,
      projectId: project.id,
      provider,
      yes: false,
    });
    installOfficialModule({
      projectRoot: target,
      type: "provider",
      name: provider,
      registry: flags.registry,
      out,
    });
    writeProjectDocument(target, {
      ...readProjectDocument(target),
      defaults: {
        ...readProjectDocument(target).defaults,
        model: { provider: selected.provider, id: selected.id },
      },
    });
    say(formatSelectedModel(selected));
  }

  const agent = await pickOrSkip(
    "Which Agent would you like to add?",
    SETUP_AGENTS.map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (agent !== undefined) {
    installOfficialModule({
      projectRoot: target,
      type: "agent",
      name: agent,
      registry: flags.registry,
      out,
    });
    writeProjectDocument(target, {
      ...readProjectDocument(target),
      defaultAgent: agent,
    });
  }

  const iface = await pickOrSkip(
    "Which Interface would you like to add?",
    SETUP_INTERFACES.map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (iface !== undefined) {
    installOfficialModule({
      projectRoot: target,
      type: "interface",
      name: iface,
      registry: flags.registry,
      out,
    });
    const current = readProjectDocument(target);
    const defaultAgent = current.defaultAgent ?? agent ?? "chief";
    writeInterfaceConfig(target, iface);
    writeProjectDocument(target, {
      ...current,
      interfaceBindings: {
        ...current.interfaceBindings,
        [`${iface}-main`]: {
          definition: `interface:${iface}`,
          enabled: true,
          defaultAgent,
          config: `.vibekit/config/interfaces/${iface}-main.yaml`,
        },
      },
    });
  }

  const skill = await pickOrSkip(
    "Which Skill would you like to add?",
    SETUP_SKILLS.map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (skill !== undefined) {
    installOfficialModule({
      projectRoot: target,
      type: "skill",
      name: skill,
      registry: flags.registry,
      out,
    });
  }

  const policy = await pickOrSkip(
    "Which Policy would you like to add?",
    SETUP_POLICIES.map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (policy !== undefined) {
    installOfficialModule({
      projectRoot: target,
      type: "policy",
      name: policy,
      registry: flags.registry,
      out,
    });
  }

  const tool = await pickOrSkip(
    "Which Tool would you like to add?",
    SETUP_TOOLS.map((entry) => ({ label: entry.label, value: entry.id, id: entry.id })),
  );
  if (tool !== undefined) {
    installOfficialModule({
      projectRoot: target,
      type: "tool",
      name: tool,
      registry: flags.registry,
      out,
    });
  }

  say("");
  say("Setup complete. Message your Agent with `vibekit msg \"Hello\"`.");
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
