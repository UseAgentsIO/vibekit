import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";

export const PAIRING_STORE_RELATIVE = ".vibekit/runtime/pairing-telegram.json";
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 60 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PairedSender {
  readonly userId: string;
  readonly displayName?: string;
  readonly pairedAt: string;
}

export interface PendingPairing {
  readonly code: string;
  readonly userId: string;
  readonly displayName?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface PairingDocument {
  readonly schemaVersion: 1;
  readonly paired: Record<string, PairedSender>;
  readonly pending: Record<string, PendingPairing>;
}

export interface PairingList {
  readonly paired: readonly PairedSender[];
  readonly pending: readonly PendingPairing[];
}

export function pairingStorePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), PAIRING_STORE_RELATIVE);
}

export function emptyPairingDocument(): PairingDocument {
  return { schemaVersion: 1, paired: {}, pending: {} };
}

export function readPairingStore(projectRoot: string): PairingDocument {
  const filePath = pairingStorePath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return emptyPairingDocument();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PairingDocument>;
    return normalizeStore(parsed);
  } catch {
    return emptyPairingDocument();
  }
}

export function writePairingStore(projectRoot: string, document: PairingDocument): void {
  const filePath = pairingStorePath(projectRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function generatePairingCode(): string {
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function isAllowlisted(allowFrom: readonly string[], userId: string): boolean {
  return allowFrom.includes(userId);
}

export function isPaired(projectRoot: string, userId: string): boolean {
  return readPairingStore(projectRoot).paired[userId] !== undefined;
}

export function isTrustedSender(
  projectRoot: string,
  userId: string,
  allowFrom: readonly string[],
): boolean {
  return isAllowlisted(allowFrom, userId) || isPaired(projectRoot, userId);
}

export function issuePairingCode(
  projectRoot: string,
  userId: string,
  displayName: string | undefined,
  now: Date = new Date(),
): PendingPairing {
  const store = readPairingStore(projectRoot);
  const existing = findPendingForUser(store, userId, now);
  if (existing !== undefined) {
    return existing;
  }
  const pending: PendingPairing = {
    code: uniqueCode(store),
    userId,
    ...(displayName !== undefined ? { displayName } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PAIRING_TTL_MS).toISOString(),
  };
  const next: PairingDocument = {
    schemaVersion: 1,
    paired: store.paired,
    pending: { ...pruneExpiredPending(store.pending, now), [pending.code]: pending },
  };
  writePairingStore(projectRoot, next);
  return pending;
}

export function approvePairing(projectRoot: string, code: string, now: Date = new Date()): PairedSender {
  const normalized = code.trim().toUpperCase();
  const store = readPairingStore(projectRoot);
  const pending = store.pending[normalized];
  if (pending === undefined) {
    throw new Error(`Unknown pairing code`);
  }
  if (Date.parse(pending.expiresAt) <= now.getTime()) {
    const expired: PairingDocument = {
      schemaVersion: 1,
      paired: store.paired,
      pending: omitPending(store.pending, normalized),
    };
    writePairingStore(projectRoot, expired);
    throw new Error(`Pairing code expired`);
  }
  const record: PairedSender = {
    userId: pending.userId,
    ...(pending.displayName !== undefined ? { displayName: pending.displayName } : {}),
    pairedAt: now.toISOString(),
  };
  const pendingWithoutUser: Record<string, PendingPairing> = {};
  for (const [entryCode, entry] of Object.entries(store.pending)) {
    if (entryCode !== normalized && entry.userId !== pending.userId) {
      pendingWithoutUser[entryCode] = entry;
    }
  }
  writePairingStore(projectRoot, {
    schemaVersion: 1,
    paired: { ...store.paired, [record.userId]: record },
    pending: pendingWithoutUser,
  });
  return record;
}

export function listPairings(projectRoot: string): PairingList {
  const store = readPairingStore(projectRoot);
  return {
    paired: Object.values(store.paired),
    pending: Object.values(store.pending),
  };
}

export function revokePairing(projectRoot: string, userId: string): boolean {
  const store = readPairingStore(projectRoot);
  const hadPaired = store.paired[userId] !== undefined;
  let hadPending = false;
  const pending: Record<string, PendingPairing> = {};
  for (const [code, entry] of Object.entries(store.pending)) {
    if (entry.userId === userId) {
      hadPending = true;
      continue;
    }
    pending[code] = entry;
  }
  if (!hadPaired && !hadPending) {
    return false;
  }
  const paired = { ...store.paired };
  delete paired[userId];
  writePairingStore(projectRoot, { schemaVersion: 1, paired, pending });
  return true;
}

export const list = listPairings;
export const revoke = revokePairing;

function normalizeStore(parsed: Partial<PairingDocument>): PairingDocument {
  const paired: Record<string, PairedSender> = {};
  if (parsed.paired !== undefined && typeof parsed.paired === "object") {
    for (const [userId, record] of Object.entries(parsed.paired)) {
      if (record !== null && typeof record === "object" && typeof record.userId === "string") {
        paired[userId] = record;
      }
    }
  }
  const pending: Record<string, PendingPairing> = {};
  if (parsed.pending !== undefined && typeof parsed.pending === "object") {
    for (const [code, record] of Object.entries(parsed.pending)) {
      if (record !== null && typeof record === "object" && typeof record.code === "string") {
        pending[code.toUpperCase()] = { ...record, code: record.code.toUpperCase() };
      }
    }
  }
  return { schemaVersion: 1, paired, pending };
}

function findPendingForUser(
  store: PairingDocument,
  userId: string,
  now: Date,
): PendingPairing | undefined {
  for (const pending of Object.values(store.pending)) {
    if (pending.userId === userId && Date.parse(pending.expiresAt) > now.getTime()) {
      return pending;
    }
  }
  return undefined;
}

function pruneExpiredPending(
  pending: Record<string, PendingPairing>,
  now: Date,
): Record<string, PendingPairing> {
  const kept: Record<string, PendingPairing> = {};
  for (const [code, entry] of Object.entries(pending)) {
    if (Date.parse(entry.expiresAt) > now.getTime()) {
      kept[code] = entry;
    }
  }
  return kept;
}

function omitPending(
  pending: Record<string, PendingPairing>,
  code: string,
): Record<string, PendingPairing> {
  const next = { ...pending };
  delete next[code];
  return next;
}

function uniqueCode(store: PairingDocument): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const code = generatePairingCode();
    if (store.pending[code] === undefined) {
      return code;
    }
  }
  return generatePairingCode();
}
