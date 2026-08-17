import { VibeKitError } from "../errors.js";
import type { FailureCategory } from "../errors.js";

export function stateError(
  category: FailureCategory,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new VibeKitError({ category, code, message, details });
}
