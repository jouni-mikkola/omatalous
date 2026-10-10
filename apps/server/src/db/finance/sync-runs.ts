/** The user's fetch history: one row per run, kept to the newest 200. */
import { type Row, type SyncRun, toSyncRun } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class SyncRunsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  async startSyncRun(trigger: string): Promise<number> {
    const r = await this.ctx.db.first<{ id: number }>(
      "INSERT INTO sync_runs (user_id, trigger, started_at, status) VALUES (?, ?, ?, 'running') RETURNING id",
      [this.ctx.userId, trigger, new Date().toISOString()],
    );
    return Number(r?.id);
  }

  async finishSyncRun(id: number, r: Pick<SyncRun, "status" | "fetched" | "inserted" | "message">): Promise<void> {
    await this.ctx.db.run("UPDATE sync_runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, message = ? WHERE id = ? AND user_id = ?", [
      new Date().toISOString(),
      r.status,
      r.fetched,
      r.inserted,
      r.message,
      id,
      this.ctx.userId,
    ]);
  }

  /** Runs a killed process left as "running" end as failed; the header must not show their start as a success. */
  async failInterruptedSyncRuns(): Promise<number> {
    const r = await this.ctx.db.run(
      "UPDATE sync_runs SET status = 'failed', finished_at = ?, message = 'Haku keskeytyi, palvelin käynnistyi uudelleen.' WHERE user_id = ? AND status = 'running'",
      [new Date().toISOString(), this.ctx.userId],
    );
    return r.changes;
  }

  /** Keeps the newest `keep` runs of this user. */
  async pruneSyncRuns(keep = 200): Promise<void> {
    await this.ctx.db.run("DELETE FROM sync_runs WHERE user_id = ? AND id NOT IN (SELECT id FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?)", [this.ctx.userId, this.ctx.userId, keep]);
  }

  async listSyncRuns(limit = 20): Promise<SyncRun[]> {
    return (await this.ctx.db.all<Row>("SELECT * FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?", [this.ctx.userId, limit])).map(toSyncRun);
  }
}
