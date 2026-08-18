import {
  formatRuntimeId,
  type EventDocument,
  type ProjectDocument,
  type ResultDocument,
  type RuntimeId,
  type TaskDocument,
} from "@useagentsio/core";
import type { InboundMessage } from "@useagentsio/interface-sdk";

import type { ConversationRecord } from "./conversation-store.js";

export interface TurnRequest {
  readonly projectRoot: string;
  readonly project: ProjectDocument;
  readonly conversation: ConversationRecord;
  readonly message: InboundMessage;
  readonly signal: AbortSignal;
}

export interface TurnOutcome {
  readonly task: TaskDocument;
  readonly runId: RuntimeId;
  readonly text: string;
  readonly cancelled: boolean;
  readonly error?: string;
  readonly events: readonly EventDocument[];
  readonly result?: ResultDocument;
  readonly sessionPath: string;
}

export type RunTurn = (request: TurnRequest) => Promise<TurnOutcome>;

export function createInboundTask(input: {
  project: ProjectDocument;
  conversation: ConversationRecord;
  message: InboundMessage;
  agentId: TaskDocument["assignedAgent"];
  now?: Date;
}): TaskDocument {
  const now = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    id: formatRuntimeId("task", cryptoRandom()),
    projectId: input.project.id,
    objective: input.message.text,
    context: {
      references: [
        `conversation:${input.conversation.id}`,
        `interface:${input.message.interfaceBinding}`,
      ],
    },
    constraints: [],
    acceptanceCriteria: ["A response is delivered to the Interface"],
    requiredCapabilities: [],
    assignedAgent: input.agentId,
    claimedBy: null,
    scope: { paths: [], resources: [] },
    dependencies: [],
    priority: "normal",
    delivery: { mode: "apply" },
    authorization: { state: "standing" },
    status: "open",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}
