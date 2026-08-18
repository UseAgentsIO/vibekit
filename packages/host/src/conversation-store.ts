import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  formatRuntimeId,
  parseAndValidateYaml,
  stringifyYaml,
  validateDocument,
  type ConversationDocument,
  type ProjectId,
  type RuntimeId,
} from "@useagentsio/core";

import { hostError } from "./errors.js";

export interface ConversationRecord extends ConversationDocument {}

export class ConversationStore {
  constructor(private readonly directory: string) {}

  pathFor(id: RuntimeId): string {
    return path.join(this.directory, `${id}.yaml`);
  }

  list(): ConversationRecord[] {
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    return fs
      .readdirSync(this.directory)
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => readConversationFile(path.join(this.directory, name)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  findByKey(conversationKey: string): ConversationRecord | undefined {
    return this.list().find((record) => record.conversationKey === conversationKey);
  }

  get(id: RuntimeId): ConversationRecord {
    const filePath = this.pathFor(id);
    if (!fs.existsSync(filePath)) {
      throw hostError(
        "invalid_input",
        "conversation_missing",
        `Conversation ${id} was not found`,
        { id },
      );
    }
    return readConversationFile(filePath);
  }

  write(record: ConversationRecord): ConversationRecord {
    const validated = validateDocument("conversation", record);
    if (!validated.valid || validated.data === undefined) {
      throw hostError(
        "invalid_input",
        "conversation_invalid",
        validated.errors[0]?.message ?? "Conversation record is invalid",
        { errors: validated.errors },
      );
    }
    fs.mkdirSync(this.directory, { recursive: true });
    const filePath = this.pathFor(validated.data.id);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, stringifyYaml(validated.data), "utf8");
    fs.renameSync(tempPath, filePath);
    return validated.data;
  }

  create(input: Omit<ConversationRecord, "id" | "revision"> & { id?: RuntimeId }): ConversationRecord {
    const id = input.id ?? formatRuntimeId("conversation", randomUUID());
    return this.write({
      ...input,
      id,
      revision: 1,
    });
  }

  update(record: ConversationRecord): ConversationRecord {
    return this.write({
      ...record,
      revision: record.revision + 1,
    });
  }
}

export function newConversationId(): RuntimeId {
  return formatRuntimeId("conversation", randomUUID());
}

export function defaultSessionPath(projectRoot: string, conversationId: RuntimeId): string {
  return path.join(".vibekit", "runtime", "sessions", `${conversationId}.jsonl`);
}

export function conversationsDirectory(projectRoot: string, statePath = ".vibekit/state"): string {
  return path.join(projectRoot, statePath, "conversations");
}

function readConversationFile(filePath: string): ConversationRecord {
  const validated = parseAndValidateYaml("conversation", fs.readFileSync(filePath, "utf8"));
  if (!validated.valid || validated.data === undefined) {
    throw hostError(
      "invalid_input",
      "conversation_invalid",
      validated.errors[0]?.message ?? "Conversation record is invalid",
      { path: filePath, errors: validated.errors },
    );
  }
  return validated.data;
}

export type { ProjectId };
