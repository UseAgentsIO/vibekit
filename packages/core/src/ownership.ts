import { VibeKitError } from "./errors.js";
import { assertFileTarget } from "./file-targets.js";
import type { ModuleId } from "./ids.js";
import type { InstalledManifestDocument, OwnershipMode } from "./types.js";

export interface PlannedFile {
  readonly moduleId: ModuleId;
  readonly sourceAbs: string;
  readonly targetRel: string;
  readonly ownership: OwnershipMode;
}

export interface OwnershipClaim {
  readonly path: string;
  readonly moduleId: ModuleId;
  readonly ownership: OwnershipMode;
}

export function collectInstalledOwnership(
  manifest: InstalledManifestDocument,
): Map<string, OwnershipClaim> {
  const claims = new Map<string, OwnershipClaim>();
  for (const module of manifest.modules) {
    for (const file of module.files) {
      claims.set(file.path, {
        path: file.path,
        moduleId: module.id,
        ownership: file.ownership,
      });
    }
  }
  return claims;
}

export function planFileOwnership(
  files: readonly PlannedFile[],
  manifest: InstalledManifestDocument,
): void {
  const existing = collectInstalledOwnership(manifest);
  const planned = new Map<string, PlannedFile>();

  for (const file of files) {
    assertFileTarget(file.targetRel);
    const previous = planned.get(file.targetRel);
    if (previous && previous.moduleId !== file.moduleId) {
      if (file.ownership === "exclusive" || previous.ownership === "exclusive") {
        throw new VibeKitError({
          category: "conflict",
          code: "duplicate_exclusive_ownership",
          message: `Modules ${previous.moduleId} and ${file.moduleId} both claim ${file.targetRel}`,
          details: {
            path: file.targetRel,
            owners: [previous.moduleId, file.moduleId],
          },
        });
      }
      throw new VibeKitError({
        category: "conflict",
        code: "duplicate_generated_target",
        message: `Modules ${previous.moduleId} and ${file.moduleId} both write generated file ${file.targetRel}`,
        details: {
          path: file.targetRel,
          owners: [previous.moduleId, file.moduleId],
        },
      });
    }
    planned.set(file.targetRel, file);

    const installed = existing.get(file.targetRel);
    if (!installed) {
      continue;
    }
    if (installed.moduleId === file.moduleId) {
      continue;
    }
    if (installed.ownership === "exclusive" || file.ownership === "exclusive") {
      throw new VibeKitError({
        category: "conflict",
        code: "duplicate_exclusive_ownership",
        message: `File ${file.targetRel} is already owned exclusively by ${installed.moduleId}`,
        details: {
          path: file.targetRel,
          owner: installed.moduleId,
          claimant: file.moduleId,
        },
      });
    }
  }
}
