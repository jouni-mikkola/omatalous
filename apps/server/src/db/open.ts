import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quickFileCheck, verifyDatabaseFile } from "./backup-check.ts";
import { assertRoomForCopy, copiesNewestFirst, KEPT_COPY_DAYS, liveDatabaseProblem, NoRoomError, RESET_LABEL, SECRET_ROTATE_LABEL, snapshotName, type Statfs } from "./backup-keep.ts";
import { applyMigrations, MigrationError, type Migration, type MigrationOptions, pendingMigrations } from "./migrate.ts";
import { fsyncDir, fsyncFile, ownerOnlyDir, ownerOnlyFile } from "../platform/durable.ts";
import { type OpenOptions, openNodeSqlite } from "./node-sqlite.ts";
import { EXTENSIONS } from "../extensions.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** Pre-migration copies kept in <data>/backups. */
const KEEP_SNAPSHOTS = 5;

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
 * An empty or table-less database file next to database copies is a damaged install (a data folder put back wrongly, a
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
      `Put back your own copy of the data folder; the newest copy here is backups/${newest}. ` +
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
 * removed, so an empty file never passes as a copy. With `source`, the copy is not started on a disk too
 * full to hold it (backup-keep.ts).
 *
 * The copy is written as <name>.part and gets its name only when it is complete, flushed and checked. An older
 * copy of that name (a copy taken a second time in the same second) is replaced by that rename and by nothing earlier, so a
 * copy that fails leaves it as it was.
 */
export function copyDatabase(db: { exec(sql: string): void }, dir: string, name: string, opts: CopyOptions & { source?: string } = {}): string {
  ownerOnlyDir(dir);
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
    ownerOnlyFile(part); // VACUUM INTO makes it readable by all
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

/** A copy taken before a change: pre-<migration>-*, pre-update-*, pre-reset-*, pre-secret-rotate-*. */
const isSnapshot = (name: string): boolean => name.startsWith("pre-") && name.endsWith(".db");
/** What the reset and the secret rotation saved: kept by age, never counted in the newest-N rule. */
const isKeptByAge = (name: string): boolean => isSnapshot(name) && [RESET_LABEL, SECRET_ROTATE_LABEL].some((label) => name.startsWith(`${label}-`));
/** What scripts/update.sh saved, the way back of `update.sh --rollback`: it prunes them itself and knows which one the rollback needs. */
const isUpdateCopy = (name: string): boolean => isSnapshot(name) && name.startsWith("pre-update-");

/**
 * A copy taken before a change that may need undoing (a migration, a secret rotation, a reset). Three groups, each with
 * its own rule, so a copy of one kind never pushes out another:
 * - the pre-migration copies: the newest KEEP_SNAPSHOTS stay;
 * - the reset's and the secret rotation's copy: each stays KEPT_COPY_DAYS days, however many other copies follow;
 * - the pre-update-* copies of `update.sh --rollback`: not touched here, update.sh prunes them.
 * Nothing else in <data>/backups is touched, and nothing at all while the live database fails its check: every copy
 * may be the one that is needed then.
 */
export function takeSnapshot(db: { exec(sql: string): void }, dbPath: string, label: string, at: Date, opts: CopyOptions = {}): string {
  const dir = join(dirname(dbPath), "backups");
  const file = copyDatabase(db, dir, snapshotName(label, at), { source: dbPath, statfs: opts.statfs });
  const problem = liveDatabaseProblem(dbPath);
  if (problem) {
    console.error(`database copies are not pruned: the live database ${dbPath} fails its check (${problem}). Every copy in ${dir} stays.`);
    return file;
  }
  const justWritten = basename(file);
  const isMigrationCopy = (name: string): boolean => isSnapshot(name) && !isKeptByAge(name) && !isUpdateCopy(name);
  const tooMany = copiesNewestFirst(dir, isMigrationCopy)
    // never the copy just written, even if the clock was turned back since the others
    .filter((o) => o.name !== justWritten)
    .slice(KEEP_SNAPSHOTS - 1);
  const limit = at.getTime() - KEPT_COPY_DAYS * 86_400_000;
  const tooOld = copiesNewestFirst(dir, isKeptByAge).filter((o) => o.name !== justWritten && o.t < limit);
  for (const o of [...tooMany, ...tooOld]) rmSync(o.file, { force: true });
  return file;
}
