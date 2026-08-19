import { VibeKitError } from "@useagentsio/core";

import { canPrompt } from "../prompt.js";
import { multiselect } from "./multiselect.js";
import type { MenuOption } from "./options.js";
import { printDone, printSkipped } from "./render.js";
import { submit, type PromptResult } from "./result.js";
import { select, type SearchMode } from "./select.js";

export function isInteractive(): boolean {
  return canPrompt();
}

export async function resolveSelect<T>(input: {
  readonly message: string;
  readonly description?: string;
  readonly options: ReadonlyArray<MenuOption<T>>;
  readonly value?: T;
  readonly skippable?: boolean;
  readonly noneLabel?: string;
  readonly interactive?: boolean;
  readonly searchable?: SearchMode;
  readonly initial?: number;
  readonly hintBelow?: boolean;
  readonly manual?: boolean | { readonly parse?: (raw: string) => T | undefined };
  readonly equals?: (left: T, right: T) => boolean;
}): Promise<PromptResult<T | undefined>> {
  if (input.value !== undefined) {
    const match = input.options.find((option) =>
      input.equals === undefined ? option.value === input.value : input.equals(option.value, input.value as T),
    );
    printDone(input.message, match?.label ?? String(input.value));
    return submit(input.value);
  }
  const interactive = input.interactive ?? canPrompt();
  if (!interactive) {
    if (input.skippable === true) {
      printSkipped(input.message);
      return submit(undefined, 0);
    }
    throw new VibeKitError({
      category: "invalid_input",
      code: "prompt_requires_tty",
      message: `${input.message} needs a terminal, or pass a flag to skip the prompt`,
    });
  }
  return select({
    message: input.message,
    description: input.description,
    options: input.options,
    skippable: input.skippable,
    noneLabel: input.noneLabel,
    searchable: input.searchable,
    initial: input.initial,
    hintBelow: input.hintBelow,
    manual: input.manual,
  });
}

export async function resolveMultiSelect<T>(input: {
  readonly message: string;
  readonly description?: string;
  readonly options: ReadonlyArray<MenuOption<T>>;
  readonly values?: readonly T[];
  readonly interactive?: boolean;
  readonly searchable?: SearchMode;
  readonly initial?: readonly T[];
  readonly min?: number;
  readonly noneLabel?: string;
  readonly hintBelow?: boolean;
}): Promise<PromptResult<T[]>> {
  if (input.values !== undefined) {
    const chosen = input.options.filter((option) => input.values?.includes(option.value));
    const label =
      chosen.length === 0
        ? (input.noneLabel ?? "None")
        : chosen.map((option) => option.label).join(", ");
    printDone(input.message, label);
    return submit(chosen.map((option) => option.value));
  }
  const interactive = input.interactive ?? canPrompt();
  if (!interactive) {
    printSkipped(input.message);
    return submit([], 0);
  }
  return multiselect({
    message: input.message,
    description: input.description,
    options: input.options,
    searchable: input.searchable,
    initial: input.initial,
    min: input.min,
    noneLabel: input.noneLabel,
    hintBelow: input.hintBelow,
  });
}
