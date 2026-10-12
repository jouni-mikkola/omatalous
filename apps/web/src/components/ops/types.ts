export type OpsAction = "update" | "rollback" | "backup" | "restart" | "doctor" | "check-update" | "logs" | "prune" | "helper-renew" | "access";

export interface OpsRequestView {
  id: string;
  action: string;
  label: string;
  status: "queued" | "running" | "ok" | "failed" | "expired" | "cancelled";
  by: string | null;
  requestedAt: string;
  finishedAt: string | null;
  summary: string | null;
  output: string | null;
  steps: { n: number; m: number; text: string }[];
}

export interface DoctorItem {
  id: string;
  level: "ok" | "warn" | "error";
  title: string;
  detail: string;
  hint: string;
}

export interface Backup {
  name: string;
  size: number;
  at: string;
  kind: string;
}

export interface OpsSnapshot {
  version?: string;
  build?: string;
  commit?: string;
  update_available?: boolean;
  behind_commits?: { hash: string; subject: string }[];
  checked_at?: string;
  can_rollback?: boolean;
  schema_changed?: boolean;
  mode?: string;
  port?: number;
  address?: string;
  doctor?: { at: string; items: DoctorItem[] };
  backups?: Backup[];
}

export interface HelperInfo {
  status: "ok" | "slow" | "off";
  reason: "never" | "stale" | null;
  seenAt: string | null;
  version: string | null;
  outdated: boolean;
  /** The helper knows logs, prune and helper-renew. */
  tools: boolean;
  enableCommand: string;
}

export interface OpsState {
  version: string;
  build: string;
  helper: HelperInfo;
  state: OpsSnapshot;
  appBackups: Backup[];
  requests: OpsRequestView[];
  active: boolean;
  readOnlyActive: boolean;
  now: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  username: string | null;
  ip: string | null;
  action: string;
  outcome: string;
}
