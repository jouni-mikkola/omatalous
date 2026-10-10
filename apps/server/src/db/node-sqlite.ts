import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { UserError } from "../platform/errors.ts";
import type { Db, SqlValue, Statement } from "./types.ts";

const SQLITE_BUSY = 5;
const SQLITE_FULL = 13;

export interface OpenOptions {
  /** How long a statement waits for another writer. Tests shorten it. */
  busyTimeoutMs?: number;
}

/**
 * A full disk and a busy database become a Finnish message for the browser and one clear English log
 * line for the admin (docker compose logs, doctor.sh). Anything else is returned unchanged and ends as a
 * generic 500.
 */
export function translateSqliteError(err: unknown): unknown {
  const code = (err as { errcode?: number } | null)?.errcode;
  if (code === SQLITE_FULL) {
    console.error("database write failed: the disk is full (SQLITE_FULL). Free space on the data volume, nothing was changed.");
    return new UserError("Levy on täynnä, tietoja ei voitu tallentaa. Ylläpitäjän pitää vapauttaa tilaa.");
  }
  if (code === SQLITE_BUSY) {
    console.error("database write failed: the database stayed locked for the whole wait (SQLITE_BUSY). Another process holds it.");
    return new UserError("Tietokanta on varattu. Yritä hetken päästä uudelleen.");
  }
  return err;
}

export function openNodeSqlite(path: string, opts: OpenOptions = {}): Db & { exec(sql: string): void; close(): void } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // synchronous = FULL stays: a committed write must survive a power loss. The cache, temp store and
  // memory map only make repeated scans of a large history cheaper; the journal limit stops the WAL file
  // from staying at its largest size after a big import.
  db.exec(
    `PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${Math.trunc(opts.busyTimeoutMs ?? 5000)}; PRAGMA secure_delete = ON;
     PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 268435456; PRAGMA journal_size_limit = 67108864;`,
  );
  const args = (params: SqlValue[] = []) => params as SQLInputValue[];
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      throw translateSqliteError(err);
    }
  };

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return guard(() => db.prepare(sql).all(...args(params)) as T[]);
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return guard(() => (db.prepare(sql).get(...args(params)) as T | undefined) ?? null);
    },
    async run(sql: string, params?: SqlValue[]) {
      return guard(() => ({ changes: Number(db.prepare(sql).run(...args(params)).changes) }));
    },
    async batch(statements: Statement[]) {
      guard(() => {
        db.exec("BEGIN");
        try {
          // a sync or reprocess repeats the same statement thousands of times
          const prepared = new Map<string, ReturnType<typeof db.prepare>>();
          for (const s of statements) {
            let stmt = prepared.get(s.sql);
            if (!stmt) prepared.set(s.sql, (stmt = db.prepare(s.sql)));
            stmt.run(...args(s.params));
          }
          db.exec("COMMIT");
        } catch (err) {
          // SQLite has already rolled back after a full disk or an I/O error, and then ROLLBACK itself
          // fails. That second error must not replace the real one.
          try {
            db.exec("ROLLBACK");
          } catch {
            // no transaction is active any more
          }
          throw err;
        }
      });
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
