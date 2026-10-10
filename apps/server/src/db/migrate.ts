/**
 * Schema migrations for SQLite on Node.
 *
 * Rules that keep upgrades safe:
 * - Files are `NNNN_name.sql`, applied in order, each in its own write
 *   transaction (BEGIN IMMEDIATE: a CLI command started at the same moment
 *   waits for the lock and then sees the migration as done).
 * - An applied migration never changes. Its SHA-256 is recorded and checked
 *   on every start; a changed file stops the app instead of leaving the
 *   schema in an unknown state. Add a new migration instead.
 * - A database with migrations this build does not know was written by a
 *   newer version. Old code is not run on it unless every unknown migration
 *   declared a compatibility floor (`-- migrate: compat 0.6.0`, the oldest
 *   app version that may run on the schema it leaves) and this build is at or
 *   above it. The floor is stored with the applied row (column `compat`,
 *   migration 0009). A migration without the header stores no floor and every
 *   build that lacks it refuses the database, the build that applied it
 *   included: the version number only moves at a release, so it cannot say
 *   which build a migration came with. For those restore the snapshot taken
 *   before the upgrade (open.ts, scripts/update.sh). Builds from before 0009
 *   do not read the column and keep refusing. The header is read from the
 *   leading comment block of the file only.
 * - A migration that rebuilds a table starts with the line
 *   `-- migrate: foreign_keys=off`. Foreign keys are switched off around it
 *   (SQLite cannot do that inside a transaction, and with them on, dropping
 *   a parent table would cascade-delete its children) and verified with
 *   PRAGMA foreign_key_check before commit.
 */
import { createHash } from "node:crypto";
import { APP_VERSION } from "../version.ts";
import type { Db } from "./types.ts";

export class MigrationError extends Error {}

export interface Migration {
  name: string;
  sql: string;
}

type ExecDb = Db & { exec(sql: string): void };

export interface MigrationOptions {
  /** The version this code is. Tests pretend to be another release. */
  appVersion?: string;
}

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const FOREIGN_KEYS_OFF = /^--\s*migrate:\s*foreign_keys=off\s*$/m;
const COMPAT_HEADER = /^--\s*migrate:\s*compat\b[ \t]*([^\r\n]*?)[ \t]*\r?$/m;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** The first lines of a file while they are blank or comments: the only place a migration header is read from. */
function leadingComments(sql: string): string {
  const lines: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    if (line.trim() !== "" && !line.trimStart().startsWith("--")) break;
    lines.push(line);
  }
  return lines.join("\n");
}

/** The floor a migration declares, or null when it has no header. A malformed header is an error, not a guess. */
export function compatFloor(m: Migration): string | null {
  const value = COMPAT_HEADER.exec(leadingComments(m.sql))?.[1];
  if (value === undefined) return null;
  if (!VERSION.test(value)) throw new MigrationError(`Migration ${m.name} has an invalid compat header "${value}" (format: -- migrate: compat 0.6.0).`);
  return value;
}

/** Versions are x.y.z. A stored floor that is not one (empty, damaged) is never met, so the database is refused. */
function atOrAbove(version: string, floor: string | null): boolean {
  const a = VERSION.exec(version);
  const b = floor === null ? null : VERSION.exec(floor);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return true;
}

/**
 * The applied migrations (`compat` is null where the database has no such column or no floor was stored) that
 * this build does not know and may not run on. Empty means the database can be used. Restore applies the same rule.
 */
export function unknownBlockers(rows: readonly { name: string; compat: string | null }[], known: ReadonlySet<string>, appVersion: string = APP_VERSION): string[] {
  return rows.filter((r) => !known.has(r.name) && !atOrAbove(appVersion, r.compat)).map((r) => r.name);
}

/** Line endings and trailing whitespace do not count: a Windows checkout must not look "edited". */
export function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n?/g, "\n").trimEnd()).digest("hex");
}

async function ensureTable(db: ExecDb): Promise<void> {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const columns = await db.all<{ name: string }>("PRAGMA table_info(_migrations)");
  // databases created before checksums were recorded
  if (!columns.some((c) => c.name === "checksum")) db.exec("ALTER TABLE _migrations ADD COLUMN checksum TEXT");
}

/** The floor column is added by migration 0009, not here: a database from before it has none. */
async function hasFloorColumn(db: ExecDb): Promise<boolean> {
  return (await db.all<{ name: string }>("PRAGMA table_info(_migrations)")).some((c) => c.name === "compat");
}

