import { VibeKitError } from "../internal/core/index.js";

import { canPrompt } from "../prompt.js";
import { ansi, clearRenderedLines, cyan, dim, green, symbols, write, writeln } from "./theme.js";

export function requireTty(action: string): void {
  if (!canPrompt()) {
    throw new VibeKitError({
      category: "invalid_input",
      code: "prompt_requires_tty",
      message: `${action} needs a terminal, or pass flags to skip the wizard`,
    });
  }
}

const LABEL_WIDTH = 12;

export function formatDone(label: string, value: string): string {
  return `${green(symbols.check)} ${label.padEnd(LABEL_WIDTH)} ${value}`;
}

export function formatSkipped(label: string): string {
  return `${dim(symbols.check)} ${label.padEnd(LABEL_WIDTH)} ${dim("None")}`;
}

export function printDone(label: string, value: string, detail?: string): void {
  if (!canPrompt()) {
    return;
  }
  writeln(formatDone(label, value));
  if (detail !== undefined && detail.length > 0) {
    writeln(`${"".padEnd(LABEL_WIDTH + 2)}${dim(detail)}`);
  }
}

export function printSkipped(label: string): void {
  if (!canPrompt()) {
    return;
  }
  writeln(formatSkipped(label));
}

export class LiveFrame {
  private lineCount = 0;

  start(): void {
    write(ansi.hideCursor);
  }

  render(lines: readonly string[]): void {
    clearRenderedLines(this.lineCount);
    const body = lines.join("\n");
    writeln(body);
    this.lineCount = lines.length;
  }

  finish(finalLine?: string): void {
    clearRenderedLines(this.lineCount);
    this.lineCount = 0;
    write(ansi.showCursor);
    if (finalLine !== undefined) {
      writeln(finalLine);
    }
  }

  abort(): void {
    clearRenderedLines(this.lineCount);
    this.lineCount = 0;
    write(ansi.showCursor);
  }
}

export function optionLines(input: {
  readonly active: boolean;
  readonly label: string;
  readonly hint?: string;
  readonly mark?: string;
  readonly hintBelow?: boolean;
}): string[] {
  const prefix = input.active ? cyan(symbols.pointer) : " ";
  const mark = input.mark === undefined ? "" : `${input.mark} `;
  const head = `  ${prefix} ${mark}${input.label}`;
  if (input.hint === undefined || input.hint.length === 0) {
    return [head];
  }
  if (input.hintBelow === true) {
    return [head, `      ${dim(input.hint)}`];
  }
  return [`${head} ${dim(input.hint)}`];
}

export function optionLine(input: {
  readonly active: boolean;
  readonly label: string;
  readonly hint?: string;
  readonly mark?: string;
  readonly hintBelow?: boolean;
}): string {
  return optionLines(input).join("\n");
}

export function footer(text: string): string {
  return `  ${dim(text)}`;
}

export { cyan, dim, green, symbols };
