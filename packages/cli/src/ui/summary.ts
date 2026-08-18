import type { OutputBuffer } from "../output.js";
import { canPrompt } from "../prompt.js";
import { dim, symbols, writeln } from "./theme.js";

export function printIntro(title: string, subtitle: string): void {
  if (!canPrompt()) {
    return;
  }
  writeln("");
  writeln(`${symbols.open}  ${title}`);
  writeln(dim(`   ${subtitle}`));
  writeln("");
}

export function printSummaryTable(
  out: OutputBuffer,
  rows: ReadonlyArray<{ readonly label: string; readonly value: string }>,
): void {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  for (const row of rows) {
    out.log(`  ${row.label.padEnd(width)}  ${row.value}`);
  }
}

export function printCompletion(
  out: OutputBuffer,
  input: {
    readonly title: string;
    readonly lines?: readonly string[];
    readonly fileCount?: number;
    readonly files?: readonly string[];
    readonly showFiles?: boolean;
    readonly doctorOk?: boolean;
    readonly next?: readonly string[];
    readonly skipped?: string;
    readonly elapsedMs?: number;
  },
): void {
  out.log(`${input.title}`);
  if (input.lines !== undefined && input.lines.length > 0) {
    out.log("");
    for (const line of input.lines) {
      out.log(`  ${line}`);
    }
  }
  const counts: string[] = [];
  if (input.fileCount !== undefined) {
    counts.push(`${input.fileCount} file${input.fileCount === 1 ? "" : "s"} created`);
  }
  if (input.doctorOk === true) {
    counts.push("Doctor passed");
  }
  if (counts.length > 0) {
    out.log("");
    for (const line of counts) {
      out.log(`  ${line}`);
    }
  }
  if (input.showFiles === true && input.files !== undefined && input.files.length > 0) {
    out.log("");
    out.log("Created:");
    for (const file of input.files) {
      out.log(`  ${file}`);
    }
  }
  if (input.skipped !== undefined) {
    out.log("");
    out.log(input.skipped);
  }
  if (input.next !== undefined && input.next.length > 0) {
    out.log("");
    out.log("Next:");
    for (const line of input.next) {
      out.log(`  ${line}`);
    }
  }
  if (input.elapsedMs !== undefined) {
    out.log("");
    out.log(`Done in ${(input.elapsedMs / 1000).toFixed(1)}s`);
  }
}
