/**
 * tools/release/fixture.mjs, part c: the refusals about the output and the version, --facts, and the fixture of 0.11.0.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AT, cleanup, FIXTURES, freshContract, load, MIGRATIONS, NOTE_ROWS, release, run, scratch, shippedMigrations } from "./fixture-kit.ts";

afterAll(cleanup);

// every test runs fixture.mjs and the migrations in a child process that works in memory (see run): about a second each
describe("tools/release/fixture.mjs", { timeout: 30_000 }, () => {
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

  it("--facts says what each migration adds and the floor it carries, and needs no seed, contract or free output file", async () => {
    const r = await release();
    writeFileSync(join(r.dir, "migrations/0014_more.sql"), "ALTER TABLE notes ADD COLUMN pinned INTEGER;\nCREATE INDEX idx_notes_body ON notes(body);\n");
    rmSync(join(r.dir, "contracts"), { recursive: true });
    writeFileSync(join(r.fixtures, "0.9.0.sql"), "-- already there\n");
    const done = run("0.9.0", "--facts", "--fixtures", r.fixtures, "--migrations", join(r.dir, "migrations"));
    expect(done.err).toBe("");
    expect(done.code).toBe(0);
    expect(done.out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(done.out)).toEqual({
      version: "0.9.0",
      previous: "0.8.0",
      migrations: [
        { name: "0013_notes.sql", compat: "0.8.0", tables: ["notes"], columns: [], indexes: ["idx_notes_user"] },
        // no header, no floor; a column of a table an earlier migration added counts for the migration that adds it
        { name: "0014_more.sql", compat: null, tables: [], columns: ["notes.pinned"], indexes: ["idx_notes_body"] },
      ],
    });
    expect(readdirSync(r.fixtures).sort()).toEqual(["0.8.0.sql", "0.9.0.sql"]);
    expect(readFileSync(join(r.fixtures, "0.9.0.sql"), "utf8")).toBe("-- already there\n");
    // a release whose migrations the previous fixture has already says so
    const none = run("0.8.1", "--facts", "--fixtures", r.fixtures, "--migrations", shippedMigrations());
    expect(none.code).toBe(0);
    expect(JSON.parse(none.out)).toMatchObject({ previous: "0.8.0", migrations: [] });
    expect(run("0.9.0", "--nope").err).toContain("[--at ISO] [--facts])");
  });

  it("makes the fixture of 0.11.0 from the seed of the repository: a said use of two rows on the joint account of 0.10.0", async () => {
    const dir = scratch();
    // the migrations of 0.11.0 up to the one that adds account_use, and the contract a fresh database of them gives
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < "0019")) cpSync(join(MIGRATIONS, f), join(migrations, f));
    mkdirSync(join(dir, "contracts/0.11.0"), { recursive: true });
    writeFileSync(join(dir, "contracts/0.11.0/schema.sql"), await freshContract("0.11.0", migrations));
    const seeds = join(dir, "seeds");
    mkdirSync(seeds);
    cpSync(join(FIXTURES, "seeds/0.11.0/account_use.sql"), join(seeds, "account_use.sql"));
    const out = join(dir, "0.11.0.sql");
    const done = run("0.11.0", "--out", out, "--seeds", seeds, "--migrations", migrations, "--contracts", join(dir, "contracts"), "--at", AT);
    expect(done.err).toBe("");
    expect(done.code).toBe(0);
    expect(done.out).toContain("the tables account_use (2 rows)");
    expect(done.out).toContain("-- Rows of account_use: A said use of the joint account a-5");
    const db = load(out);
    const rows = db.prepare("SELECT account_key, user_id, weight, said_by FROM account_use ORDER BY weight DESC").all();
    expect(rows).toEqual([
      { account_key: "idn-5", user_id: "u-aino", weight: 60000, said_by: "u-aino" },
      { account_key: "idn-5", user_id: null, weight: 40000, said_by: "u-aino" },
    ]);
    // the key names an account of two holders that the member who says it linked, and the member is a user
    const joint = db.prepare("SELECT user_id, holder FROM accounts WHERE identity = 'idn-5'").get() as { user_id: string; holder: string };
    expect(joint.user_id).toBe("u-aino");
    expect(joint.holder.split(",")).toHaveLength(2);
    expect(db.prepare("SELECT count(*) AS n FROM users WHERE id = 'u-aino'").get()).toEqual({ n: 1 });
    db.close();
  });
});