/**
 * The oldest layout the migrations can start from is the multi-user schema of 0.1.0 (0001_init.sql).
 * A single-user database from before it has other tables under the same migration name, so say so in
 * plain words before anything is applied or reported as a changed file.
 */
async function assertSupportedFloor(db: ExecDb): Promise<void> {
  const tables = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name));
  // an empty database is fresh; old tables without `users` are a pre-0.1 database
  if (tables.has("users") || !(tables.has("_migrations") || tables.has("transactions"))) return;
  throw new MigrationError(
    "The database was made before version 0.1.0 and cannot be upgraded. Install again (docs/INSTALL.md) and import the transactions from CSV files.",
  );
}

/**
 * Checks the recorded history against this build's migration files and
 * returns the ones still to apply. Throws MigrationError when the database
 * has a migration this build does not know and may not run on, or an applied
 * file was changed. `ahead` lists the unknown migrations that were accepted.
 */
export async function pendingMigrations(
  db: ExecDb,
  migrations: readonly Migration[],
  opts: MigrationOptions = {},
): Promise<{ pending: Migration[]; applied: number; ahead: string[] }> {
  const appVersion = opts.appVersion ?? APP_VERSION;
  for (const m of migrations) if (!NAME.test(m.name)) throw new MigrationError(`Invalid migration name: ${m.name} (format 0001_description.sql)`);
  await assertSupportedFloor(db);
  await ensureTable(db);
  const byName = new Map(migrations.map((m) => [m.name, m]));
  const done = await db.all<{ name: string; checksum: string | null; compat: string | null }>(
    `SELECT name, checksum, ${(await hasFloorColumn(db)) ? "compat" : "NULL AS compat"} FROM _migrations ORDER BY name`,
  );

  const unknown = done.filter((r) => !byName.has(r.name));
  const blocking = unknownBlockers(done, new Set(byName.keys()), appVersion);
  if (blocking.length) {
    throw new MigrationError(
      `The database was upgraded by a newer app version (${blocking.join(", ")}). This version cannot read it. ` +
        "Use the newer version or restore the backup from before the upgrade (scripts/update.sh --rollback).",
    );
  }
  for (const r of done) {
    const known = byName.get(r.name);
    if (!known) continue;
    const expected = checksum(known.sql);
    if (r.checksum === null) {
      // recorded before checksums existed: trust it once and remember
      await db.run("UPDATE _migrations SET checksum = ? WHERE name = ?", [expected, r.name]);
    } else if (r.checksum !== expected) {
      throw new MigrationError(`Applied migration ${r.name} has changed. Do not edit applied migrations, add a new one.`);
    }
  }
  const applied = new Set(done.map((r) => r.name));
  const pending = [...migrations].filter((m) => !applied.has(m.name)).sort((a, b) => a.name.localeCompare(b.name));
  // a bad header shows before a copy is taken or anything runs
  for (const m of pending) compatFloor(m);
  return { pending, applied: done.length, ahead: unknown.map((r) => r.name) };
}

/** Applies the given migrations in order, each atomically. Returns the names applied by this call. */
export async function applyMigrations(db: ExecDb, pending: readonly Migration[]): Promise<string[]> {
  const appliedNow: string[] = [];
  for (const m of pending) {
    // no header, no floor (stored as NULL): every build that lacks the file refuses the database
    const floor = compatFloor(m);
    const fkOff = FOREIGN_KEYS_OFF.test(m.sql);
    if (fkOff) db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        // another process may have applied it while we waited for the write lock
        if (await db.first("SELECT 1 FROM _migrations WHERE name = ?", [m.name])) {
          db.exec("COMMIT");
          continue;
        }
        db.exec(m.sql);
        if (fkOff) {
          const broken = await db.all<{ table: string }>("PRAGMA foreign_key_check");
          if (broken.length) throw new Error(`foreign key check failed in ${[...new Set(broken.map((b) => b.table))].join(", ")}`);
        }
        // 0009 adds the column inside its own transaction, so it is looked up after the file ran
        const values = [m.name, new Date().toISOString(), checksum(m.sql)];
        if (await hasFloorColumn(db)) await db.run("INSERT INTO _migrations (name, applied_at, checksum, compat) VALUES (?, ?, ?, ?)", [...values, floor]);
        else await db.run("INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)", values);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // SQLite already rolled back (full disk): keep the real error below
        }
        throw new MigrationError(`Migration ${m.name} failed, the database was left unchanged: ${(err as Error).message}`);
      }
    } finally {
      if (fkOff) db.exec("PRAGMA foreign_keys = ON");
    }
    appliedNow.push(m.name);
  }
  return appliedNow;
}
