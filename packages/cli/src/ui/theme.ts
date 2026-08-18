export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  up: (n = 1) => `\x1b[${n}A`,
  column: "\x1b[1G",
} as const;

export function bold(text: string): string {
  return `${ansi.bold}${text}${ansi.reset}`;
}

export function dim(text: string): string {
  return `${ansi.dim}${text}${ansi.reset}`;
}

export function green(text: string): string {
  return `${ansi.green}${text}${ansi.reset}`;
}

export function cyan(text: string): string {
  return `${ansi.cyan}${text}${ansi.reset}`;
}

export const symbols = {
  pointer: "❯",
  check: "✔",
  radioOn: "◉",
  radioOff: "◯",
  done: "◆",
  open: "◇",
} as const;

export function write(text: string): void {
  process.stdout.write(text);
}

export function writeln(text = ""): void {
  process.stdout.write(`${text}\n`);
}

export function clearRenderedLines(count: number): void {
  if (count <= 0) {
    return;
  }
  write(`${ansi.column}${ansi.clearLine}`);
  for (let index = 0; index < count; index += 1) {
    write(`${ansi.up()}${ansi.column}${ansi.clearLine}`);
  }
}
