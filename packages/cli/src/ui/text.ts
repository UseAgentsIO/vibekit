import { VibeKitError } from "../internal/core/index.js";

import { readKey, withRawInput } from "./keys.js";
import { printDone, requireTty } from "./render.js";
import { BACK, submit, type PromptResult } from "./result.js";
import { ansi, clearRenderedLines, write, writeln } from "./theme.js";

export async function text(input: {
  readonly message: string;
  readonly secret?: boolean;
  readonly collapse?: string;
}): Promise<PromptResult<string>> {
  requireTty(input.message);
  writeln(`? ${input.message}`);
  write("> ");
  return withRawInput(async () => {
    let value = "";
    for (;;) {
      const key = await readKey();
      if (key.name === "ctrlc") {
        write("\n");
        throw new VibeKitError({
          category: "cancelled",
          code: "prompt_cancelled",
          message: "Cancelled",
        });
      }
      if (key.name === "escape") {
        write("\n");
        clearRenderedLines(2);
        return BACK;
      }
      if (key.name === "enter") {
        write("\n");
        clearRenderedLines(2);
        printDone(input.message, collapseLabel(input, value));
        return submit(value);
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        write(`${ansi.column}${ansi.clearLine}> ${mask(value, input.secret)}`);
        continue;
      }
      if (key.name === "char" && key.sequence.length > 0) {
        value += key.sequence;
        write(input.secret === true ? "•" : key.sequence);
      }
    }
  });
}

function mask(value: string, secret?: boolean): string {
  return secret === true ? "•".repeat(value.length) : value;
}

function collapseLabel(
  input: { readonly collapse?: string; readonly secret?: boolean },
  value: string,
): string {
  if (value.length === 0) {
    return "None";
  }
  if (input.collapse !== undefined) {
    return input.collapse;
  }
  return input.secret === true ? "saved" : "set";
}
