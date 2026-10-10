import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations, type Migration, pendingMigrations } from "./migrate.ts";
import { openNodeSqlite } from "./node-sqlite.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DAILY_BACKUP = /^auto-\d{4}-\d{2}-\d{2}\.db$/;
/** Pre-migration snapshots kept in <data>/backups. */
const KEEP_SNAPSHOTS = 5;
/** Daily copies kept in <data>/backups. */
const KEEP_DAILY = 7;
/**
 * Copies older than this are removed, so a removed member's data does not outlive the retention
 * the member dialog states. The newest pre-* copy is the exception: it is the way back from an update
 * and stays until a newer one exists.
 */
export const BACKUP_MAX_AGE_DAYS = 14;

/** Works from src/ (tsx), from the esbuild bundle in dist/, and from the Docker image. */
export function findMigrationsDir(): string {
  const dir = [resolve(here, "../migrations"), resolve(here, "../../migrations")].find(
    (p) => existsSync(p) && readdirSync(p).some((f) => f.endsWith(".sql")),
  );
  if (!dir) throw new Error("migrations directory not found, set MIGRATIONS_DIR");
  return dir;
}

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/**
 * Opens the database and brings its schema up to date. Before the first
 * migration touches an existing database, a consistent copy is written to
 * <data>/backups/pre-<migration>-<time>.db, so a failed or unwanted upgrade
 * can be undone (scripts/update.sh --rollback). Fresh databases need none.
 */
export async function openDatabase(path: string, migrationsDir = findMigrationsDir(), now = () => new Date()) {
  const db = openNodeSqlite(path);
  try {
    const { pending, applied: before } = await pendingMigrations(db, readMigrations(migrationsDir));
    let snapshot: string | null = null;
    if (pending.length && before > 0 && path !== ":memory:") snapshot = takeSnapshot(db, path, `pre-${pending[0]!.name.replace(/\.sql$/, "")}`, now());
    const applied = await applyMigrations(db, pending);
    return { db, applied, snapshot };
  } catch (err) {
    db.close();
    throw err;
  }
}

/** VACUUM INTO writes a consistent copy even while another process has the database open. */
function copyDatabase(db: { exec(sql: string): void }, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name);
  rmSync(file, { force: true });
  // the name is a label with a date or timestamp; quotes are doubled for SQL anyway
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function takeSnapshot(db: { exec(sql: string): void }, dbPath: string, label: string, at: Date): string {
  const dir = join(dirname(dbPath), "backups");
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const file = copyDatabase(db, dir, `${label}-${stamp}.db`);
  // newest first by time written; also covers the pre-update-* copies made by scripts/update.sh
  const old = readdirSync(dir)
    // never the copy just written, even if the clock was turned back since the others
    .filter((f) => f.startsWith("pre-") && f.endsWith(".db") && f !== basename(file))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(KEEP_SNAPSHOTS - 1);
  for (const { f } of old) rmSync(join(dir, f), { force: true });
  pruneBackupsByAge(dirname(dbPath), at);
  return file;
}

/** Removes auto-* and pre-* copies older than BACKUP_MAX_AGE_DAYS; keeps the newest pre-* copy. Returns the names removed. */
export function pruneBackupsByAge(dataDir: string, now: Date): string[] {
  const dir = join(dataDir, "backups");
  if (!existsSync(dir)) return [];
  const limit = now.getTime() - BACKUP_MAX_AGE_DAYS * 86_400_000;
  const removed: string[] = [];
  const files = readdirSync(dir);
  for (const f of files) {
    if (!DAILY_BACKUP.test(f)) continue;
    if (Date.parse(`${f.slice(5, 15)}T00:00:00Z`) < limit) {
      rmSync(join(dir, f), { force: true });
      removed.push(f);
    }
  }
  const pre = files
    .filter((f) => f.startsWith("pre-") && f.endsWith(".db"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f, t } of pre.slice(1)) {
    if (t < limit) {
      rmSync(join(dir, f), { force: true });
      removed.push(f);
    }
  }
  return removed;
}


/**
 * The once-a-day copy in <data>/backups/auto-<day>.db (`day` is YYYY-MM-DD).
 * Only files of exactly that name are ever removed, the 7 newest by date stay.
 */
export function dailyBackup(db: { exec(sql: string): void }, dbPath: string, day: string): string {
  const dir = join(dirname(dbPath), "backups");
  const file = copyDatabase(db, dir, `auto-${day}.db`);
  const old = readdirSync(dir)
    .filter((f) => DAILY_BACKUP.test(f) && f !== basename(file))
    .sort()
    .reverse()
    .slice(KEEP_DAILY - 1);
  for (const f of old) rmSync(join(dir, f), { force: true });
  pruneBackupsByAge(dirname(dbPath), new Date(`${day}T12:00:00Z`));
  return file;
}
