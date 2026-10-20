import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickFileCheck, verifyDatabaseFile } from "./backup-check.ts";
import { assertRoomForCopy, copiesNewestFirst, liveDatabaseProblem, NoRoomError, protectedCopies, RESET_LABEL, snapshotName, type Statfs } from "./backup-keep.ts";
import { applyMigrations, MigrationError, type Migration, type MigrationOptions, pendingMigrations } from "./migrate.ts";
import { fsyncDir, fsyncFile } from "../platform/durable.ts";
import { type OpenOptions, openNodeSqlite } from "./node-sqlite.ts";
import { EXTENSIONS } from "../extensions.ts";

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

/** The shared migrations and those of the build's extensions (extensions.ts). */
export function buildMigrations(dir: string): Migration[] {
  return [...readMigrations(dir), ...EXTENSIONS.flatMap((e) => (e.migrationsDir ? readMigrations(e.migrationsDir) : []))];
}

function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/**
 * Opens the database and brings its schema up to date. Before the first
 * migration touches an existing database, a consistent copy is written to
 * <data>/backups/pre-<migration>-<time>.db, so a failed or unwanted upgrade
 * can be undone (scripts/update.sh --rollback). Fresh databases need none.
 * `ahead` names the migrations the database has and this build does not know but may run on (migrate.ts).
 * A disk without room for that copy stops the start before any migration runs, with both sizes in the message.
 */
export async function openDatabase(path: string, migrationsDir = findMigrationsDir(), now = () => new Date(), opts: OpenOptions & MigrationOptions & CopyOptions = {}) {
  const db = openNodeSqlite(path, opts);
  try {
    if (path !== ":memory:") await refuseEmptyOverData(db, path);
    const { pending, applied: before, ahead } = await pendingMigrations(db, buildMigrations(migrationsDir), opts);
    let snapshot: string | null = null;
    if (pending.length && before > 0 && path !== ":memory:") {
      try {
        snapshot = takeSnapshot(db, path, `pre-${pending[0]!.name.replace(/\.sql$/, "")}`, now(), opts);
      } catch (err) {
        if (!(err instanceof NoRoomError)) throw err;
        // entry/node.ts prints a MigrationError as one line, and the reason is what the admin has to act on
        throw new MigrationError(`No copy could be made before migrating, so ${pending.map((m) => m.name).join(", ")} did not run and the database is unchanged: ${err.message}`);
      }
    }
    const applied = await applyMigrations(db, pending);
    return { db, applied, snapshot, ahead };
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Thrown instead of starting as a fresh install over a database that lost its tables. */
export class EmptyDatabaseError extends MigrationError {}

/**
 * An empty or table-less database file next to database copies is a damaged install (a failed restore, a
 * truncated copy), not a new one. Starting would migrate it and create a new setup code while the data sits
 * in backups/. A migration history without the user table says the same. A fresh install has no copies.
 */
async function refuseEmptyOverData(db: ReturnType<typeof openNodeSqlite>, path: string): Promise<void> {
  const tables = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name));
  if (tables.has("users")) return;
  const hadHistory = tables.has("_migrations") && (await db.first("SELECT 1 FROM _migrations LIMIT 1")) !== null;
  if (tables.size > 0 && !hadHistory) return;
  const dir = join(dirname(path), "backups");
  const copies = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".db") && quickFileCheck(join(dir, f)) === null) : [];
  if (!copies.length) return;
  const newest = copies.map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]!.f;
  throw new EmptyDatabaseError(
    `${path} has no users table (${tables.size ? "damaged" : "empty"}) but ${dir} holds ${copies.length} database copies, so this is not a new install. Refusing to start with an empty database. ` +
      `Restore the newest copy: docker compose run --rm --no-deps -T banking node dist/node.js restore backups/${newest}. ` +
      "To start empty on purpose, move the backups folder away first.",
  );
}

/** The end of a copy's name while it is written. No listing of copies takes a name that does not end in .db. */
const PART = ".part";
/** No copy takes an hour to write: a part file this old was left by a power cut. */
const STALE_PART_MS = 3600_000;

/** Removes the part files in `dir` that nobody is writing any more. A younger one may be another process's copy. */
function clearStaleParts(dir: string): void {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(`.db${PART}`)) continue;
    try {
      if (Date.now() - statSync(join(dir, f)).mtimeMs > STALE_PART_MS) rmSync(join(dir, f), { force: true });
    } catch {
      // finished or removed meanwhile by the process that wrote it
    }
  }
}

/**
 * VACUUM INTO writes a consistent copy even while another process has the database open. A copy counts only
 * after the file and its folder are flushed to disk (a power cut right after a copy must not leave an
 * incomplete file under a good name) and it has been opened and checked. A failed or unreadable one is
 * removed, so an empty file never passes as a backup. With `source`, the copy is not started on a disk too
 * full to hold it (backup-keep.ts).
 *
 * The copy is written as <name>.part and gets its name only when it is complete, flushed and checked. An older
 * copy of that name (the day's copy taken a second time) is replaced by that rename and by nothing earlier, so a
 * copy that fails leaves it as it was.
 */
