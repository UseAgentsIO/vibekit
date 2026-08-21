# Runtime API Overview

The published product boundary is one package, `@useagentsio/vibekit`, with the `vibekit` command. Core, Host, Pi, connection contracts, built-in abilities, memory, scheduling, and verification are internal runtime areas. This section is an advanced maintainer reference, not a set of separately installable SDK packages.

## Internal runtime areas

~~~text
@useagentsio/vibekit
├── CLI entry and Project lifecycle
├── internal/core          schemas, IDs, State, registry, install/update/remove
├── internal/host          Host lifecycle, IPC, conversations, connections
├── internal/pi            embedded Pi adapter, isolation, delegation
├── internal/interfaces    connection contract and built-in connections
├── internal/tools         built-in abilities
├── internal/state         State and memory adapters
└── internal/verifiers     verification implementations
~~~

The source locations above are intentionally internal. A Project does not install them separately and an external Component should not import them as an SDK. If a real external Component author needs an independently versioned contract, that boundary must be designed and extracted explicitly; `@useagentsio/sdk` is not currently a supported package.

## Reference surfaces

| Area | Role | Representative exports |
| :--- | :--- | :--- |
| [Host runtime](host.md) | Project lifecycle, connections, conversations, IPC | `VibeKitHost.start`, `submitViaIpc`, health and shutdown |
| [Core runtime](core.md) | Schemas, IDs, State, registry, install/update | `parseAndValidateYaml`, `createRepositoryState`, `planUpdate` |
| [Pi runtime](pi.md) | Embedded model/tool execution, worktrees, delegation | `prepareIsolatedRun`, `runIsolated`, `runManaged` |
| [Interface contract](interface-sdk.md) | Host-to-connection messages and lifecycle | `RunningInterface`, `InboundMessage`, `HostOutput` |

The [Architecture Overview](../architecture/overview.md) explains the runtime lifecycle. The [Module Authoring guide](../contributing/module-authoring.md) explains registry schemas, Module IDs, runtime identifiers, file targets, and the external npm-backed Component contract.

## Source-checkout TypeScript

These examples describe imports inside the repository's internal source tree. They are not public package-install instructions:

~~~ts
import { VibeKitHost } from "./packages/cli/src/internal/host/index.js";
import { parseAndValidateYaml } from "./packages/cli/src/internal/core/index.js";
~~~

The product's supported user boundary remains the `vibekit` command. The package owner must explicitly approve any future public programmatic API before these internal references become an external contract.
