import { VibeKitError, type FailureCategory } from "@useagentsio/core";

export function fail(
  category: FailureCategory,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): VibeKitError {
  return new VibeKitError({ category, code, message, details });
}

export function configurationInvalid(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): VibeKitError {
  return fail("configuration_invalid", code, message, details);
}
