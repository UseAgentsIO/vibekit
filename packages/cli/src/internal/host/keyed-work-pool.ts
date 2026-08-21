export class KeyedWorkPool {
  private readonly queues = new Map<string, Promise<unknown>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly maxParallel: number) {
    if (maxParallel < 1) {
      throw new Error("maxParallel must be at least 1");
    }
  }

  get size(): number {
    return this.active;
  }

  get queued(): number {
    return this.queues.size;
  }

  cancel(key: string): boolean {
    const controller = this.controllers.get(key);
    if (controller === undefined) {
      return false;
    }
    controller.abort();
    return true;
  }

  async run<T>(key: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await this.acquireSlot();
      const controller = new AbortController();
      this.controllers.set(key, controller);
      try {
        return await work(controller.signal);
      } finally {
        this.controllers.delete(key);
        this.releaseSlot();
      }
    });
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await next;
    } finally {
      if (this.queues.get(key) !== undefined) {
        void this.queues.get(key)?.then(() => {
          if (this.queues.get(key) === next.then(
            () => undefined,
            () => undefined,
          )) {
            this.queues.delete(key);
          }
        });
      }
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < this.maxParallel) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
  }

  private releaseSlot(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    next?.();
  }
}
