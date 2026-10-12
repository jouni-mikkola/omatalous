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
 *
 * `newestIntactCopy` and `stageCopy` are the same checks and the same copy step for the two callers that pick the
 * copy themselves: the startup gate (startup-gate.ts) and the restore asked for in the browser. `finishStagedCopy`
 * is for the gate alone: it moves the database away before the rename, so a start can be cut off between the two.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fsyncDir, fsyncFile } from "../platform/durable.ts";
import { verifyDatabaseFile } from "./backup-check.ts";
import { copiesNewestFirst, type CopyFile, REPLACED_LABEL, snapshotName } from "./backup-keep.ts";
import { unknownBlockers } from "./migrate.ts";
import { findMigrationsDir, readMigrations } from "./open.ts";

export class RestoreError extends Error {}

/** The migrations a database file has that this build can neither apply nor run on (the rule of migrate.ts). Read-only. */
function blockersIn(file: string, migrationsDir?: string, appVersion?: string): string[] {
  const known = new Set(readMigrations(migrationsDir ?? findMigrationsDir()).map((m) => m.name));
  const src = new DatabaseSync(file, { readOnly: true });
  try {
    // the same rule as at start: a newer migration is fine when it declared a floor this build meets (migrate.ts)
    const hasFloor = (src.prepare("PRAGMA table_info(_migrations)").all() as { name: string }[]).some((c) => c.name === "compat");
    const rows = src.prepare(`SELECT name, ${hasFloor ? "compat" : "NULL AS compat"} FROM _migrations`).all() as { name: string; compat: string | null }[];
    return unknownBlockers(rows, known, appVersion);
  } finally {
    src.close();
  }
}

/** A copy by its file name in the copies folder, its path, when it was written (ISO) and its size. */
export type IntactCopy = Omit<CopyFile, "t">;

/**
 * The newest copy in `backupDir` (<data>/backups) that a restore would accept: a regular file with a copy's name that
 * passes the full check and has no migration this build cannot run on. Newest is by the time written. The one answer
 * to "which copy would be restored" for the startup gate and for the browser.
 */
export function newestIntactCopy(backupDir: string, migrationsDir?: string, appVersion?: string): IntactCopy | null {
  for (const { t: _t, ...copy } of copiesNewestFirst(backupDir)) {
    try {
      if (verifyDatabaseFile(copy.file).ok && !blockersIn(copy.file, migrationsDir, appVersion).length) return copy;
    } catch {
      // unreadable: the next one
    }
  }
  return null;
}

/** Where a copy waits for the database's name: beside it, so the rename stays inside one folder. */
const stagedPath = (dbPath: string) => `${dbPath}.restore-tmp`;

/**
 * Copies a checked file next to the database, flushed and checked again, and returns the copy's path. The caller
 * renames it over the database. A copy that fails is removed, so nothing half-written is left under that name.
 */
export function stageCopy(source: string, dbPath: string): string {
  const next = stagedPath(dbPath);
  rmSync(next, { force: true });
  try {
    copyFileSync(source, next);
    chmodSync(next, 0o600);
    fsyncFile(next);
    const copy = verifyDatabaseFile(next);
    if (!copy.ok) throw new RestoreError(`The copy failed its check (${copy.reason}). Nothing was changed.`);
  } catch (err) {
    rmSync(next, { force: true });
    throw err;
  } finally {
    // the check of a file that was in WAL mode leaves an empty log and its index under the temporary name
    rmSync(`${next}-wal`, { force: true });
    rmSync(`${next}-shm`, { force: true });
  }
  return next;
}

/**
 * Finishes a restore that was cut off after the old database had left and before the staged copy got its name
 * (the startup gate moves the damaged database aside first). Only that state counts: no database, no log of one,
 * and a staged copy that passes the checks again. Returns whether the copy is now the database.
 */
export function finishStagedCopy(dbPath: string, migrationsDir?: string, appVersion?: string): boolean {
  const next = stagedPath(dbPath);
  if (!existsSync(next) || [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].some((p) => existsSync(p))) return false;
  try {
    if (!verifyDatabaseFile(next).ok || blockersIn(next, migrationsDir, appVersion).length) return false;
  } finally {
    rmSync(`${next}-wal`, { force: true });
    rmSync(`${next}-shm`, { force: true });
  }
  renameSync(next, dbPath);
  fsyncDir(dirname(dbPath));
  return true;
}

/**
 * A copy of what is in banking.db now. A consistent VACUUM INTO when the database opens, else the raw files.
 * Either way the copy is flushed to disk before restore goes on and replaces the database.
 */
function savePrevious(dbPath: string, dest: string): string {
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  rmSync(dest, { force: true });
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    db.close();
    db = undefined;
    fsyncFile(dest);
    fsyncDir(dirname(dest));
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
  fsyncFile(dest);
  if (existsSync(`${dbPath}-wal`)) {
    copyFileSync(`${dbPath}-wal`, `${dest}-wal`);
    fsyncFile(`${dest}-wal`);
  }
  fsyncDir(dirname(dest));
  return dest;
}

export function restoreDatabase(dbPath: string, input: string, now: Date, migrationsDir?: string, appVersion?: string): string[] {
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
  const unknown = blockersIn(real, migrationsDir, appVersion);
  if (unknown.length) {
    throw new RestoreError(`${basename(source)} was made by a newer app version (${unknown.join(", ")}). Update the app first. Nothing was changed.`);
  }

  const lines = [`Checked ${basename(source)}: ok, ${check.users} users, ${check.migrations} migrations.`];
  if (existsSync(dbPath) && lstatSync(dbPath).size > 0) {
    lines.push(`The current database is saved as ${savePrevious(dbPath, join(dataDir, "backups", snapshotName(REPLACED_LABEL, now)))}`);
  }

  const next = stageCopy(real, dbPath);
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

