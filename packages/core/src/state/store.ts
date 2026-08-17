import fs from "node:fs";
import path from "node:path";

import { assertRuntimeIdOf } from "../ids.js";
import type { RuntimeId, RuntimeIdKind } from "../ids.js";
import { assertTransition } from "../lifecycles.js";
import type { LifecycleKind } from "../lifecycles.js";
import type { DocumentKind, DocumentTypeMap } from "../types.js";
import { parseAndValidateYaml, validateDocument } from "../validate.js";
import { stringifyYaml } from "../yaml.js";

import { atomicWriteFile, contentHash } from "./atomic.js";
import { stateError } from "./errors.js";
import type { LockManager } from "./locks.js";
import type { DocumentStoreKind, StoredRecord, WriteOptions } from "./types.js";

const KIND_DIRECTORY: Record<DocumentStoreKind, string> = {
  task: "tasks",
  result: "results",
  decision: "decisions",
  approval: "approvals",
  verification: "verifications",
};

const KIND_RUNTIME_ID: Record<DocumentStoreKind, RuntimeIdKind> = {
  task: "task",
  result: "result",
  decision: "decision",
  approval: "approval",
  verification: "verification",
};

const KIND_LIFECYCLE: Partial<Record<DocumentStoreKind, LifecycleKind>> = {
  task: "task",
  decision: "decision",
  approval: "approval",
  verification: "verification",
};

export interface DocumentStore<K extends DocumentStoreKind> {
  readonly kind: K;
  readonly directory: string;
  create(document: DocumentTypeMap[K]): StoredRecord<DocumentTypeMap[K]>;
  update(
    document: DocumentTypeMap[K],
    options: WriteOptions,
  ): StoredRecord<DocumentTypeMap[K]>;
  get(id: RuntimeId): StoredRecord<DocumentTypeMap[K]>;
  tryGet(id: RuntimeId): StoredRecord<DocumentTypeMap[K]> | undefined;
  list(): StoredRecord<DocumentTypeMap[K]>[];
  pathFor(id: RuntimeId): string;
}

export function createDocumentStore<K extends DocumentStoreKind>(options: {
  kind: K;
  directory: string;
  locks: LockManager;
  owner: string;
}): DocumentStore<K> {
  return new YamlDocumentStore(options);
}

class YamlDocumentStore<K extends DocumentStoreKind> implements DocumentStore<K> {
  readonly kind: K;
  readonly directory: string;
  private readonly locks: LockManager;
  private readonly owner: string;

  constructor(options: {
    kind: K;
    directory: string;
    locks: LockManager;
    owner: string;
  }) {
    this.kind = options.kind;
    this.directory = options.directory;
    this.locks = options.locks;
    this.owner = options.owner;
  }

  pathFor(id: RuntimeId): string {
    assertRuntimeIdOf(KIND_RUNTIME_ID[this.kind], id);
    return path.join(this.directory, `${id}.yaml`);
  }

  create(document: DocumentTypeMap[K]): StoredRecord<DocumentTypeMap[K]> {
    const validated = this.validate(document);
    const id = this.idOf(validated);
    return this.withLock(id, () => {
      const filePath = this.pathFor(id);
      if (fs.existsSync(filePath)) {
        stateError("conflict", "state_already_exists", `${this.kind} ${id} already exists`, {
          kind: this.kind,
          id,
          path: filePath,
        });
      }
      return this.writeFile(filePath, validated);
    });
  }

  update(
    document: DocumentTypeMap[K],
    options: WriteOptions,
  ): StoredRecord<DocumentTypeMap[K]> {
    const validated = this.validate(document);
    const id = this.idOf(validated);
    return this.withLock(id, () => {
      const current = this.readExisting(id);
      this.assertExpected(current, options);
      const next = this.nextDocument(current.document, validated);
      this.assertStatusTransition(current.document, next);
      return this.writeFile(current.path, next);
    });
  }

  get(id: RuntimeId): StoredRecord<DocumentTypeMap[K]> {
    const record = this.tryGet(id);
    if (record === undefined) {
      stateError("invalid_input", "state_not_found", `${this.kind} ${String(id)} not found`, {
        kind: this.kind,
        id,
      });
    }
    return record;
  }

  tryGet(id: RuntimeId): StoredRecord<DocumentTypeMap[K]> | undefined {
    assertRuntimeIdOf(KIND_RUNTIME_ID[this.kind], id);
    const filePath = this.pathFor(id);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return this.readFile(filePath);
  }

