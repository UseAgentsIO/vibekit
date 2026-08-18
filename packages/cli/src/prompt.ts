import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { isatty } from "node:tty";

import { VibeKitError } from "@useagentsio/core";

export function canPrompt(): boolean {
  return isatty(stdin.fd);
}

export function say(message: string): void {
  stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

export async function askLine(question: string): Promise<string> {
  if (!canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "prompt_requires_tty",
      message: "This command needs a terminal, or pass --provider and --model",
    });
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(`${question}\n> `)).trim();
  } finally {
    rl.close();
  }
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

  for (;;) {
    say("");
    say(title);
    choices.forEach((choice, index) => {
      say(`  ${index + 1}. ${choice.label}`);
    });
    const raw = await askLine("Number, or paste an id");
    if (raw.length === 0) {
      say("Pick a number from the list.");
      continue;
    }
    const asNumber = Number(raw);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
      return choices[asNumber - 1].value;
    }
    const matched = choices.find((choice) => {
      const id = choice.id ?? (typeof choice.value === "string" ? choice.value : undefined);
      return choice.label === raw || id === raw;
    });
    if (matched !== undefined) {
      return matched.value;
    }
    say(`Not a valid choice: ${raw}`);
  }
}
