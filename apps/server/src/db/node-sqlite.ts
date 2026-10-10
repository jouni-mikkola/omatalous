import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, SqlValue, Statement } from "./types.ts";

export function openNodeSqlite(path: string): Db & { exec(sql: string): void; close(): void } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;");
  const args = (params: SqlValue[] = []) => params as SQLInputValue[];

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      return db.prepare(sql).all(...args(params)) as T[];
    },
    async first<T>(sql: string, params?: SqlValue[]) {
      return (db.prepare(sql).get(...args(params)) as T | undefined) ?? null;
    },
    async run(sql: string, params?: SqlValue[]) {
      const r = db.prepare(sql).run(...args(params));
      return { changes: Number(r.changes) };
    },
    async batch(statements: Statement[]) {
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
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
