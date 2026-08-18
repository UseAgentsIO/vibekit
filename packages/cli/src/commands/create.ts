import fs from "node:fs";
import path from "node:path";

import {
  applyInstall,
  createDefaultProject,
  emptyInstalledManifest,
  isModuleName,
  planInstall,
  readProjectDocument,
  runDoctor,
  VibeKitError,
  writeInstalledManifest,
  writeProjectDocument,
} from "@useagentsio/core";

import type { GlobalFlags } from "../args.js";
import { formatSelectedModel, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir, resolveRegistry, slugify } from "../paths.js";
import { printDoctor } from "./doctor.js";

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
  const agentName = flags.agent ?? "chief";
  const selectedResult = await selectProviderAndModel({
    out,
    projectId: `project:${slug}`,
    provider: flags.provider,
    model: flags.model,
    yes: flags.yes,
    verbose: flags.verbose,
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
  const iface = flags.interface ?? "terminal";

  fs.mkdirSync(target, { recursive: true });
  writePackageJson(target);
  ensureGitignore(target);

  let project = createDefaultProject({ slug, name, defaultAgent: agentName });
  project = {
    ...project,
    defaults: { model: { provider, id: model } },
    interfaceBindings: {
      [`${iface}-main`]: {
        definition: `interface:${iface}`,
        enabled: true,
        defaultAgent: agentName,
        config: `.vibekit/config/interfaces/${iface}-main.yaml`,
      },
    },
  };
  writeProjectDocument(target, project);
  writeInstalledManifest(target, emptyInstalledManifest());
  fs.mkdirSync(path.join(target, ".vibekit/runtime"), { recursive: true });
  writeInterfaceConfig(target, iface);

  const registry = resolveRegistry(flags.registry);
  const manifest = emptyInstalledManifest();
  const plan = planInstall({
    projectRoot: target,
    registry,
    roots: [`agent:${agentName}`],
    project,
    manifest,
    registrySource: "official",
  });
  applyInstall({ projectRoot: target, plan });

  const updated = readProjectDocument(target);
  writeProjectDocument(target, {
    ...updated,
    defaultAgent: agentName,
    defaults: { model: { provider, id: model } },
    interfaceBindings: project.interfaceBindings,
  });

  out.log(`Created VibeKit Project in ${target}`);
  out.log(`Agent: ${agentName}`);
  out.log(formatSelectedModel(selected));
  out.log(`Interface: ${iface}`);
  out.log("");
  out.log("Next:");
  out.log(`  cd ${target}`);
  out.log(`  vibekit msg "Hello"`);
  out.log(`  vibekit model`);

  const report = runDoctor({ projectRoot: target, registry });
  printDoctor(report, out);
  return report.errorCount === 0 ? 0 : 1;
}

function writePackageJson(target: string): void {
  const filePath = path.join(target, "package.json");
  if (fs.existsSync(filePath)) {
    return;
  }
  const body = {
    name: path.basename(target),
    private: true,
    type: "module",
    dependencies: {
      "@useagentsio/core": "workspace:*",
      "@useagentsio/host": "workspace:*",
      "@useagentsio/pi": "workspace:*",
      "@useagentsio/interface-sdk": "workspace:*",
      "@useagentsio/interface-terminal": "workspace:*",
    },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
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

function writeInterfaceConfig(target: string, iface: string): void {
  const filePath = path.join(target, ".vibekit/config/interfaces", `${iface}-main.yaml`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `schemaVersion: 1\nenabled: true\nmode: local\n`,
    "utf8",
  );
}




