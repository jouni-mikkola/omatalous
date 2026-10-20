/**
 * tools/release/fixture.mjs, part a: re-creating the 0.8.0 fixture and making the fixture of an invented release that adds a table.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checksum } from "../../apps/server/src/db/migrate.ts";
import { AT, cleanup, FIXTURES, load, NOTE_ROWS, NOTES, release, ROOT, run, scratch, shippedMigrations, snapshot } from "./fixture-kit.ts";

afterAll(cleanup);

// every test runs fixture.mjs and the migrations in a child process that works in memory (see run): about a second each
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
});