export function copyDatabase(db: { exec(sql: string): void }, dir: string, name: string, opts: CopyOptions & { source?: string } = {}): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name);
  const part = `${file}${PART}`;
  clearStaleParts(dir); // before the room is measured: what they held is free again
  if (opts.source) assertRoomForCopy(opts.source, dir, opts.statfs);
  rmSync(part, { force: true }); // VACUUM INTO refuses a file that exists
  /** What a failure has to remove. */
  let made = part;
  try {
    // the name is a label with a date or timestamp; quotes are doubled for SQL anyway
    db.exec(`VACUUM INTO '${part.replace(/'/g, "''")}'`);
    fsyncFile(part);
    const check = verifyDatabaseFile(part);
    if (!check.ok) throw new Error(`database copy ${name} failed its check and was removed: ${check.reason}`);
    const replaced = existsSync(file);
    renameSync(part, file);
    // From here an older copy of this name is gone. The new one is complete, so it stays even when a flush below
    // fails. A first copy of a name is removed then, as it always was: it counts only once its name is on disk.
    made = replaced ? "" : file;
    // the content is on disk already. These two put the name there: the file's own flush does on the usual file
    // systems, the folder's on all.
    fsyncFile(file);
    fsyncDir(dir);
  } catch (err) {
    if (made) rmSync(made, { force: true });
    throw err;
  }
  return file;
}

/** Tests inject `statfs` in place of the real free space of the disk a copy goes to. */
export interface CopyOptions {
  statfs?: Statfs;
}

/**
 * The one way a copy in <data>/backups is deleted. It takes the names a pruning rule would remove and leaves the
 * protected ones (backup-keep.ts): the three newest intact copies stay whatever a keep count or an age limit says.
 * The protected set is worked out once, before the first delete, and only when there is something to delete,
 * because it opens the copies. While the live database fails its check nothing is deleted at all.
 */
function pruner(dir: string, live: string): (names: string[]) => string[] {
  /** undefined until the first delete is asked for; null while the live database fails */
  let keep: Set<string> | null | undefined;
  return (names) => {
    if (!names.length) return [];
    if (keep === undefined) {
      const problem = liveDatabaseProblem(live);
      if (problem) console.error(`database copies are not pruned: the live database ${live} fails its check (${problem}). Every copy in ${dir} stays.`);
      keep = problem ? null : protectedCopies(dir);
    }
    if (keep === null) return [];
    const removed: string[] = [];
    for (const f of names) {
      if (keep.has(f)) continue;
      rmSync(join(dir, f), { force: true });
      removed.push(f);
    }
    return removed;
  };
}

/** A copy taken before a change: pre-migrate-*, pre-update-*, pre-reset-*, pre-restore-*. */
const isSnapshot = (name: string): boolean => name.startsWith("pre-") && name.endsWith(".db");

export function takeSnapshot(db: { exec(sql: string): void }, dbPath: string, label: string, at: Date, opts: CopyOptions = {}): string {
  const dir = join(dirname(dbPath), "backups");
  const file = copyDatabase(db, dir, snapshotName(label, at), { source: dbPath, statfs: opts.statfs });
  const remove = pruner(dir, dbPath);
  // also covers the pre-update-* copies made by scripts/update.sh
  const old = copiesNewestFirst(dir, isSnapshot)
    // never the copy just written, even if the clock was turned back since the others
    .filter((o) => o.name !== basename(file))
    .slice(KEEP_SNAPSHOTS - 1)
    // what the reset saved before it emptied the data is the only way back from it: it stays its 14 days, however many copies follow
    .filter((o) => !(o.name.startsWith(`${RESET_LABEL}-`) && o.t >= at.getTime() - BACKUP_MAX_AGE_DAYS * 86_400_000));
  remove(old.map((o) => o.name));
  pruneByAge(dir, at, remove);
  return file;
}

/**
 * Removes auto-* and pre-* copies older than BACKUP_MAX_AGE_DAYS; keeps the newest pre-* copy and the protected
 * copies. Returns the names removed. `live` is the database whose damage stops the pruning.
 */
export function pruneBackupsByAge(dataDir: string, now: Date, live = join(dataDir, "banking.db")): string[] {
  const dir = join(dataDir, "backups");
  return pruneByAge(dir, now, pruner(dir, live));
}

function pruneByAge(dir: string, now: Date, remove: (names: string[]) => string[]): string[] {
  if (!existsSync(dir)) return [];
  const limit = now.getTime() - BACKUP_MAX_AGE_DAYS * 86_400_000;
  const files = readdirSync(dir);
  const daily = files.filter((f) => DAILY_BACKUP.test(f) && Date.parse(`${f.slice(5, 15)}T00:00:00Z`) < limit);
  const pre = copiesNewestFirst(dir, isSnapshot)
    .slice(1)
    .filter((p) => p.t < limit);
  return remove([...daily, ...pre.map((p) => p.name)]);
}

/**
 * The once-a-day copy in <data>/backups/auto-<day>.db (`day` is YYYY-MM-DD).
 * Only files of exactly that name are ever removed, the 7 newest by date stay, and so does a protected copy.
 */
export function dailyBackup(db: { exec(sql: string): void }, dbPath: string, day: string, opts: CopyOptions = {}): string {
  const dir = join(dirname(dbPath), "backups");
  const file = copyDatabase(db, dir, `auto-${day}.db`, { source: dbPath, statfs: opts.statfs });
  const remove = pruner(dir, dbPath);
  const old = readdirSync(dir)
    .filter((f) => DAILY_BACKUP.test(f) && f !== basename(file))
    .sort()
    .reverse()
    .slice(KEEP_DAILY - 1);
  remove(old);
  pruneByAge(dir, new Date(`${day}T12:00:00Z`), remove);
  return file;
}
