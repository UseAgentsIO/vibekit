# `@useagentsio/interface-sdk` API Reference

The `@useagentsio/interface-sdk` package defines the contract for building custom Interface adapters that attach to the VibeKit Host.

---

## Installation

```bash
pnpm add @useagentsio/interface-sdk
```

---

## The Interface Contract

An Interface component translates external protocols (terminal stdio, HTTP webhooks, chat protocols) into Host events and renders outbound responses.

### Interface Factory Signature

```ts
import type { 
  RunningInterface, 
  InterfaceServices, 
  InterfaceConfig 
} from "@useagentsio/interface-sdk";

export function createCustomInterface(
  services: InterfaceServices,
  config?: InterfaceConfig
): Promise<RunningInterface>;
```

### `InterfaceServices` (Provided by the Host)

The Host provides `InterfaceServices` to the interface upon loading:

```ts
export interface InterfaceServices {
  /** Submit an inbound message or turn to the Host */
  submit(message: InboundMessage): Promise<SubmitResult>;
  
  /** Request cancellation of an active task or turn */
  cancel(conversationKey: string): Promise<void>;
  
  /** Submit a human approval decision */
  approve(approvalId: string, decision: "approved" | "rejected", notes?: string): Promise<void>;
  
  /** Logger service */
  log(level: "info" | "warn" | "error", message: string): void;
}
```

### `RunningInterface` (Returned by the Interface)

The interface returns a `RunningInterface` handle allowing the Host to send outbound events and manage interface lifecycle:

```ts
export interface RunningInterface {
  /** Send outbound events (progress, results, approval requests) to the interface */
  send(output: HostOutput): Promise<void>;
  
  /** Close and clean up the interface on Host shutdown */
  stop(): Promise<void>;
  
  /** Check interface health */
  health(): Promise<InterfaceHealth>;
}
```

---

## Inbound / Outbound Event Payloads

### Inbound Events (`Interface → Host`)
- **`InboundMessage`**: `{ conversationKey, text, author, timestamp, attachments? }`
- **`CancelRequest`**: `{ conversationKey, reason? }`
- **`ApprovalDecision`**: `{ approvalId, decision, notes? }`

### Outbound Events (`Host → Interface`)
- **`progress`**: Real-time progress updates suitable for display.
- **`result`**: Structured summary and artifacts emitted upon turn completion.
- **`ask-approval`**: Gated action request requiring human review.
- **`error`**: Structured error payload.
- **`idle`**: Indicates the Host is waiting for operator input.
