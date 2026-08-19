# `@useagentsio/host` API Reference

The `@useagentsio/host` package implements the always-running VibeKit Agent Host daemon (`vibekit-host`).

---

## Installation

```bash
pnpm add @useagentsio/host @useagentsio/core
```

---

## `VibeKitHost`

There is no public constructor. Boot with `VibeKitHost.start` (acquires `.vibekit/runtime/host.lock`, starts IPC, optionally starts Interfaces).

```ts
import { VibeKitHost, type HostOptions } from "@useagentsio/host";

const host = await VibeKitHost.start({
  projectRoot: "/path/to/project",
  startInterfaces: false,
  env: process.env,
});
```

### `HostOptions`

```ts
export interface HostOptions {
  readonly projectRoot: string;
  readonly project?: ProjectDocument;
  readonly state?: RepositoryState;
  readonly env?: NodeJS.ProcessEnv;
  readonly factories?: InterfaceFactoryMap;
  readonly runTurn?: RunTurn;
  readonly createSession?: CreatePiSession;
  readonly startInterfaces?: boolean;
  readonly now?: () => Date;
}
```

- `factories` — optional overrides. When omitted, the Host loads `runtime.package` / `runtime.export` (official fallback: `interface:terminal`).
- `startInterfaces` — default `true`. `vibekit msg` sets this `false`.
- `runTurn` / `createSession` — test seams, not product modes.

---

## Key methods

### `VibeKitHost.start(options): Promise<VibeKitHost>`

Loads `.vibekit/project.yaml`, opens repository State, takes the Host lock, starts local IPC, and starts enabled Interfaces unless `startInterfaces: false`.

A second start on the same Project throws `host_already_running`.

### `host.submit(message: InboundMessage): Promise<SubmitResult>`

```ts
import { conversationKeyOf } from "@useagentsio/interface-sdk";

const conversationKey = conversationKeyOf({
  interfaceBinding: "terminal-main",
  accountId: "local",
  conversationId: "cli",
});

const result = await host.submit({
  eventId: "evt-1",
  interfaceBinding: "terminal-main",
  accountId: "local",
  conversationId: "cli",
  conversationKey,
  sender: { id: "local", displayName: "operator", trusted: true },
  text: "Analyze test coverage",
  attachments: [],
  timestamp: new Date().toISOString(),
});

console.log(result.text);
```

`SubmitResult`: `{ conversationKey, text, cancelled, duplicate, error? }`.

### `host.approve(approvalId, decision, notes?): Promise<void>`

Records an Approval decision via `decideApproval`. Used by Interfaces when the operator answers `approval.requested`.

### `host.cancel(conversationKey): Promise<boolean>`

### `host.health(): Promise<HostHealth>`

PID, readiness, conversation counts, and Interface health.

### `host.stop(): Promise<void>`

Stops Interfaces, closes IPC (unlinks `.vibekit/runtime/host.sock`), releases the lock, removes `host-status.json`.

---

## Local IPC

While a Host is running, clients can submit turns without starting a second process:

```ts
import { isHostIpcAvailable, submitViaIpc } from "@useagentsio/host";

if (await isHostIpcAvailable(projectRoot)) {
  await submitViaIpc(projectRoot, message);
}
```

POSIX: Unix socket at `.vibekit/runtime/host.sock` (falls back to loopback TCP if the path is too long). `vibekit msg` uses this path automatically.
