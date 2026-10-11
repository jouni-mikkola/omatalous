/**
 * tools/release/fixture.mjs: it re-creates the 0.8.0 fixture from the 0.7.0 one and the real migrations, and in
 * throwaway folders it makes the fixture of an invented 0.9.0 (one new table) and refuses each way that goes wrong.
 * The repository's fixtures, contracts and migrations are only read.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { applyMigrations, checksum, pendingMigrations } from "../../apps/server/src/db/migrate.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "tools/release/fixture.mjs");
const FIXTURES = join(ROOT, "apps/server/test/fixtures/db");
const MIGRATIONS = join(ROOT, "apps/server/migrations");
const AT = "2026-10-12T08:00:00.000Z";
/** The migrations 0.8.0 shipped. A later one belongs to a later release, so these tests build on this set only. */
const SHIPPED = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < "0013");

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "fixture-test-"));
  dirs.push(d);
  return d;
};

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A folder with the migrations of 0.8.0 only. */
function shippedMigrations(): string {
  const dir = scratch();
  for (const f of SHIPPED) cpSync(join(MIGRATIONS, f), join(dir, f));
  return dir;
}

/** A loaded copy of a fixture file, as a database. */
function load(file: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(file, "utf8"));
  return db;
}

/** Schema and every row, in a form two databases can be compared by. */
function snapshot(db: DatabaseSync) {
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const rows = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY 1, 2`).all()]));
  return { schema, rows };
}

/** The runner's own view of a database, so the contract of the invented release comes from a fresh migrated database. */
async function freshContract(version: string, migrationsDir: string): Promise<string> {
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

const NOTES = `-- migrate: compat 0.8.0
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notes_user ON notes(user_id);
`;
const NOTE_ROWS = `-- one note per user, one with a quote and a line break in it
INSERT INTO notes (id,user_id,body,created_at) VALUES (1,'u-aino','Osta maitoa','2026-10-01T08:00:00.000Z');
INSERT INTO notes (id,user_id,body,created_at) VALUES (2,'u-eero','it''s
two lines','2026-10-02T08:00:00.000Z');
`;

/** An invented 0.9.0: the 0.8.0 fixture, the real migrations plus 0013_notes.sql, and the contract a fresh database gives. */
async function release(over: { seeds?: Record<string, string>; contract?: (c: string) => string } = {}) {
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

// every test runs fixture.mjs and the migrations in a child process: seconds each, more on a busy machine
describe("tools/release/fixture.mjs", { timeout: 30_000 }, () => {
  it("re-creates the 0.8.0 fixture from 0.7.0 and the migrations: the same schema and rows, a schema that equals the contract", () => {
    const dir = scratch();
    const seeds = join(dir, "seeds");
    mkdirSync(seeds);
    const real = readFileSync(join(FIXTURES, "0.8.0.sql"), "utf8");
    for (const t of ["optimise_inputs", "optimise_states", "optimise_snapshots"]) {
      writeFileSync(join(seeds, `${t}.sql`), real.split("\n").filter((l) => l.startsWith(`INSERT INTO ${t} `)).join("\n") + "\n");
    }
    const out = join(dir, "0.8.0.sql");
    const r = run("0.8.0", "--out", out, "--seeds", seeds, "--at", AT, "--migrations", shippedMigrations());
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/from 0\.7\.0\.sql \(20 tables, .* 1 migrations applied, 3 new tables\)/);
    expect(r.out).toContain("the tables optimise_inputs (8 rows), optimise_states (5 rows), optimise_snapshots (2 rows)");
    const made = load(out);
    const frozen = load(join(FIXTURES, "0.8.0.sql"));
    const [a, b] = [snapshot(made), snapshot(frozen)];
    expect(a.schema).toEqual(b.schema);
    expect(a.rows).toEqual(b.rows);
    // the schema of the contract: the same statements in the order the dump writes them
    const body = readFileSync(join(ROOT, "contracts/0.8.0/schema.sql"), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
    const dumped = made.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").all() as { sql: string }[];
    expect(body).toBe(`${dumped.map((s) => `${s.sql};`).join("\n")}\n`);
    made.close();
    frozen.close();
  });

  it("writes the same bytes on a second run and puts the header on the screen", () => {
    const dir = scratch();
    const seeds = join(dir, "seeds");
    mkdirSync(seeds);
    const real = readFileSync(join(FIXTURES, "0.8.0.sql"), "utf8");
    for (const t of ["optimise_inputs", "optimise_states", "optimise_snapshots"]) {
      writeFileSync(join(seeds, `${t}.sql`), (t === "optimise_states" ? "-- every status\n" : "") + real.split("\n").filter((l) => l.startsWith(`INSERT INTO ${t} `)).join("\n") + "\n");
    }
    const [one, two] = [join(dir, "one.sql"), join(dir, "two.sql")];
    const migrations = shippedMigrations();
    const first = run("0.8.0", "--out", one, "--seeds", seeds, "--at", AT, "--migrations", migrations);
    expect(run("0.8.0", "--out", two, "--seeds", seeds, "--at", AT, "--migrations", migrations).code).toBe(0);
    expect(readFileSync(one, "utf8")).toBe(readFileSync(two, "utf8"));
    expect(readFileSync(one, "utf8")).toContain("-- Rows of optimise_states: every status\n");
    expect(first.out).toContain("-- Frozen database as written by Omatalous 0.8.0.");
  });

  it("makes the fixture of a release that adds a table: the runner's _migrations row, the seed rows, a database with nothing pending", async () => {
    const r = await release({ seeds: { "notes.sql": NOTE_ROWS } });
    const done = run(...r.args);
    expect(done.err).toBe("");
    expect(done.code).toBe(0);
    const db = load(r.out);
    const row = db.prepare("SELECT * FROM _migrations WHERE name = '0013_notes.sql'").get() as Record<string, string>;
    expect(row).toEqual({ name: "0013_notes.sql", applied_at: AT, checksum: checksum(NOTES), compat: "0.8.0" });
    expect(db.prepare("SELECT id, body FROM notes ORDER BY id").all()).toEqual([
      { id: 1, body: "Osta maitoa" },
      { id: 2, body: "it's\ntwo lines" },
    ]);
    // the 0.8.0 rows are all still there
    expect(db.prepare("SELECT count(*) AS n FROM transactions").get()).toEqual({ n: 10 });
    expect(db.prepare("SELECT count(*) AS n FROM _migrations").get()).toEqual({ n: 13 });
    db.close();
    const text = readFileSync(r.out, "utf8");
    expect(text.split("\n")[0]).toBe("-- Frozen database as written by Omatalous 0.9.0. Never edit; add a new file per release.");
    expect(text).toContain("the _migrations rows of 0013_notes.sql");
    expect(text).toContain("-- Rows of notes: one note per user, one with a quote and a line break in it");
  });

  it("refuses a new table without seed rows, an empty seed file and a seed for a table that is not there", async () => {
    let r = await release();
    let done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/the new table notes has no rows/);
    expect(existsSync(r.out)).toBe(false);

    r = await release({ seeds: { "notes.sql": "-- nothing yet\n" } });
    done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/the new table notes has no rows/);

    r = await release({ seeds: { "notes.sql": NOTE_ROWS, "gadgets.sql": "INSERT INTO gadgets (id) VALUES (1);\n" } });
    done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/seeds\/0\.9\.0\/gadgets\.sql is for a table that does not exist/);
    expect(existsSync(r.out)).toBe(false);
  });

  it("refuses a seed that fails, one that breaks a foreign key and one that changes the schema", async () => {
    let r = await release({ seeds: { "notes.sql": "INSERT INTO notes (id,user_id,body,created_at) VALUES (1,'u-nobody','x','2026-10-01');\n" } });
    let done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/seeds\/0\.9\.0\/notes\.sql fails: FOREIGN KEY constraint failed/);

    r = await release({ seeds: { "notes.sql": NOTE_ROWS, "users.sql": "ALTER TABLE users ADD COLUMN nick TEXT;\n" } });
    done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/a seed file changed the schema/);
    expect(existsSync(r.out)).toBe(false);
  });

  it("refuses a schema that differs from contracts/X.Y.Z/schema.sql and a missing contract", async () => {
    const r = await release({ seeds: { "notes.sql": NOTE_ROWS }, contract: (c) => c.replace("body TEXT NOT NULL", "body TEXT") });
    const done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/the migrated schema differs from .*schema\.sql \(for example: CREATE TABLE notes \(/);
    expect(existsSync(r.out)).toBe(false);

    rmSync(join(r.dir, "contracts/0.9.0"), { recursive: true });
    const missing = run(...r.args);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/schema\.sql is missing\. Write it first: UPDATE_CONTRACT=0\.9\.0/);
  });

  it("refuses a database that still has a migration pending", async () => {
    // a seed that removes the row of an applied migration leaves that migration to run again
    const r = await release({ seeds: { "notes.sql": NOTE_ROWS, "_migrations.sql": "DELETE FROM _migrations WHERE name = '0012_optimise.sql';\n" } });
    const done = run(...r.args);
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/migrations are still pending: 0012_optimise\.sql/);
    expect(existsSync(r.out)).toBe(false);
  });

  it("refuses an existing fixture, a version with nothing below it, a bad version and a bad --at", async () => {
    const r = await release({ seeds: { "notes.sql": NOTE_ROWS } });
    expect(run(...r.args).code).toBe(0);
    const again = run(...r.args);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/exists\. A fixture is frozen/);

    const none = run("0.1.0", "--out", join(r.dir, "x.sql"));
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/no fixture below 0\.1\.0/);
    expect(run("0.9", "--out", join(r.dir, "y.sql")).code).toBe(1);
    expect(run(...r.args.slice(0, -2), "--at", "yesterday").err).toMatch(/--at must look like/);
    // the repository's own 0.8.0.sql is never replaced, even when asked for
    const clobber = run("0.8.0");
    expect(clobber.code).toBe(1);
    expect(clobber.err).toMatch(/exists\. A fixture is frozen/);
  });
});
