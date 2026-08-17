export class OutputBuffer {
  readonly stdoutChunks: string[] = [];
  readonly stderrChunks: string[] = [];

  log(message: string): void {
    this.stdoutChunks.push(message.endsWith("\n") ? message : `${message}\n`);
  }

  error(message: string): void {
    this.stderrChunks.push(message.endsWith("\n") ? message : `${message}\n`);
  }

  get stdout(): string {
    return this.stdoutChunks.join("");
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
