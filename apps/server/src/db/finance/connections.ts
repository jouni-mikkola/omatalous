/** The user's bank connections: the list, upserts and the status of one. */
import { type Connection, type Row, toConnection } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

export class ConnectionsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  async listConnections(): Promise<Connection[]> {
    return (await this.ctx.db.all<Row>("SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC", [this.ctx.userId])).map(toConnection);
  }

  async upsertConnection(c: Omit<Connection, "userId">): Promise<void> {
    await this.ctx.db.run(
      `INSERT INTO connections (id, user_id, provider, institution, country, status, valid_until, created_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, valid_until = excluded.valid_until
       WHERE connections.user_id = excluded.user_id`,
      [c.id, this.ctx.userId, c.provider, c.institution, c.country, c.status, c.validUntil, c.createdAt, c.lastSyncedAt],
    );
  }

  async setConnectionStatus(id: string, status: Connection["status"]): Promise<void> {
    await this.ctx.db.run("UPDATE connections SET status = ? WHERE id = ? AND user_id = ?", [status, id, this.ctx.userId]);
  }

  /** Removes a connection only while no account of this user names it. False when it was not removed. */
  async deleteConnectionWithoutAccounts(id: string): Promise<boolean> {
    const r = await this.ctx.db.run(
      "DELETE FROM connections WHERE id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = ? AND connection_id = ?)",
      [id, this.ctx.userId, this.ctx.userId, id],
    );
    return r.changes > 0;
  }

  async markConnectionSynced(id: string, at: string): Promise<void> {
    await this.ctx.db.run("UPDATE connections SET last_synced_at = ? WHERE id = ? AND user_id = ?", [at, id, this.ctx.userId]);
  }
}
