import { randomUUID } from "node:crypto";

import { formatRuntimeId, type RuntimeId, type RuntimeIdKind } from "@vibekit/core";

export function newRuntimeId(kind: RuntimeIdKind): RuntimeId {
  return formatRuntimeId(kind, randomUUID());
}
