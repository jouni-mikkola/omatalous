/** Instance-wide key/value settings: data version, pending bank authorisations, locks. */
import type { Db } from "./types.ts";

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
   * Bumped after every change to transactions, accounts or shares. Cached
   * analysis results are keyed by it, so they are never stale.
   */
  async dataVersion(): Promise<string> {
    return (await this.get("data_version")) ?? "0";
  }

  async bumpDataVersion(): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('data_version', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at`,
      [new Date().toISOString()],
    );
  }
}
