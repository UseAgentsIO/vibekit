export type PromptResult<T> =
  | { readonly status: "submit"; readonly value: T; readonly lines?: number }
  | { readonly status: "back" }
  | { readonly status: "cancel" };

export function submit<T>(value: T, lines = 1): PromptResult<T> {
  return { status: "submit", value, lines };
}

export const BACK = { status: "back" } as const satisfies PromptResult<never>;

export const CANCEL = { status: "cancel" } as const satisfies PromptResult<never>;

export function isBack<T>(result: PromptResult<T>): result is { readonly status: "back" } {
  return result.status === "back";
}

export function isCancel<T>(result: PromptResult<T>): result is { readonly status: "cancel" } {
  return result.status === "cancel";
}

export function isSubmit<T>(
  result: PromptResult<T>,
): result is { readonly status: "submit"; readonly value: T; readonly lines?: number } {
  return result.status === "submit";
}

export function unwrapOrThrow<T>(result: PromptResult<T>, message = "Cancelled"): T {
  if (result.status === "submit") {
    return result.value;
  }
  const error = new Error(message);
  error.name = result.status === "back" ? "PromptBack" : "PromptCancelled";
  throw error;
}
