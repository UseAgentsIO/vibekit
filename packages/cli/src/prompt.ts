import { isatty } from "node:tty";
import { stdin, stdout } from "node:process";

import { VibeKitError } from "./internal/core/index.js";

import { select, text } from "./ui/index.js";
import type { MenuOption } from "./ui/options.js";

export function canPrompt(): boolean {
  return isatty(stdin.fd);
}

export function say(message: string): void {
  stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

export async function askLine(question: string): Promise<string> {
  const result = await text({ message: question, collapse: "set" });
  if (result.status !== "submit") {
    throw new VibeKitError({
      category: "cancelled",
      code: "prompt_cancelled",
      message: "Cancelled",
    });
  }
  return result.value;
}

export interface Choice<T> {
  readonly label: string;
  readonly value: T;
  readonly id?: string;
}

export async function pickChoice<T>(
  title: string,
  choices: ReadonlyArray<Choice<T>>,
): Promise<T> {
  if (choices.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "no_choices",
      message: `Nothing to choose for ${title}`,
    });
  }
  if (choices.length === 1) {
    say(`${title}: ${choices[0].label}`);
    return choices[0].value;
  }
  const picked = await select({
    message: title,
    options: toMenuOptions(choices),
    searchable: true,
  });
  if (picked.status !== "submit" || picked.value === undefined) {
    throw new VibeKitError({
      category: "cancelled",
      code: "prompt_cancelled",
      message: "Cancelled",
    });
  }
  return picked.value;
}

export async function pickOrSkip<T>(
  title: string,
  choices: ReadonlyArray<Choice<T>>,
): Promise<T | undefined> {
  const picked = await select({
    message: title,
    options: toMenuOptions(choices),
    searchable: true,
    skippable: true,
  });
  if (picked.status !== "submit") {
    throw new VibeKitError({
      category: "cancelled",
      code: "prompt_cancelled",
      message: "Cancelled",
    });
  }
  return picked.value;
}

function toMenuOptions<T>(choices: ReadonlyArray<Choice<T>>): MenuOption<T>[] {
  return choices.map((choice) => ({
    label: choice.label,
    value: choice.value,
    id: choice.id,
  }));
}
