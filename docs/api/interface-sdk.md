# `@useagentsio/interface-sdk` API Reference

The `@useagentsio/interface-sdk` package is the Host-facing contract for Interface adapters.

---

## Installation

```bash
pnpm add @useagentsio/interface-sdk
```

---

## Factory

```ts
import type {
  InterfaceFactory,
  InterfaceServices,
  RunningInterface,
} from "@useagentsio/interface-sdk";

export const createCustomInterface: InterfaceFactory["create"] = async (
  config,
  services,
) => {
  // ...
  return running;
};
```

`InterfaceFactory.create(config, services)` — config first, then Host services. There is no `InterfaceConfig` type; config is `Record<string, unknown>` (usually parsed from the binding’s YAML file).

Official example: `createTerminalInterface` from `@useagentsio/interface-terminal`.

---

## `InterfaceServices` (Host → Interface)

```ts
export interface InterfaceServices {
  submit(message: InboundMessage): Promise<void>;
  cancel(conversationKey: string): Promise<boolean>;
  approve(approvalId: string, decision: "approved" | "rejected", notes?: string): Promise<void>;
  resolveSecret(name: string): string;
  log: InterfaceLogger;
}
```

`InterfaceLogger` is `{ info, warn, error }`, not a single `log(level, message)` function. Secret names in log `data` are redacted.

---

## `RunningInterface`

```ts
export interface RunningInterface {
  start(): Promise<void>;
  stop(): Promise<void>;
  deliver(output: HostOutput): Promise<void>;
  health(): Promise<InterfaceHealth>;
}
```

Outbound events use **`deliver`**, not `send`.

---

## Messages

### Inbound (`InboundMessage`)

`eventId`, `interfaceBinding`, `accountId`, `conversationId`, optional `threadId`, `conversationKey`, `sender` (`{ id, displayName?, trusted }`), `text`, `attachments`, `timestamp`.

Build keys with `conversationKeyOf({ interfaceBinding, accountId, conversationId, threadId? })`.

### Outbound (`HostOutput`)

Discriminated on `type`:

| `type` | Meaning |
| :--- | :--- |
| `text.delta` | Streaming text |
| `message.completed` | Turn finished |
| `activity` | Progress such as `thinking` |
| `approval.requested` | `{ approvalId, question, options }` |
| `error` | Failure (`message`, optional `code`) |
| `cancelled` | Turn cancelled |

Interfaces collect Approval answers on `approval.requested` and call `services.approve`. They must not own Project State, permissions, or Agent recipes.
