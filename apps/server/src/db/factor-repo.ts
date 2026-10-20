/** Second sign-in factors (migration 0021, table user_factor): one authenticator secret and recovery code hashes per user. */
import { randomToken } from "../platform/ids.ts";
import type { Row } from "./rows.ts";
import type { Db, Statement } from "./types.ts";

interface TotpFactor {
  id: string;
  /** Sealed with the server's key (security/secretbox.ts), never the plain secret. */
  sealed: string;
  lastStep: number | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export class FactorRepo {
  constructor(private readonly db: Db) {}

  async totp(userId: string): Promise<TotpFactor | null> {
    const r = await this.db.first<Row>("SELECT id, secret, last_step, created_at, last_used_at FROM user_factor WHERE user_id = ? AND kind = 'totp'", [userId]);
    if (!r) return null;
    return {
      id: String(r.id),
      sealed: String(r.secret),
      lastStep: r.last_step === null ? null : Number(r.last_step),
      createdAt: String(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : String(r.last_used_at),
    };
  }

  async hasTotp(userId: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS x FROM user_factor WHERE user_id = ? AND kind = 'totp'", [userId])) !== null;
  }

  async recoveryLeft(userId: string): Promise<number> {
    return Number((await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM user_factor WHERE user_id = ? AND kind = 'recovery'", [userId]))?.c ?? 0);
  }

  private recoveryRows(userId: string, hashes: string[], now: string): Statement[] {
    return hashes.map((hash) => ({
      sql: "INSERT INTO user_factor (id, user_id, kind, secret, label, last_step, created_at, last_used_at) VALUES (?, ?, 'recovery', ?, NULL, NULL, ?, NULL)",
      params: [randomToken(), userId, hash, now],
    }));
  }

  /** The factor and its recovery codes in one transaction; whatever the user had before is gone. `step` is the code that confirmed it. */
  async enable(userId: string, sealed: string, step: number, hashes: string[], now: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'recovery')", params: [userId] },
      {
        sql: "INSERT INTO user_factor (id, user_id, kind, secret, label, last_step, created_at, last_used_at) VALUES (?, ?, 'totp', ?, NULL, ?, ?, ?)",
        params: [randomToken(), userId, sealed, step, now, now],
      },
      ...this.recoveryRows(userId, hashes, now),
    ]);
  }

  async replaceRecovery(userId: string, hashes: string[], now: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM user_factor WHERE user_id = ? AND kind = 'recovery'", params: [userId] }, ...this.recoveryRows(userId, hashes, now)]);
  }

  /** Takes a step in one statement: false when it was no later than the last one, so two requests with one code cannot both pass. */
  async useStep(id: string, step: number, now: string): Promise<boolean> {
    const r = await this.db.run("UPDATE user_factor SET last_step = ?, last_used_at = ? WHERE id = ? AND (last_step IS NULL OR last_step < ?)", [step, now, id, step]);
    return r.changes > 0;
  }

  /** Deletes the code's row: false when there was none (never made, or used already). */
  async useRecovery(userId: string, hash: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM user_factor WHERE user_id = ? AND kind = 'recovery' AND secret = ?", [userId, hash])).changes > 0;
  }

  async removeAll(userId: string): Promise<void> {
    await this.db.run("DELETE FROM user_factor WHERE user_id = ? AND kind IN ('totp', 'recovery')", [userId]);
  }

  /** Every sealed secret, for the rotation of the server's key (services/secret-rotation.ts). */
  async allSealed(): Promise<{ id: string; userId: string; sealed: string }[]> {
    return (await this.db.all<Row>("SELECT id, user_id, secret FROM user_factor WHERE kind = 'totp'")).map((r) => ({ id: String(r.id), userId: String(r.user_id), sealed: String(r.secret) }));
  }
}
