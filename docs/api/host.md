# `@useagentsio/host` API Reference

The `@useagentsio/host` package implements the always-running VibeKit Agent Host daemon.

---

## Installation

```bash
pnpm add @useagentsio/host @useagentsio/core
```

---

## `VibeKitHost` Class

The Host class that loads a Project, attaches Interfaces, runs conversation turns and Worker Runs, and persists State. Delegation is an Agent capability — this class is not an `orchestrator` type.

### Constructor
```ts
import { VibeKitHost, type HostOptions } from "@useagentsio/host";

const host = new VibeKitHost(options: HostOptions);
```

### `HostOptions` Interface

```ts
export interface HostOptions {
  /** Absolute path to the project root directory */
  readonly projectRoot: string;
  
  /** Optional pre-parsed ProjectDocument */
  readonly project?: ProjectDocument;
  
  /** Optional custom RepositoryState store */
  readonly state?: RepositoryState;
  
  /** Environment variable map (defaults to process.env) */
  readonly env?: NodeJS.ProcessEnv;
  
  /** Custom interface factory overrides */
  readonly factories?: InterfaceFactoryMap;
  
  /** Custom session factory for Pi (used in unit tests) */
  readonly createSession?: CreatePiSession;
  
  /** Whether to start declared interfaces on initialize (default: true) */
  readonly startInterfaces?: boolean;
}
```

---

## Key Methods

### `host.start(): Promise<void>`
Initializes configured interfaces, verifies project state integrity, and transitions the host to the running state.

```ts
await host.start();
console.log("Host is active and listening for interface events.");
```

### `host.submit(message: InboundMessage): Promise<SubmitResult>`
Submits an inbound message or task directly to the host turn runner.

```ts
const result = await host.submit({
  conversationKey: "terminal:local:main",
  text: "Analyze test coverage",
  author: "developer",
  timestamp: new Date().toISOString(),
});

console.log("Agent response:", result.text);
```

### `host.stop(): Promise<void>`
Gracefully stops all running worker sessions, cleans up worktree locks, closes attached interfaces, and flushes pending state writes.

```ts
await host.stop();
```

### `host.health(): Promise<HostHealth>`
Returns the real-time health status of the Host, active worker pool usage, and interface connection states.
