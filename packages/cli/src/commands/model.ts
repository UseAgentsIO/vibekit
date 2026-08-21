import { readProjectDocument, VibeKitError, writeProjectDocument } from "../internal/core/index.js";

import type { GlobalFlags } from "../args.js";
import { formatSelectedModel, selectProviderAndModel } from "../model-select.js";
import type { OutputBuffer } from "../output.js";
import { resolveProjectDir } from "../paths.js";
import { registerProject } from "../project-registry.js";

export async function runModel(
  positionals: readonly string[],
  flags: GlobalFlags,
  out: OutputBuffer,
): Promise<number> {
  const projectRoot = resolveProjectDir(flags.dir);
  registerProject(projectRoot);
  const project = readProjectDocument(projectRoot);
  const current = project.defaults?.model;
  if (current !== undefined) {
    out.log(`Current: ${current.provider} / ${current.id}`);
  }

  const parsed = parseModelPositional(positionals[0]);
  const selectedResult = await selectProviderAndModel({
    out,
    projectId: project.id,
    provider: flags.provider ?? parsed?.provider ?? current?.provider,
    model: flags.model ?? parsed?.id,
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

  writeProjectDocument(projectRoot, {
    ...project,
    defaults: {
      ...project.defaults,
      model: { provider: selected.provider, id: selected.id },
    },
  });
  out.log(formatSelectedModel(selected));
  out.log("Saved to .vibekit/project.yaml");
  return 0;
}

function parseModelPositional(
  value: string | undefined,
): { provider: string; id: string } | undefined {
  if (value === undefined || !value.includes("/")) {
    return undefined;
  }
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (provider.length === 0 || id.length === 0) {
    return undefined;
  }
  return { provider, id };
}
