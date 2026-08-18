import { stdin, stdout } from "node:process";

import { ansi, write } from "./theme.js";

export type KeyName =
  | "up"
  | "down"
  | "enter"
  | "escape"
  | "space"
  | "backspace"
  | "slash"
  | "ctrlc"
  | "char"
  | "unknown";

export interface Key {
  readonly name: KeyName;
  readonly sequence: string;
}

let rawDepth = 0;
let previousRaw = false;
let previousPaused = true;

export async function withRawInput<T>(work: () => Promise<T>): Promise<T> {
  if (rawDepth === 0) {
    previousRaw = stdin.isRaw === true;
    previousPaused = stdin.isPaused();
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding("utf8");
  }
  rawDepth += 1;
  try {
    return await work();
  } finally {
    rawDepth -= 1;
    if (rawDepth === 0) {
      if (stdin.isTTY) {
        stdin.setRawMode(previousRaw);
      }
      if (previousPaused && !stdin.isPaused()) {
        stdin.pause();
      }
      showCursor();
    }
  }
}

export function releaseTerminal(): void {
  if (rawDepth > 0) {
    return;
  }
  if (stdin.isTTY && stdin.isRaw === true) {
    stdin.setRawMode(false);
  }
  if (!stdin.isPaused()) {
    stdin.pause();
  }
  showCursor();
}

function showCursor(): void {
  if (stdout.isTTY) {
    write(ansi.showCursor);
  }
}

export function readKey(): Promise<Key> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer): void => {
      stdin.off("error", onError);
      resolve(parseKey(String(chunk)));
    };
    const onError = (error: Error): void => {
      stdin.off("data", onData);
      reject(error);
    };
    stdin.once("data", onData);
    stdin.once("error", onError);
  });
}

export function parseKey(sequence: string): Key {
  if (sequence === "\x03") {
    return { name: "ctrlc", sequence };
  }
  if (sequence === "\r" || sequence === "\n") {
    return { name: "enter", sequence };
  }
  if (sequence === "\x1b") {
    return { name: "escape", sequence };
  }
  if (sequence === "\x1b[A" || sequence === "\x1bOA") {
    return { name: "up", sequence };
  }
  if (sequence === "\x1b[B" || sequence === "\x1bOB") {
    return { name: "down", sequence };
  }
  if (sequence === " " ) {
    return { name: "space", sequence };
  }
  if (sequence === "\x7f" || sequence === "\b") {
    return { name: "backspace", sequence };
  }
  if (sequence === "/") {
    return { name: "slash", sequence };
  }
  if (sequence.startsWith("\x1b") || sequence.length === 0) {
    return { name: "unknown", sequence };
  }
  return { name: "char", sequence };
}
