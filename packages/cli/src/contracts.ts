import type { InterfaceHealth } from "./internal/interfaces/sdk/index.js";

export interface ProjectRegistryEntry {
  readonly projectId: string;
  readonly path: string;
  readonly registeredAt: string;
}

export type ProjectDashboardState =
  | "running"
  | "starting"
  | "stopped"
  | "unhealthy"
  | "missing"
  | "invalid";

export interface ProjectDashboardProject extends ProjectRegistryEntry {
  readonly name?: string;
  readonly state: ProjectDashboardState;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly defaultAgent?: string;
  readonly agentBindings: readonly string[];
  readonly provider?: string;
  readonly model?: string;
  readonly interfaces: Readonly<Record<string, InterfaceHealth & { readonly definition?: string }>>;
  readonly pairings?: ProjectPairings;
  readonly activeConversations: number;
  readonly queuedTurns: number;
  readonly lastFatalError?: string;
  readonly error?: string;
}

export interface ProjectPairingSender {
  readonly userId: string;
  readonly displayName?: string;
  readonly pairedAt?: string;
}

export interface ProjectPendingPairing {
  readonly code: string;
  readonly userId: string;
  readonly displayName?: string;
  readonly expiresAt: string;
}

export interface ProjectPairings {
  readonly owner?: ProjectPairingSender;
  readonly paired: readonly ProjectPairingSender[];
  readonly pending: readonly ProjectPendingPairing[];
}

export interface ProjectDashboardSnapshot {
  readonly generatedAt: string;
  readonly projects: readonly ProjectDashboardProject[];
  readonly counts: Readonly<Record<ProjectDashboardState, number>>;
}

export interface ProjectLifecycleResult {
  readonly projectId: string;
  readonly action: "start" | "stop" | "restart" | "open";
  readonly ok: boolean;
  readonly state: ProjectDashboardState;
  readonly pid?: number;
  readonly error?: string;
}

export interface GatewayStatus {
  readonly ok: boolean;
  readonly pid: number;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly startedAt: string;
  readonly projectCount: number;
}
