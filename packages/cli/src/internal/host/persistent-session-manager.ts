import fs from "node:fs";
import path from "node:path";

const RETAINED = new Map<string, { lastUsed: number; sessionPath: string }>();

export class PersistentSessionManager {
  constructor(
    private readonly sessionsDir: string,
    private readonly retainedLimit: number,
  ) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  remember(conversationId: string, sessionPath: string): void {
    RETAINED.set(conversationId, { lastUsed: Date.now(), sessionPath });
    this.evict();
  }

  forget(conversationId: string): void {
    RETAINED.delete(conversationId);
  }

  get(conversationId: string): string | undefined {
    return RETAINED.get(conversationId)?.sessionPath;
  }

  get size(): number {
    return RETAINED.size;
  }

  resolvePath(sessionPath: string, projectRoot: string): string {
    return path.isAbsolute(sessionPath)
      ? sessionPath
      : path.join(projectRoot, sessionPath);
  }

  private evict(): void {
    if (RETAINED.size <= this.retainedLimit) {
      return;
    }
    const ordered = [...RETAINED.entries()].sort(
      (left, right) => left[1].lastUsed - right[1].lastUsed,
    );
    while (RETAINED.size > this.retainedLimit) {
      const oldest = ordered.shift();
      if (oldest === undefined) {
        break;
      }
      RETAINED.delete(oldest[0]);
    }
  }
}
