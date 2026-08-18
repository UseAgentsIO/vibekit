# SDK & Developer API Overview

VibeKit is architected as a modular TypeScript monorepo published under the `@useagentsio` npm scope.

---

## Package Architecture

```text
               ┌───────────────────────────┐
               │    @useagentsio/cli       │  (CLI Binary: vibekit)
               └─────────────┬─────────────┘
                             │
               ┌─────────────▼─────────────┐
               │    @useagentsio/host      │  (Daemon Binary: vibekit-host)
               └─────────────┬─────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
@useagentsio/core       @useagentsio/pi       @useagentsio/interface-sdk
(Schemas, State, IDs)  (Embedded Adapter)    (Interface Protocol Contract)
                                                     ▲
                                                     │
                                       @useagentsio/interface-terminal
```

---

## Package Roles

| Package | Role | Key Exports |
| :--- | :--- | :--- |
| [`@useagentsio/host`](host.md) | The always-running Host daemon process | `VibeKitHost`, `HostOptions`, `PersistentSessionManager`, `SecretResolver` |
| [`@useagentsio/core`](core.md) | Schema validation, typed IDs, state storage, and three-way diff/update | `parseAndValidateYaml`, `createRepositoryState`, `computeModuleDiff`, `applyModuleUpdate` |
| [`@useagentsio/pi`](pi.md) | Embedded Pi runtime adapter, worktree manager, and delegation executor | `prepareIsolatedRun`, `runIsolated`, `createPiIsolatedSession` |
| [`@useagentsio/interface-sdk`](interface-sdk.md) | Standard interface contract for building custom I/O adapters | `RunningInterface`, `InboundMessage`, `HostOutput`, `InterfaceServices` |
| `@useagentsio/interface-terminal` | Official Terminal interface implementation | `createTerminalInterface` |
| `@useagentsio/cli` | CLI commands and registry distribution | `runCli` |

---

## TypeScript Support & Node.js ESM

All `@useagentsio` packages ship with full TypeScript declarations (`.d.ts`) and use modern Node.js ECMAScript Modules (`"type": "module"`).

```ts
import { VibeKitHost } from "@useagentsio/host";
import { createRepositoryState } from "@useagentsio/core";
```
