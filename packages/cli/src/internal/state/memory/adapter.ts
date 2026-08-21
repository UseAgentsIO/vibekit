import { createMemoryStore } from "./store.js";
import { MEMORY_STATE_ID, type MemoryStore } from "./types.js";

export interface StateMemoryAdapter {
  id: typeof MEMORY_STATE_ID;
  sessionContext(): string | undefined;
  close(): void;
}

export async function createStateMemoryAdapter(
  config: Record<string, unknown>,
  ctx: { projectRoot: string },
): Promise<StateMemoryAdapter> {
  const store = createMemoryStore({
    projectRoot: ctx.projectRoot,
    dbPath: stringOption(config.dbPath),
    notesLimit: numberOption(config.notesLimit),
    preferencesLimit: numberOption(config.preferencesLimit),
  });
  return new ProjectMemoryAdapter(store);
}

class ProjectMemoryAdapter implements StateMemoryAdapter {
  readonly id = MEMORY_STATE_ID;

  constructor(private readonly store: MemoryStore) {}

  sessionContext(): string | undefined {
    return this.store.snapshot();
  }

  close(): void {
    this.store.close();
  }
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
