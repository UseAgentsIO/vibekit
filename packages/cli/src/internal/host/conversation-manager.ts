import path from "node:path";

import type { InboundMessage } from "../interfaces/sdk/index.js";

import {
  ConversationStore,
  defaultSessionPath,
  newConversationId,
  type ConversationRecord,
} from "./conversation-store.js";
import { hostError } from "./errors.js";

export class ConversationManager {
  constructor(
    private readonly store: ConversationStore,
    private readonly projectId: ConversationRecord["projectId"],
    private readonly projectRoot: string,
  ) {}

  loadOrCreate(input: {
    message: InboundMessage;
    agentBinding: string;
  }): ConversationRecord {
    const existing = this.store.findByKey(input.message.conversationKey);
    if (existing !== undefined) {
      return existing;
    }
    const id = newConversationId();
    return this.store.create({
      schemaVersion: 1,
      id,
      projectId: this.projectId,
      interfaceBinding: input.message.interfaceBinding,
      accountId: input.message.accountId,
      external: {
        conversationId: input.message.conversationId,
        threadId: input.message.threadId,
      },
      conversationKey: input.message.conversationKey,
      agentBinding: input.agentBinding,
      sessionPath: toPosix(defaultSessionPath(this.projectRoot, id)),
      status: "active",
      createdAt: input.message.timestamp,
      lastUsedAt: input.message.timestamp,
    });
  }

  touch(record: ConversationRecord, timestamp: string, lastEventId?: string): ConversationRecord {
    return this.store.update({
      ...record,
      lastUsedAt: timestamp,
      lastEventId,
      status: "active",
    });
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function requireAgentBinding(
  project: {
    defaultAgent?: string;
    agentBindings: Readonly<Record<string, { definition: string }>>;
    interfaceBindings?: Readonly<
      Record<string, { defaultAgent?: string; enabled?: boolean }>
    >;
  },
  interfaceBinding: string,
): string {
  const fromInterface = project.interfaceBindings?.[interfaceBinding]?.defaultAgent;
  const binding = fromInterface ?? project.defaultAgent;
  if (binding === undefined || project.agentBindings[binding] === undefined) {
    throw hostError(
      "configuration_invalid",
      "default_agent_missing",
      "Project has no usable default Agent binding for this Interface",
      { interfaceBinding, defaultAgent: binding },
    );
  }
  return binding;
}
