/**
 * Checks of database files that are not the live database: copies the app makes (daily, before a migration,
 * before an update), downloads, and a file offered to `restore`. A copy nobody has opened is not a backup.
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Tables every database of this app has, whatever its version. A copy without them is not ours or is damaged. */
const REQUIRED_TABLES = ["_migrations", "users", "accounts", "transactions", "settings"] as const;

/** One page is 512 bytes at the least. A real copy holds the schema, so it is always larger than this. */
const MIN_BYTES = 4096;
const MAGIC = "SQLite format 3\u0000";

/**
 * A look at the file header only: not empty, a SQLite file, not cut short. Cheap enough for a listing of
 * every copy. Returns the reason, or null when the file looks complete.
 */
export function quickFileCheck(file: string): string | null {
  let size: number;
  try {
    size = statSync(file).size;
  } catch (err) {
    return `cannot read the file (${(err as NodeJS.ErrnoException).code ?? "error"})`;
  }
  if (size === 0) return "the file is empty";
  if (size < MIN_BYTES) return `the file is only ${size} bytes`;
  const head = Buffer.alloc(100);
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    if (readSync(fd, head, 0, 100, 0) < 100) return "the file is cut short";
  } catch (err) {
    return `cannot read the file (${(err as NodeJS.ErrnoException).code ?? "error"})`;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (head.toString("latin1", 0, 16) !== MAGIC) return "not a SQLite database file";
  const pageSize = head.readUInt16BE(16) === 1 ? 65536 : head.readUInt16BE(16);
  const pages = head.readUInt32BE(28);
  // the page count in the header only counts when it is current (change counter equals version-valid-for)
  if (pages > 0 && head.readUInt32BE(24) === head.readUInt32BE(92) && size < pages * pageSize) {
    return `the file is cut short (${size} of ${pages * pageSize} bytes)`;
  }
  return null;
}

export type FileCheck = { ok: true; users: number; migrations: number } | { ok: false; reason: string };

/**
 * The full check: header, `PRAGMA quick_check` (0.3 s for 330 000 rows) and the tables of this app. Opens
 * the file read-only, so a copy is not changed and no -wal or -shm file is left beside it.
 */
export function verifyDatabaseFile(file: string): FileCheck {
  const head = quickFileCheck(file);
  if (head) return { ok: false, reason: head };
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const check = db.prepare("PRAGMA quick_check(5)").all() as { quick_check: string }[];
    if (check.length !== 1 || check[0]!.quick_check !== "ok") return { ok: false, reason: `the integrity check failed: ${check.map((r) => r.quick_check).join("; ").slice(0, 200)}` };
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) return { ok: false, reason: `tables are missing: ${missing.join(", ")}` };
    const users = Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n);
    const migrations = Number((db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number }).n);
    return { ok: true, users, migrations };
  } catch (err) {
    return { ok: false, reason: `cannot be opened as a database: ${(err as Error).message.slice(0, 200)}` };
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
}

/**
 * The weekly check of a copy (services/db-health.ts): integrity_check, and how many rows break a foreign key.
 * Read-only, and closed before it returns: on a 200 MB copy the two take about 1.4 s, during which this process
 * answers nothing else.
 */
export function deepFileCheck(file: string): { broken: string | null; orphans: number } {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("PRAGMA integrity_check(5)").all() as { integrity_check: string }[];
    if (rows.length !== 1 || rows[0]!.integrity_check !== "ok") return { broken: `integrity_check: ${rows.map((r) => r.integrity_check).join("; ").slice(0, 200)}`, orphans: 0 };
    return { broken: null, orphans: db.prepare("PRAGMA foreign_key_check").all().length };
  } catch (err) {
    return { broken: `cannot be read as a database: ${(err as Error).message.slice(0, 200)}`, orphans: 0 };
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
}
