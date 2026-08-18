import { VibeKitError } from "@useagentsio/core";

export function hostError(
  category: ConstructorParameters<typeof VibeKitError>[0]["category"],
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): VibeKitError {
  return new VibeKitError({ category, code, message, details });
}
