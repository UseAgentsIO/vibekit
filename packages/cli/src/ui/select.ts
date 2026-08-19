import { VibeKitError } from "@useagentsio/core";

import { readKey, withRawInput } from "./keys.js";
import {
  defaultMenuLimit,
  filterOptions,
  windowItems,
  wrapIndex,
  type MenuOption,
} from "./options.js";
import {
  dim,
  footer,
  formatDone,
  LiveFrame,
  optionLines,
  printDone,
  printSkipped,
  requireTty,
} from "./render.js";
import { BACK, submit, type PromptResult } from "./result.js";
import { text } from "./text.js";

export type SearchMode = false | true | "type";

export interface SelectOptions<T> {
  readonly message: string;
  readonly description?: string;
  readonly options: ReadonlyArray<MenuOption<T>>;
  readonly searchable?: SearchMode;
  readonly skippable?: boolean;
  readonly noneLabel?: string;
  readonly initial?: number;
  readonly limit?: number;
  readonly hintBelow?: boolean;
  readonly manual?: boolean | { readonly parse?: (raw: string) => T | undefined };
}

const NONE = Symbol("none");

type LoopResult<T> =
  | { readonly kind: "value"; readonly value: T | undefined }
  | { readonly kind: "manual" }
  | { readonly kind: "back" };

export function searchModeOf(value: SearchMode | undefined): "none" | "slash" | "type" {
  if (value === false) {
    return "none";
  }
  if (value === "type") {
    return "type";
  }
  return "slash";
}

export async function select<T>(options: SelectOptions<T>): Promise<PromptResult<T | undefined>> {
  requireTty(options.message);
  if (options.options.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "no_choices",
      message: `Nothing to choose for ${options.message}`,
    });
  }

  for (;;) {
    const result = await runSelectLoop(options);
    if (result.kind === "back") {
      return BACK;
    }
    if (result.kind === "value") {
      return submit(result.value);
    }
    const raw = await text({ message: `${options.message} id` });
    if (raw.status !== "submit") {
      continue;
    }
    if (raw.value.length === 0) {
      continue;
    }
    const matched = options.options.find((option) => {
      const id = option.id ?? (typeof option.value === "string" ? option.value : "");
      return id === raw.value || option.label === raw.value;
    });
    if (matched !== undefined) {
      printDone(options.message, matched.label);
      return submit(matched.value);
    }
    const parsed = typeof options.manual === "object" ? options.manual.parse?.(raw.value) : undefined;
    if (parsed !== undefined) {
      printDone(options.message, raw.value);
      return submit(parsed);
    }
  }
}

async function runSelectLoop<T>(options: SelectOptions<T>): Promise<LoopResult<T>> {
  return withRawInput(async () => {
    const frame = new LiveFrame();
    frame.start();
    let cursor = Math.min(options.initial ?? 0, options.options.length - 1);
    let query = "";
    let searching = false;
    const mode = searchModeOf(options.searchable);
    const noneLabel = options.noneLabel ?? "None";

    const paint = (): Array<MenuOption<T> | { readonly value: typeof NONE; readonly label: string }> => {
      const visible = filterOptions(options.options, query);
      const rows: Array<MenuOption<T> | { readonly value: typeof NONE; readonly label: string }> =
        options.skippable === true ? [...visible, { value: NONE, label: noneLabel }] : [...visible];
      if (cursor >= rows.length) {
        cursor = Math.max(0, rows.length - 1);
      }
      const limit = options.limit ?? defaultMenuLimit(undefined, options.hintBelow === true ? 2 : 1);
      const page = windowItems(rows, cursor, limit);
      const filterHint = searching || (mode === "type" && query.length > 0) ? `  /${query}` : "";
      const lines = [`? ${options.message}${filterHint}`];
      if (options.description !== undefined && options.description.length > 0) {
        lines.push(`  ${dim(options.description)}`);
      }
      if (rows.length === 0) {
        lines.push("    No matches");
      } else {
        for (const [index, option] of page.items.entries()) {
          lines.push(
            ...optionLines({
              active: page.start + index === cursor,
              label: option.label,
              hint: "hint" in option ? option.hint : undefined,
              hintBelow: options.hintBelow,
            }),
          );
        }
      }
      lines.push(footer(selectFooter(options, mode, rows.length, page.start, page.items.length)));
      frame.render(lines);
      return rows;
    };

    try {
      for (;;) {
        const visible = paint();
        const key = await readKey();
        if (key.name === "ctrlc") {
          frame.abort();
          throw new VibeKitError({
            category: "cancelled",
            code: "prompt_cancelled",
            message: "Cancelled",
          });
        }
        if (key.name === "unknown") {
          continue;
        }
        if (key.name === "escape") {
          if (searching || query.length > 0) {
            searching = false;
            query = "";
            cursor = 0;
            continue;
          }
          frame.abort();
          return { kind: "back" };
        }
        if (key.name === "enter") {
          const chosen = visible[cursor];
          if (chosen === undefined) {
            continue;
          }
          if (chosen.value === NONE) {
            frame.finish(formatDone(options.message, noneLabel));
            return { kind: "value", value: undefined };
          }
          frame.finish(formatDone(options.message, chosen.label));
          return { kind: "value", value: chosen.value };
        }
        if (key.name === "up") {
          cursor = wrapIndex(cursor - 1, visible.length);
          continue;
        }
        if (key.name === "down") {
          cursor = wrapIndex(cursor + 1, visible.length);
          continue;
        }
        if (options.manual && !searching && key.name === "char" && key.sequence === "i") {
          frame.abort();
          return { kind: "manual" };
        }
        if (mode === "none") {
          continue;
        }
        if (mode === "slash" && key.name === "slash" && !searching) {
          searching = true;
          continue;
        }
        if ((searching || mode === "type") && key.name === "backspace") {
          query = query.slice(0, -1);
          cursor = 0;
          continue;
        }
        if ((searching || mode === "type") && (key.name === "char" || key.name === "slash" || key.name === "space")) {
          query += key.sequence;
          cursor = 0;
        }
      }
    } catch (error) {
      frame.abort();
      throw error;
    }
  });
}

function selectFooter<T>(
  options: SelectOptions<T>,
  mode: "none" | "slash" | "type",
  total: number,
  start: number,
  shown: number,
): string {
  const parts: string[] = ["↑/↓ navigate", "enter select"];
  if (mode === "type") {
    parts.push("type to filter");
  } else if (mode === "slash") {
    parts.push("/ search");
  }
  if (options.manual) {
    parts.push("i id");
  }
  parts.push("esc back");
  if (total > shown) {
    parts.push(`${start + 1}–${start + shown} of ${total}`);
  }
  return parts.join(" • ");
}

export function markDone(message: string, label: string, detail?: string): void {
  printDone(message, label, detail);
}

export function markSkipped(message: string): void {
  printSkipped(message);
}
