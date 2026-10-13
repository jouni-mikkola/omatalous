/**
 * Helpers of the tests of tools/release/fixture.mjs (fixture-a, fixture-b and fixture-c): it re-creates the 0.8.0 fixture
 * from the 0.7.0 one and the real migrations, and in throwaway folders it makes the fixture of an invented 0.9.0 (one new
 * table). The repository's fixtures, contracts and migrations are only read.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, pendingMigrations } from "../../apps/server/src/db/migrate.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "tools/release/fixture.mjs");
export const FIXTURES = join(ROOT, "apps/server/test/fixtures/db");
export const MIGRATIONS = join(ROOT, "apps/server/migrations");
export const AT = "2026-10-12T08:00:00.000Z";
/** The migrations 0.8.0 shipped. A later one belongs to a later release, so these tests build on this set only. */
const SHIPPED = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < "0013");

const dirs: string[] = [];
export const cleanup = () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
export const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "fixture-test-"));
  dirs.push(d);
  return d;
};

/**
 * fixture.mjs loads the previous fixture into a database file in its temporary folder, one statement at a time, and a
 * disk waits for every one of them to be written: 0.7 s alone, 30 s when a build keeps the disk busy. The same work in
 * memory (a RAM folder where there is one) takes 0.06 s and cannot be slowed by another job's disk.
 */
const MEMORY = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();

export function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, TMPDIR: MEMORY } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A folder with the migrations of 0.8.0 only. */
export function shippedMigrations(): string {
  const dir = scratch();
  for (const f of SHIPPED) cpSync(join(MIGRATIONS, f), join(dir, f));
  return dir;
}

/** A loaded copy of a fixture file, as a database. */
export function load(file: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(file, "utf8"));
  return db;
}

/** Schema and every row, in a form two databases can be compared by. */
export function snapshot(db: DatabaseSync) {
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const rows = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY 1, 2`).all()]));
  return { schema, rows };
}

/** The runner's own view of a database, so the contract of the invented release comes from a fresh migrated database. */
export async function freshContract(version: string, migrationsDir: string): Promise<string> {
  const db = new DatabaseSync(":memory:");
  const wrap = {
    exec: (sql: string) => db.exec(sql),
    all: async (sql: string, p: any[] = []) => db.prepare(sql).all(...p),
    first: async (sql: string, p: any[] = []) => db.prepare(sql).get(...p) ?? null,
    run: async (sql: string, p: any[] = []) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    batch: async () => {},
  };
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
  await applyMigrations(wrap as never, (await pendingMigrations(wrap as never, migrations)).pending);
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").all() as { sql: string }[];
  db.close();
  return `-- Frozen schema of a fresh Omatalous ${version} database.\n-- Regenerate while ${version} is unreleased.\n${rows.map((r) => `${r.sql};`).join("\n")}\n`;
}

export const NOTES = `-- migrate: compat 0.8.0
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON notes(user_id);
`;
export const NOTE_ROWS = `-- one note per user, one with a quote and a line break in it
INSERT INTO notes (id,user_id,body,created_at) VALUES (1,'u-aino','Osta maitoa','2026-10-01T08:00:00.000Z');
INSERT INTO notes (id,user_id,body,created_at) VALUES (2,'u-eero','it''s
two lines','2026-10-02T08:00:00.000Z');
`;

/** An invented 0.9.0: the 0.8.0 fixture, the real migrations plus 0013_notes.sql, and the contract a fresh database gives. */
export async function release(over: { seeds?: Record<string, string>; contract?: (c: string) => string } = {}) {
  const dir = scratch();
  const fixtures = join(dir, "fixtures");
  const migrations = join(dir, "migrations");
  mkdirSync(fixtures);
  cpSync(join(FIXTURES, "0.8.0.sql"), join(fixtures, "0.8.0.sql"));
  mkdirSync(migrations);
  for (const f of SHIPPED) cpSync(join(MIGRATIONS, f), join(migrations, f));
  writeFileSync(join(migrations, "0013_notes.sql"), NOTES);
  mkdirSync(join(dir, "contracts/0.9.0"), { recursive: true });
  const contract = await freshContract("0.9.0", migrations);
  writeFileSync(join(dir, "contracts/0.9.0/schema.sql"), (over.contract ?? ((c) => c))(contract));
  const seeds = join(fixtures, "seeds/0.9.0");
  if (over.seeds) {
    mkdirSync(seeds, { recursive: true });
    for (const [name, sql] of Object.entries(over.seeds)) writeFileSync(join(seeds, name), sql);
  }
  const out = join(dir, "0.9.0.sql");
  const args = ["0.9.0", "--fixtures", fixtures, "--migrations", migrations, "--contracts", join(dir, "contracts"), "--out", out, "--at", AT];
  return { dir, out, args, fixtures };
}
