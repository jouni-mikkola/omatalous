/** Users, sessions and per-user bank credentials. */
import { type Role, type Row, toUser, type User } from "./rows.ts";
import { bumpDataVersionStatement } from "./settings-repo.ts";
import type { Db, SqlValue } from "./types.ts";

export interface SessionInfo {
  /** First 20 characters of the stored id: enough to pick one session, useless as a credential. */
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
}

export interface SessionRecord {
  userId: string;
  expiresAt: string;
  lastSeenAt: string;
}

export class UsersRepo {
  constructor(private readonly db: Db) {}

  async count(): Promise<number> {
    return Number((await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM users"))?.c ?? 0);
  }

  async list(): Promise<User[]> {
    return (await this.db.all<Row>("SELECT * FROM users ORDER BY created_at")).map(toUser);
  }

  async get(id: string): Promise<User | null> {
    const r = await this.db.first<Row>("SELECT * FROM users WHERE id = ?", [id]);
    return r ? toUser(r) : null;
  }

  /** User plus password hash, for login only. */
  async findForLogin(username: string): Promise<(User & { passwordHash: string }) | null> {
    const r = await this.db.first<Row>("SELECT * FROM users WHERE username = ?", [username.trim()]);
    return r ? { ...toUser(r), passwordHash: String(r.password_hash) } : null;
  }

  async create(u: { id: string; username: string; displayName: string; passwordHash: string; role: Role; mustChangePassword: boolean }): Promise<void> {
    await this.db.run(
      "INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [u.id, u.username.trim(), u.displayName.trim(), u.passwordHash, u.role, u.mustChangePassword ? 1 : 0, new Date().toISOString()],
    );
  }

  /** Inserts the user only while the table is empty, in one statement, so two setup calls cannot both win. */
  async createIfNoUsers(u: { id: string; username: string; displayName: string; passwordHash: string }): Promise<boolean> {
    const r = await this.db.run(
      `INSERT INTO users (id, username, display_name, password_hash, role, must_change_password, created_at)
       SELECT ?, ?, ?, ?, 'admin', 0, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
      [u.id, u.username.trim(), u.displayName.trim(), u.passwordHash, new Date().toISOString()],
    );
    return r.changes > 0;
  }

  async setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
    await this.db.run("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?", [passwordHash, mustChange ? 1 : 0, id]);
  }

  async update(id: string, patch: { displayName?: string; role?: Role }): Promise<void> {
    await this.db.run("UPDATE users SET display_name = COALESCE(?, display_name), role = COALESCE(?, role) WHERE id = ?", [
      patch.displayName?.trim() || null,
      patch.role ?? null,
      id,
    ]);
  }

  /**
   * After a member is removed: rewrites the file so their rows do not stay in free pages, and
   * empties the write-ahead log. (secure_delete is on for every connection, see node-sqlite.ts.)
   */
  async compact(): Promise<void> {
    await this.db.first("PRAGMA wal_checkpoint(TRUNCATE)");
    await this.db.run("VACUUM");
    await this.db.first("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /** The file of the open database, as SQLite names it. Null for a database in memory. */
  async databaseFile(): Promise<string | null> {
    const main = (await this.db.all<{ name: string; file: string | null }>("PRAGMA database_list")).find((d) => d.name === "main");
    return main?.file || null;
  }

  /**
   * Starting over (services/reset.ts): one transaction deletes every user, and through ON DELETE CASCADE all of
   * their data, and inserts the row of the admin `keepId` again as it was read, every column of it. With the users
   * go the rows that no cascade reaches. Returns false, with nothing changed, when `keepId` is not an admin now.
   */
  async deleteAllBut(keepId: string, at: string): Promise<boolean> {
    const row = await this.db.first<Record<string, SqlValue>>("SELECT * FROM users WHERE id = ?", [keepId]);
    if (!row || row.role !== "admin") return false;
    const columns = Object.keys(row);
    const quoted = (column: string) => `"${column.replace(/"/g, '""')}"`;
    await this.db.batch([
      // a settings row of one user holds that user's id in its key (data_version:<id>, sync_lock:<id>, ...)
      { sql: "DELETE FROM settings WHERE EXISTS (SELECT 1 FROM users u WHERE instr(settings.key, u.id) > 0)" },
      // events without a user do not cascade and may name a member (user_deleted); the maintenance log stays
      { sql: "DELETE FROM security_events WHERE user_id IS NULL AND kind NOT LIKE 'ops!_%' ESCAPE '!'" },
      // a payee the register did not find as one company may be a person; a company's public record stays
      { sql: "DELETE FROM merchant_industry WHERE status <> 'found'" },
      { sql: "DELETE FROM users" },
      { sql: `INSERT INTO users (${columns.map(quoted).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, params: columns.map((c) => row[c] ?? null) },
      bumpDataVersionStatement(at),
    ]);
    return true;
  }

  async countAdmins(): Promise<number> {
    return Number((await this.db.first<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'"))?.c ?? 0);
  }

  // ── sessions (id = SHA-256 of the cookie token) ─────────
  async createSession(id: string, userId: string, expiresAt: string, userAgent: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)", [
      id,
      userId,
      now,
      expiresAt,
      now,
      userAgent?.slice(0, 200) ?? null,
    ]);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const r = await this.db.first<Row>("SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = ?", [id]);
    return r ? { userId: String(r.user_id), expiresAt: String(r.expires_at), lastSeenAt: String(r.last_seen_at) } : null;
  }

  async touchSession(id: string, expiresAt: string): Promise<void> {
    await this.db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [new Date().toISOString(), expiresAt, id]);
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  /** Signs the user out everywhere (password change, reset, removal). */
  async deleteSessionsOf(userId: string, exceptId?: string): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [userId, exceptId ?? ""]);
  }

  async listSessions(userId: string, currentId: string | undefined): Promise<SessionInfo[]> {
    return (await this.db.all<Row>("SELECT id, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC", [userId])).map((r) => ({
      id: String(r.id).slice(0, 20),
      createdAt: String(r.created_at),
      lastSeenAt: String(r.last_seen_at),
      userAgent: r.user_agent === null ? null : String(r.user_agent),
      current: String(r.id) === currentId,
    }));
  }

  /** Ends one of the user's own sessions by its short id; false when there is none. */
  async deleteSessionByShortId(userId: string, shortId: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 20) = ?", [userId, shortId])).changes > 0;
  }

  /** Every session of every user (CLI: sessions revoke-all). */
  async deleteAllSessions(): Promise<number> {
    return (await this.db.run("DELETE FROM sessions")).changes;
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
  }

  // ── a user's own Enable Banking application ─────────────
  async getBankCredentials(userId: string): Promise<{ appId: string; privateKeyEnc: string } | null> {
    const r = await this.db.first<Row>("SELECT app_id, private_key_enc FROM bank_credentials WHERE user_id = ?", [userId]);
    return r ? { appId: String(r.app_id), privateKeyEnc: String(r.private_key_enc) } : null;
  }

  /** Every user's sealed key, for re-sealing under a new app secret. */
  async allBankCredentials(): Promise<{ userId: string; privateKeyEnc: string }[]> {
    return (await this.db.all<Row>("SELECT user_id, private_key_enc FROM bank_credentials")).map((r) => ({ userId: String(r.user_id), privateKeyEnc: String(r.private_key_enc) }));
  }

  async setBankCredentials(userId: string, appId: string, privateKeyEnc: string): Promise<void> {
    await this.db.run(
      `INSERT INTO bank_credentials (user_id, app_id, private_key_enc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET app_id = excluded.app_id, private_key_enc = excluded.private_key_enc, updated_at = excluded.updated_at`,
      [userId, appId, privateKeyEnc, new Date().toISOString()],
    );
  }

  async deleteBankCredentials(userId: string): Promise<void> {
    await this.db.run("DELETE FROM bank_credentials WHERE user_id = ?", [userId]);
  }

  /** Users that have at least one active bank consent (for the scheduler). */
  async usersWithActiveConnections(): Promise<string[]> {
    return (await this.db.all<{ user_id: string }>("SELECT DISTINCT user_id FROM connections WHERE status = 'active'")).map((r) => r.user_id);
  }
}
