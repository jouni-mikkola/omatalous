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
 *   newer version. Old code is not run on it: roll back by restoring the
 *   snapshot taken before the upgrade (see open.ts and scripts/update.sh).
 * - A migration that rebuilds a table starts with the line
 *   `-- migrate: foreign_keys=off`. Foreign keys are switched off around it
 *   (SQLite cannot do that inside a transaction, and with them on, dropping
 *   a parent table would cascade-delete its children) and verified with
 *   PRAGMA foreign_key_check before commit.
 */
import { createHash } from "node:crypto";
import type { Db } from "./types.ts";

export class MigrationError extends Error {}

export interface Migration {
  name: string;
  sql: string;
}

type ExecDb = Db & { exec(sql: string): void };

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const FOREIGN_KEYS_OFF = /^--\s*migrate:\s*foreign_keys=off\s*$/m;

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
    "Tietokanta on tehty ennen versiota 0.1.0 eikä sitä voi päivittää. Asenna uudelleen (docs/INSTALL.md) ja tuo tapahtumat CSV-tiedostoista.",
  );
}

/**
 * Checks the recorded history against this build's migration files and
 * returns the ones still to apply. Throws MigrationError when the database
 * is newer than the code or an applied file was changed.
 */
export async function pendingMigrations(db: ExecDb, migrations: readonly Migration[]): Promise<{ pending: Migration[]; applied: number }> {
  for (const m of migrations) if (!NAME.test(m.name)) throw new MigrationError(`Virheellinen migraation nimi: ${m.name} (muoto 0001_kuvaus.sql)`);
  await assertSupportedFloor(db);
  await ensureTable(db);
  const byName = new Map(migrations.map((m) => [m.name, m]));
  const done = await db.all<{ name: string; checksum: string | null }>("SELECT name, checksum FROM _migrations ORDER BY name");

  const unknown = done.filter((r) => !byName.has(r.name)).map((r) => r.name);
  if (unknown.length) {
    throw new MigrationError(
      `Tietokanta on päivitetty uudemmalla sovellusversiolla (${unknown.join(", ")}). Tämä versio ei osaa käsitellä sitä. ` +
        "Käytä uudempaa versiota tai palauta päivitystä edeltävä varmuuskopio (scripts/update.sh --rollback).",
    );
  }
  for (const r of done) {
    const expected = checksum(byName.get(r.name)!.sql);
    if (r.checksum === null) {
      // recorded before checksums existed: trust it once and remember
      await db.run("UPDATE _migrations SET checksum = ? WHERE name = ?", [expected, r.name]);
    } else if (r.checksum !== expected) {
      throw new MigrationError(`Jo ajettu migraatio ${r.name} on muuttunut. Älä muokkaa ajettuja migraatioita, lisää uusi.`);
    }
  }
  const applied = new Set(done.map((r) => r.name));
  const pending = [...migrations].filter((m) => !applied.has(m.name)).sort((a, b) => a.name.localeCompare(b.name));
  return { pending, applied: done.length };
}

/** Applies the given migrations in order, each atomically. Returns the names applied by this call. */
export async function applyMigrations(db: ExecDb, pending: readonly Migration[]): Promise<string[]> {
  const appliedNow: string[] = [];
  for (const m of pending) {
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
        await db.run("INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)", [m.name, new Date().toISOString(), checksum(m.sql)]);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw new MigrationError(`Migraatio ${m.name} epäonnistui, tietokanta jätettiin ennalleen: ${(err as Error).message}`);
      }
    } finally {
      if (fkOff) db.exec("PRAGMA foreign_keys = ON");
    }
    appliedNow.push(m.name);
  }
  return appliedNow;
}
