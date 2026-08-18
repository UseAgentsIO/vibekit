import { VibeKitError } from "@useagentsio/core";

import { readKey, withRawInput } from "./keys.js";
import {
  defaultMenuLimit,
  filterOptions,
  windowItems,
  wrapIndex,
  type MenuOption,
} from "./options.js";
import { footer, formatDone, LiveFrame, optionLine, requireTty, symbols } from "./render.js";
import { BACK, submit, type PromptResult } from "./result.js";
import { searchModeOf, type SearchMode } from "./select.js";

export interface MultiSelectOptions<T> {
  readonly message: string;
  readonly options: ReadonlyArray<MenuOption<T>>;
  readonly searchable?: SearchMode;
  readonly initial?: readonly T[];
  readonly limit?: number;
  readonly noneLabel?: string;
}

export async function multiselect<T>(options: MultiSelectOptions<T>): Promise<PromptResult<T[]>> {
  requireTty(options.message);
  if (options.options.length === 0) {
    throw new VibeKitError({
      category: "unavailable",
      code: "no_choices",
      message: `Nothing to choose for ${options.message}`,
    });
  }

  return withRawInput(async () => {
    const frame = new LiveFrame();
    frame.start();
    const selected = new Set<T>(options.initial ?? []);
    let cursor = 0;
    let query = "";
    let searching = false;
    const mode = searchModeOf(options.searchable);
    const noneLabel = options.noneLabel ?? "None";

    const paint = (): MenuOption<T>[] => {
      const visible = filterOptions(options.options, query);
      if (cursor >= visible.length) {
        cursor = Math.max(0, visible.length - 1);
      }
      const limit = options.limit ?? defaultMenuLimit();
      const page = windowItems(visible, cursor, limit);
      const filterHint = searching || (mode === "type" && query.length > 0) ? `  /${query}` : "";
      const lines = [`? ${options.message}${filterHint}`];
      if (visible.length === 0) {
        lines.push("    No matches");
      } else {
        for (const [index, option] of page.items.entries()) {
          lines.push(
            optionLine({
              active: page.start + index === cursor,
              label: option.label,
              hint: option.hint,
              mark: selected.has(option.value) ? symbols.radioOn : symbols.radioOff,
            }),
          );
        }
      }
      const parts = ["space toggle", "enter continue"];
      if (mode === "type") {
        parts.push("type to filter");
      } else if (mode === "slash") {
        parts.push("/ search");
      }
      parts.push("esc back");
      if (visible.length > page.items.length) {
        parts.push(`${page.start + 1}–${page.start + page.items.length} of ${visible.length}`);
      }
      lines.push(footer(parts.join(" • ")));
      frame.render(lines);
      return visible;
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
          return BACK;
        }
        if (key.name === "enter") {
          const chosen = options.options.filter((option) => selected.has(option.value));
          const label =
            chosen.length === 0 ? noneLabel : chosen.map((option) => option.label).join(", ");
          frame.finish(formatDone(options.message, label));
          return submit(chosen.map((option) => option.value));
        }
        if (key.name === "space") {
          const current = visible[cursor];
          if (current === undefined) {
            continue;
          }
          if (selected.has(current.value)) {
            selected.delete(current.value);
          } else {
            selected.add(current.value);
          }
          continue;
        }
        if (key.name === "up") {
          cursor = wrapIndex(cursor - 1, visible.length);
          continue;
        }
        if (key.name === "down") {
          cursor = wrapIndex(cursor + 1, visible.length);
          continue;
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
        if ((searching || mode === "type") && (key.name === "char" || key.name === "slash")) {
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