  list(): StoredRecord<DocumentTypeMap[K]>[] {
    if (!fs.existsSync(this.directory)) {
      return [];
    }
    const records: StoredRecord<DocumentTypeMap[K]>[] = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".yaml") || entry.name.startsWith(".")) {
        continue;
      }
      records.push(this.readFile(path.join(this.directory, entry.name)));
    }
    return records.sort((left, right) => left.document.id.localeCompare(right.document.id));
  }

  private withLock<T>(id: RuntimeId, fn: () => T): T {
    const lockName = `${KIND_DIRECTORY[this.kind]}:${id}`;
    this.locks.acquire(lockName, this.owner);
    try {
      return fn();
    } finally {
      this.locks.release(lockName, this.owner);
    }
  }

  private validate(document: DocumentTypeMap[K]): DocumentTypeMap[K] {
    const result = validateDocument(this.kind as DocumentKind, document);
    if (!result.valid || result.data === undefined) {
      stateError(
        "invalid_input",
        "state_invalid_document",
        result.errors[0]?.message ?? `${this.kind} document is invalid`,
        { kind: this.kind, errors: result.errors },
      );
    }
    return result.data as DocumentTypeMap[K];
  }

  private idOf(document: DocumentTypeMap[K]): RuntimeId {
    assertRuntimeIdOf(KIND_RUNTIME_ID[this.kind], document.id);
    return document.id;
  }

  private readExisting(id: RuntimeId): StoredRecord<DocumentTypeMap[K]> {
    const record = this.tryGet(id);
    if (record === undefined) {
      stateError("invalid_input", "state_not_found", `${this.kind} ${id} not found`, {
        kind: this.kind,
        id,
      });
    }
    return record;
  }

  private readFile(filePath: string): StoredRecord<DocumentTypeMap[K]> {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseAndValidateYaml(this.kind as DocumentKind, raw);
    if (!parsed.valid || parsed.data === undefined) {
      stateError(
        "invalid_input",
        "state_corrupt_document",
        parsed.errors[0]?.message ?? `${this.kind} file is invalid`,
        { kind: this.kind, path: filePath, errors: parsed.errors },
      );
    }
    const document = parsed.data as DocumentTypeMap[K];
    return {
      document,
      hash: contentHash(raw),
      path: filePath,
      revision: revisionOf(document),
    };
  }

  private writeFile(
    filePath: string,
    document: DocumentTypeMap[K],
  ): StoredRecord<DocumentTypeMap[K]> {
    const serialized = stringifyYaml(document);
    atomicWriteFile(filePath, serialized);
    return {
      document,
      hash: contentHash(serialized),
      path: filePath,
      revision: revisionOf(document),
    };
  }

  private assertExpected(
    current: StoredRecord<DocumentTypeMap[K]>,
    options: WriteOptions,
  ): void {
    if (options.expectedRevision === undefined && options.expectedHash === undefined) {
      stateError(
        "invalid_input",
        "state_expected_missing",
        "Updates require expectedRevision or expectedHash",
        { kind: this.kind, id: current.document.id },
      );
    }
    if (options.expectedRevision !== undefined) {
      if (current.revision === undefined) {
        stateError(
          "invalid_input",
          "state_revision_unsupported",
          `${this.kind} records use content hashes, not revisions`,
          { kind: this.kind, id: current.document.id },
        );
      }
      if (options.expectedRevision !== current.revision) {
        stateError(
          "conflict",
          "state_revision_conflict",
          `Stale ${this.kind} write: expected revision ${options.expectedRevision}, found ${current.revision}`,
          {
            kind: this.kind,
            id: current.document.id,
            expectedRevision: options.expectedRevision,
            actualRevision: current.revision,
          },
        );
      }
    }
    if (options.expectedHash !== undefined && options.expectedHash !== current.hash) {
      stateError(
        "conflict",
        "state_hash_conflict",
        `Stale ${this.kind} write: expected hash does not match current record`,
        {
          kind: this.kind,
          id: current.document.id,
          expectedHash: options.expectedHash,
          actualHash: current.hash,
        },
      );
    }
  }

  private nextDocument(
    current: DocumentTypeMap[K],
    incoming: DocumentTypeMap[K],
  ): DocumentTypeMap[K] {
    const currentRevision = revisionOf(current);
    const incomingRevision = revisionOf(incoming);
    if (currentRevision === undefined || incomingRevision === undefined) {
      return incoming;
    }
    if (incomingRevision === currentRevision) {
      return { ...incoming, revision: currentRevision + 1 };
    }
    if (incomingRevision === currentRevision + 1) {
      return incoming;
    }
    stateError(
      "invalid_input",
      "state_revision_non_monotonic",
      `${this.kind} revision must stay at ${currentRevision} or become ${currentRevision + 1}`,
      {
        kind: this.kind,
        id: incoming.id,
        currentRevision,
        incomingRevision,
      },
    );
  }

  private assertStatusTransition(from: DocumentTypeMap[K], to: DocumentTypeMap[K]): void {
    const lifecycle = KIND_LIFECYCLE[this.kind];
    if (lifecycle === undefined) {
      return;
    }
    const fromStatus = statusOf(from);
    const toStatus = statusOf(to);
    if (fromStatus === undefined || toStatus === undefined || fromStatus === toStatus) {
      return;
    }
    assertTransition(lifecycle, fromStatus, toStatus);
  }
}

function revisionOf(document: object): number | undefined {
  if (!("revision" in document) || typeof document.revision !== "number") {
    return undefined;
  }
  return document.revision;
}

function statusOf(document: object): string | undefined {
  if (!("status" in document) || typeof document.status !== "string") {
    return undefined;
  }
  return document.status;
}
