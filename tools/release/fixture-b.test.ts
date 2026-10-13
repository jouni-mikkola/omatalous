/**
 * tools/release/fixture.mjs, part b: the refusals about seeds, the contract and a pending migration.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, NOTE_ROWS, release, run } from "./fixture-kit.ts";

afterAll(cleanup);

// every test runs fixture.mjs and the migrations in a child process: seconds each, more on a busy machine
describe("tools/release/fixture.mjs", { timeout: 30_000 }, () => {
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
});
