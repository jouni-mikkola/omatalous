/**
 * `node dist/node.js restore <file>`: puts a database copy in place of the live database.
 *
 * Order, so that a bad file never costs the data that is there:
 *   1. the file must be in the data folder and pass the full check (size, quick_check, this app's tables,
 *      no migration this build does not know)
 *   2. the current database is copied to backups/pre-restore-<time>.db (whatever state it is in)
 *   3. the file is copied next to the database, flushed and checked again
 *   4. only then the old -wal and -shm files go and the copy is renamed over banking.db
 * Runs without opening the live database through openDatabase, so it also works on an empty or damaged one.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fsyncDir, fsyncFile } from "../durable.ts";
import { verifyDatabaseFile } from "./backup-check.ts";
import { findMigrationsDir, readMigrations } from "./open.ts";

export class RestoreError extends Error {}

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
}

/** A copy of what is in banking.db now. A consistent VACUUM INTO when the database opens, else the raw files. */
function savePrevious(dbPath: string, dest: string): string {
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  rmSync(dest, { force: true });
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    db.close();
    db = undefined;
    if (verifyDatabaseFile(dest).ok) return dest;
  } catch {
    // damaged or locked: fall through to the raw copy
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
  rmSync(dest, { force: true });
  copyFileSync(dbPath, dest);
  if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${dest}-wal`);
  return dest;
}

export function restoreDatabase(dbPath: string, input: string, now: Date, migrationsDir?: string): string[] {
  const dataDir = resolve(dirname(dbPath));
  const source = resolve(dataDir, input);
  let real: string;
  try {
    if (!lstatSync(source).isFile()) throw new RestoreError(`${source} is not a regular file.`);
    real = realpathSync(source);
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`${source} cannot be read (${(err as NodeJS.ErrnoException).code ?? "error"}). Give a file in the data folder ${dataDir}.`);
  }
  const realData = realpathSync(dataDir);
  if (!real.startsWith(realData + sep)) throw new RestoreError(`${source} is outside the data folder ${dataDir}. Copy it there first.`);
  if ([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].some((p) => resolve(p) === real || resolve(p) === source)) throw new RestoreError("That is the live database itself.");

  const check = verifyDatabaseFile(real);
  if (!check.ok) throw new RestoreError(`${basename(source)} is not a usable database: ${check.reason}. Nothing was changed.`);
  const known = new Set(readMigrations(migrationsDir ?? findMigrationsDir()).map((m) => m.name));
  const src = new DatabaseSync(real, { readOnly: true });
  let unknown: string[];
  try {
    unknown = (src.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name).filter((n) => !known.has(n));
  } finally {
    src.close();
  }
  if (unknown.length) {
    throw new RestoreError(`${basename(source)} was made by a newer app version (${unknown.join(", ")}). Update the app first. Nothing was changed.`);
  }

  const lines = [`Checked ${basename(source)}: ok, ${check.users} users, ${check.migrations} migrations.`];
  if (existsSync(dbPath) && lstatSync(dbPath).size > 0) {
    lines.push(`The current database is saved as ${savePrevious(dbPath, join(dataDir, "backups", `pre-restore-${stamp(now)}.db`))}`);
  }

  const next = `${dbPath}.restore-tmp`;
  rmSync(next, { force: true });
  try {
    copyFileSync(real, next);
    chmodSync(next, 0o600);
    fsyncFile(next);
    const copy = verifyDatabaseFile(next);
    if (!copy.ok) throw new RestoreError(`The copy failed its check (${copy.reason}). Nothing was changed.`);
  } catch (err) {
    rmSync(next, { force: true });
    throw err;
  }
  // a leftover -wal of the old database must not be applied to the restored file
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  renameSync(next, dbPath);
  fsyncDir(dataDir);
  // a file left in the data folder for this purpose is not kept; one in backups/ stays
  if (dirname(real) === realData) {
    rmSync(real, { force: true });
    fsyncDir(dataDir);
  }
  lines.push("Restored. Start the app: docker compose start banking");
  return lines;
}

