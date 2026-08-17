import type { ProjectTracking } from "../types.js";

export const STATE_BACKEND_ID = "state:repository" as const;

export const DEFAULT_STATE_RELATIVE_PATH = ".vibekit/state";
export const DEFAULT_RUNTIME_RELATIVE_PATH = ".vibekit/runtime";

export const DEFAULT_LOCK_LEASE_MS = 30_000;
export const DEFAULT_CLAIM_LEASE_MS = 300_000;

export const DEFAULT_STATE_TRACKING: ProjectTracking = {
  decisions: "git",
  tasks: "local",
  results: "local",
  approvals: "local",
  verifications: "local",
  events: "local",
  runtime: "ephemeral",
};

export const TEMP_FILE_MARKER = ".tmp";
