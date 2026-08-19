import type { InterfaceHealth } from "@useagentsio/interface-sdk";

export interface HostHealth {
  readonly ok: boolean;
  readonly ready: boolean;
  readonly pid: number;
  readonly projectId: string;
  readonly startedAt: string;
  readonly version: string;
  readonly activeConversations: number;
  readonly queuedTurns: number;
  readonly retainedSessions: number;
  readonly interfaces: Readonly<Record<string, InterfaceHealth>>;
  readonly lastFatalError?: string;
}

export interface HostStatusFile extends HostHealth {
  readonly schemaVersion: 1;
  readonly socketPath?: string;
  readonly ipcPort?: number;
}
