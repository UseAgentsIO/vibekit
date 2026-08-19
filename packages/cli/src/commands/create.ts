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
  resolveModule,
  runDoctor,
  VibeKitError,
  writeInstalledManifest,
  writeProjectDocument,
  type Registry,
} from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import { formatSelectedModel, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistrySelection, slugify } from "../paths.js";
import { canPrompt } from "../prompt.js";
import { ensureInstalledSecrets } from "../secrets.js";
import { resolveProjectAgents } from "../setup-agents.js";
import {
  SETUP_AGENTS,
  delegationContractsFromRegistry,
  deriveDelegation,
  inferDefaultAgent,
  setupItemsFromRegistry,
} from "../setup-catalog.js";
import { publishedRange } from "../published-deps.js";
import { printDoctor } from "./doctor.js";

const HEADQUARTERS_EXAMPLE = "headquarters";

export async function runCreate(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
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
  const fromFlags = flags.agents.length > 0 ? flags.agents : undefined;
  const skipAgentPrompt = flags.yes || !canPrompt();
  const defaultAgents = example === HEADQUARTERS_EXAMPLE ? ["chief", "personal"] : ["chief"];
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
  const agents = [...agentsResult.value.agents];
  const defaultAgent = agentsResult.value.defaultAgent ?? inferDefaultAgent(agents) ?? "chief";
  const iface = flags.interface ?? (example === HEADQUARTERS_EXAMPLE ? "telegram" : "terminal");
  const extraRoots =
    example === HEADQUARTERS_EXAMPLE
      ? [formatModuleId("policy", "interface-pairing"), formatModuleId("policy", "untrusted-inbound")]
      : [];

  fs.mkdirSync(target, { recursive: true });
  writePackageJson(target, iface, registry);
  ensureGitignore(target);

  let project = createDefaultProject({ slug, name, defaultAgent });
  project = {
    ...project,
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
  writeProjectDocument(target, project);
  writeInstalledManifest(target, emptyInstalledManifest());
  fs.mkdirSync(path.join(target, ".vibekit/runtime"), { recursive: true });
  writeInterfaceConfig(target, iface, example === HEADQUARTERS_EXAMPLE);

  const manifest = emptyInstalledManifest();
  const plan = planInstall({
    projectRoot: target,
    registry,
    roots: [
      ...agents.map((agent) => formatModuleId("agent", agent)),
      formatModuleId("provider", provider),
      formatModuleId("interface", iface),
      ...extraRoots,
    ],
    project,
    manifest,
    registrySource,
  });
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

  out.log(`Created VibeKit Project in ${target}`);
  if (agents.length === 1) {
    out.log(`Agent: ${agents[0]}`);
  } else {
    out.log(`Agents: ${agents.join(", ")}`);
    out.log(`Default agent: ${defaultAgent}`);
  }
  out.log(formatSelectedModel(selected));
  out.log(`Interface: ${iface}`);
  if (example !== undefined) {
    out.log(`Example: ${example}`);
  }
  await ensureInstalledSecrets({
    projectRoot: target,
    registry,
    yes: flags.yes,
    out,
  });
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

  const report = runDoctor({ projectRoot: target, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function writePackageJson(target: string, iface: string, registry: Registry): void {
  const filePath = path.join(target, "package.json");
  if (fs.existsSync(filePath)) {
    return;
  }
  const dependencies: Record<string, string> = {
    "@useagentsio/cli": publishedRange("@useagentsio/cli"),
    "@useagentsio/core": publishedRange("@useagentsio/core"),
    "@useagentsio/host": publishedRange("@useagentsio/host"),
    "@useagentsio/pi": publishedRange("@useagentsio/pi"),
    "@useagentsio/interface-sdk": publishedRange("@useagentsio/interface-sdk"),
  };
  const runtimePackage = interfaceRuntimePackage(registry, iface);
  if (runtimePackage !== undefined) {
    dependencies[runtimePackage] = publishedRange(runtimePackage);
  }
  const body = {
    name: path.basename(target),
    private: true,
    type: "module",
    dependencies,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function interfaceRuntimePackage(registry: Registry, iface: string): string | undefined {
  try {
    const loaded = resolveModule(registry, formatModuleId("interface", iface));
    if (loaded.document.type === "agent") {
      return undefined;
    }
    const pkg = loaded.document.runtime?.package;
    return pkg !== undefined && pkg.length > 0 ? pkg : undefined;
  } catch {
    return undefined;
  }
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
  if (value !== HEADQUARTERS_EXAMPLE) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "example_unknown",
      message: `Unknown example "${value}". Available: ${HEADQUARTERS_EXAMPLE}`,
    });
  }
  return value;
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




