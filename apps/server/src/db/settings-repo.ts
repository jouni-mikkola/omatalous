/** Instance-wide key/value settings: data version, pending bank authorisations, locks. */
import type { Db, Statement } from "./types.ts";

/** Set while a user's imported rows still wait for their categories and transfer flags (services/enrich.ts). */
export const NEEDS_REPROCESS = "needs_reprocess:";

/** The data version bump as a statement, so it can be part of a batch that changes rows. */
export function bumpDataVersionStatement(at: string): Statement {
  return {
    sql: `INSERT INTO settings (key, value, updated_at) VALUES ('data_version', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
    params: [at],
  };
}

/** Prefix of the per-user data version keys (`data_version:<user id>`). */
export const USER_DATA_VERSION = "data_version:";

/** One user's data version bump as a statement: that user's transactions, accounts or rules changed. */
export function bumpUserDataVersionStatement(userId: string, at: string): Statement {
  return {
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
    params: [`${USER_DATA_VERSION}${userId}`, at],
  };
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | null> {
    return (await this.db.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]))?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, value, new Date().toISOString()],
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.run("DELETE FROM settings WHERE key = ?", [key]);
  }

  /** Sets `key` to `value` unless it already has that value; true when this call changed it. */
  async claim(key: string, value: string): Promise<boolean> {
    const r = await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE settings.value != excluded.value`,
      [key, value, new Date().toISOString()],
    );
    return r.changes > 0;
  }

  /** Removes rows whose key starts with `prefix` and that were last written before `before`. */
  async deleteOlder(prefix: string, before: Date): Promise<void> {
    await this.db.run("DELETE FROM settings WHERE substr(key, 1, ?) = ? AND updated_at < ?", [prefix.length, prefix, before.toISOString()]);
  }

  /** Atomically claims `key` unless someone holds it and it is younger than `ttlMs`. */
  async tryLock(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const r = await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE CAST(settings.value AS INTEGER) < ?`,
      [key, String(now), new Date(now).toISOString(), now - ttlMs],
    );
    return r.changes > 0;
  }

  /**
   * The instance-wide data version: bumped for changes that touch everyone (a member removed). A change to one
   * member's own data bumps only that member's version (`bumpUserDataVersion`), so it does not drop the others'
   * cached analyses.
   */
  async dataVersion(): Promise<string> {
    return (await this.get("data_version")) ?? "0";
  }

  /**
   * What a cached analysis is keyed by: the instance version and the versions of the users whose rows it
   * contains (the user, and the owners of the shared accounts in view).
   */
  async dataVersionOf(userIds: readonly string[]): Promise<string> {
    const ids = [...new Set(userIds)].sort();
    const keys = ["data_version", ...ids.map((id) => `${USER_DATA_VERSION}${id}`)];
    const rows = await this.db.all<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`, keys);
    const value = new Map(rows.map((r) => [r.key, r.value]));
    return keys.map((k) => value.get(k) ?? "0").join(".");
  }

  async bumpUserDataVersion(userId: string): Promise<void> {
    const { sql, params } = bumpUserDataVersionStatement(userId, new Date().toISOString());
    await this.db.run(sql, params);
  }

  async bumpDataVersion(): Promise<void> {
    const { sql, params } = bumpDataVersionStatement(new Date().toISOString());
    await this.db.run(sql, params);
  }

  /** Keys that start with `prefix`. */
  async keysWithPrefix(prefix: string): Promise<string[]> {
    return (await this.db.all<{ key: string }>("SELECT key FROM settings WHERE substr(key, 1, ?) = ?", [prefix.length, prefix])).map((r) => r.key);
  }

  /** Removes the lock rows (`upgrade_lock`, `sync_lock:*`) written before `before`: the process that took them is gone. */
  async clearLocksBefore(before: Date): Promise<string[]> {
    const rows = await this.db.all<{ key: string }>(
      "SELECT key FROM settings WHERE (key = 'upgrade_lock' OR substr(key, 1, 10) = 'sync_lock:') AND updated_at < ?",
      [before.toISOString()],
    );
    for (const r of rows) await this.delete(r.key);
    return rows.map((r) => r.key);
  }
}
