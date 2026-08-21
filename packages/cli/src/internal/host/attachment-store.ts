import fs from "node:fs";
import path from "node:path";

export class AttachmentStore {
  constructor(private readonly directory: string) {}

  directoryFor(eventId: string): string {
    const safe = eventId.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const target = path.join(this.directory, safe);
    fs.mkdirSync(target, { recursive: true });
    return target;
  }
}
