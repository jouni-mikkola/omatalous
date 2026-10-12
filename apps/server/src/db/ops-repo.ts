/** Maintenance requests (migration 0006). Instance-wide, no financial rows. */
import { type Row, str } from "./rows.ts";
import type { Db } from "./types.ts";

export type OpsStatus = "queued" | "running" | "ok" | "failed" | "expired" | "cancelled";

export interface OpsRequest {
  id: string;
  action: string;
  params: string;
  status: OpsStatus;
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  summary: string | null;
  output: string | null;
  steps: string | null;
}

const toRequest = (r: Row): OpsRequest => ({
  id: String(r.id),
  action: String(r.action),
  params: String(r.params),
  status: String(r.status) as OpsStatus,
  requestedBy: String(r.requested_by),
  requestedByName: str(r.username),
  requestedAt: String(r.requested_at),
  claimedAt: str(r.claimed_at),
  finishedAt: str(r.finished_at),
  exitCode: r.exit_code == null ? null : Number(r.exit_code),
  summary: str(r.summary),
  output: str(r.output),
  steps: str(r.steps),
});

const marks = (list: readonly unknown[]): string => list.map(() => "?").join(",");

const SELECT = "SELECT r.*, u.username AS username FROM ops_requests r LEFT JOIN users u ON u.id = r.requested_by";

export interface Finish {
  status: "ok" | "failed" | "expired" | "cancelled";
  at: string;
  exitCode?: number | null;
  summary?: string | null;
  output?: string | null;
  steps?: string | null;
}

export class OpsRepo {
  constructor(private readonly db: Db) {}

  /** False when another mutating request is queued or running (unique index). */
  async insert(r: { id: string; action: string; requestedBy: string; at: string }): Promise<boolean> {
    try {
      await this.db.run("INSERT INTO ops_requests (id, action, params, requested_by, requested_at) VALUES (?, ?, '{}', ?, ?)", [r.id, r.action, r.requestedBy, r.at]);
      return true;
    } catch (err) {
      if (/UNIQUE constraint failed/i.test((err as Error).message)) return false;
      throw err;
    }
  }

  /** `readOnly` is the one list of actions that may run beside another request (READ_ONLY in services/ops-validate.ts). */
  async hasActiveMutating(readOnly: readonly string[]): Promise<boolean> {
    return !!(await this.db.first(`SELECT 1 AS x FROM ops_requests WHERE status IN ('queued','running') AND action NOT IN (${marks(readOnly)}) LIMIT 1`, [...readOnly]));
  }

  async get(id: string): Promise<OpsRequest | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE r.id = ?`, [id]);
    return r ? toRequest(r) : null;
  }

  async recent(limit: number): Promise<OpsRequest[]> {
    return (await this.db.all<Row>(`${SELECT} ORDER BY r.requested_at DESC, r.rowid DESC LIMIT ?`, [limit])).map(toRequest);
  }

  /** Requests made since `since`, leaving out the actions in `excluding` (the read-only ones, to count mutating requests). */
  async countSince(since: string, excluding: readonly string[] = []): Promise<number> {
    const r = await this.db.first<{ c: number }>(`SELECT COUNT(*) AS c FROM ops_requests WHERE requested_at > ?${excluding.length ? ` AND action NOT IN (${marks(excluding)})` : ""}`, [since, ...excluding]);
    return Number(r?.c ?? 0);
  }

  /** Queued rows requested before `before`. */
  async queuedBefore(before: string): Promise<OpsRequest[]> {
    return (await this.db.all<Row>(`${SELECT} WHERE r.status = 'queued' AND r.requested_at < ?`, [before])).map(toRequest);
  }

  /** Running rows claimed before `before` that never got a report. */
  async runningBefore(before: string): Promise<OpsRequest[]> {
    return (await this.db.all<Row>(`${SELECT} WHERE r.status = 'running' AND r.claimed_at < ?`, [before])).map(toRequest);
  }

  /** The oldest queued row whose id is not in `skip`. */
  async oldestQueued(skip: readonly string[]): Promise<OpsRequest | null> {
    const marks = skip.map(() => "?").join(",");
    const r = await this.db.first<Row>(`${SELECT} WHERE r.status = 'queued'${skip.length ? ` AND r.id NOT IN (${marks})` : ""} ORDER BY r.requested_at, r.rowid LIMIT 1`, [...skip]);
    return r ? toRequest(r) : null;
  }

  /** Queued rows the helper's journal says were already handled (a restored database brings them back). */
  async queuedIn(ids: readonly string[]): Promise<OpsRequest[]> {
    if (!ids.length) return [];
    return (await this.db.all<Row>(`${SELECT} WHERE r.status = 'queued' AND r.id IN (${ids.map(() => "?").join(",")})`, [...ids])).map(toRequest);
  }

  /** True for the one caller that moves the row from queued to running. The sealed secret goes with it. */
  async claim(id: string, at: string): Promise<boolean> {
    const r = await this.db.run("UPDATE ops_requests SET status = 'running', claimed_at = ?, secret_sealed = NULL WHERE id = ? AND status = 'queued'", [at, id]);
    return r.changes > 0;
  }

  /**
   * Ends a queued or running row. A row the app gave up on after 30 minutes ("Ei vastausta") still takes
   * the helper's late report. Returns false when the row is unknown or already finished (a repeated report).
   */
  async finish(id: string, f: Finish): Promise<boolean> {
    const r = await this.db.run(
      `UPDATE ops_requests SET status = ?, finished_at = ?, exit_code = ?, summary = ?, output = ?, steps = ?, secret_sealed = NULL
       WHERE id = ? AND (status IN ('queued','running') OR (status = 'failed' AND claimed_at IS NOT NULL AND exit_code IS NULL AND output IS NULL))`,
      [f.status, f.at, f.exitCode ?? null, f.summary ?? null, f.output ?? null, f.steps ?? null, id],
    );
    return r.changes > 0;
  }

  async cancelQueued(id: string, at: string): Promise<boolean> {
    const r = await this.db.run("UPDATE ops_requests SET status = 'cancelled', finished_at = ?, summary = 'Peruutettu', secret_sealed = NULL WHERE id = ? AND status = 'queued'", [at, id]);
    return r.changes > 0;
  }

  /** Keeps the newest `keep` finished rows. */
  async prune(keep: number): Promise<void> {
    await this.db.run(
      "DELETE FROM ops_requests WHERE status NOT IN ('queued','running') AND rowid <= (SELECT rowid FROM ops_requests ORDER BY rowid DESC LIMIT 1 OFFSET ?)",
      [keep],
    );
  }
}
