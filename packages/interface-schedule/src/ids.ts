import { randomBytes, randomUUID } from "node:crypto";

export function newJobId(): string {
  return `sch_${randomBytes(12).toString("hex")}`;
}

export function newEventId(): string {
  return `event_${randomUUID()}`;
}
