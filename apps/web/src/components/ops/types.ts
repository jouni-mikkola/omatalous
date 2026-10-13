export type OpsAction = "update" | "rollback" | "backup" | "restart" | "doctor" | "check-update" | "logs" | "prune" | "helper-renew" | "access" | "prerelease-on" | "prerelease-off";

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
  /** Where the switch for new versions stands on the host. Absent until a helper that knows it has reported. */
  prerelease?: "yes" | "no";
  /** `source`: the install follows a branch, so there is no switch. */
  channel?: "source" | "release";
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
  /** The helper knows prerelease-on and prerelease-off. */
  knowsPrerelease: boolean;
  /** The helper waits for the app's wake and starts a request within seconds. */
  wakes: boolean;
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

/** `GET /api/ops/restore-latest`: the copy a restore would take now, and whether a restore already waits for the start. */
export interface RestoreCopy {
  name: string;
  at: string;
  size: number;
  /** What the copy is, as in the list of copies. `pre-reset`: a reset made it first, and restoring it undoes the reset. */
  kind: string;
}

export interface RestoreState {
  copy: RestoreCopy | null;
  pending: boolean;
}

/** `POST /api/ops/reset`, 200. `failed` counts bank connections the bank did not end; they run out at the bank. */
export interface ResetResult {
  ok: true;
  copy: string;
  revoked: number;
  failed: number;
  message: string;
}
