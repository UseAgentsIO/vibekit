import { randomUUID } from "node:crypto";

import { formatRuntimeId, type RuntimeId, type RuntimeIdKind } from "../core/index.js";

export function newRuntimeId(kind: RuntimeIdKind): RuntimeId {
  return formatRuntimeId(kind, randomUUID());
}
