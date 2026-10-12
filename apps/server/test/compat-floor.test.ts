import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, compatFloor, MigrationError, pendingMigrations } from "../src/db/migrate.ts";
import { findMigrationsDir, openDatabase, readMigrations } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { restoreDatabase } from "../src/db/restore.ts";
import { loadFixture } from "./fixture-db.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "talous-compat-"));

/** A data dir holding the database of a frozen release. */
function fromFixture(name: string): string {
  const file = join(tmp(), "data", "banking.db");
  mkdirSync(join(file, ".."), { recursive: true });
  loadFixture(file, name);
  return file;
}

/** The shipped migrations plus extra files, as a newer release would carry them. */
function migrationsWith(extra: Record<string, string>): string {
  const dir = tmp();
  cpSync(findMigrationsDir(), dir, { recursive: true });
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(dir, name), sql);
  return dir;
}

const floors = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries((db.prepare("SELECT name, compat FROM _migrations ORDER BY name").all() as { name: string; compat: string | null }[]).map((r) => [r.name, r.compat]));
  } finally {
    db.close();
  }
};

const ADDITIVE = "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);";
const newerRefusal = (name: string) => new RegExp(`upgraded by a newer app version \\(${name.replace(/\./g, "\\.")}\\)\\. This version cannot read it\\.`);

describe("compat header", () => {
  it("reads the floor from the header and nothing from a file without one", () => {
    expect(compatFloor({ name: "0010_a.sql", sql: `-- migrate: compat 0.6.0\n${ADDITIVE}` })).toBe("0.6.0");
    expect(compatFloor({ name: "0010_a.sql", sql: `-- note\r\n-- migrate:   compat   12.0.103  \r\n${ADDITIVE}` })).toBe("12.0.103");
    expect(compatFloor({ name: "0010_a.sql", sql: ADDITIVE })).toBeNull();
  });

  it("reads the header from the leading comment block only", () => {
    expect(compatFloor({ name: "0010_a.sql", sql: `-- one\n\n-- migrate: compat 0.6.0\n${ADDITIVE}` })).toBe("0.6.0");
    expect(compatFloor({ name: "0010_a.sql", sql: `${ADDITIVE}\n-- migrate: compat 0.6.0\n` })).toBeNull();
    expect(compatFloor({ name: "0010_a.sql", sql: `${ADDITIVE}\n-- migrate: compat soon\n` })).toBeNull();
  });

  it("rejects a header that is not a version", () => {
    for (const bad of ["0.6", "v0.6.0", "latest", "0.6.0-rc1", "", "0.6.0 0.7.0"]) {
      expect(() => compatFloor({ name: "0010_a.sql", sql: `-- migrate: compat ${bad}\n${ADDITIVE}` }), bad).toThrow(MigrationError);
    }
  });
});

describe("compatibility floor", () => {
  it("0009 adds the column, and each migration applied from then on stores its floor", async () => {
    const file = fromFixture("0.5.0.sql");
    expect(Object.keys(columnsOf(file))).not.toContain("compat"); // the 0.5.0 layout has no such column
    const { db, applied } = await openDatabase(file);
    db.close();
    expect(applied.some((n) => n.startsWith("0009_"))).toBe(true);
    const stored = floors(file);
    // 0001 to 0008 were applied by code that had no floor: every later release knows them
    for (const [name, floor] of Object.entries(stored)) {
      if (Number(name.slice(0, 4)) < 9) expect(floor, name).toBeNull();
    }
    expect(stored["0009_migration_compat.sql"]).toBe("0.6.0");
  });

  it("a fresh database gets the same history and floors as an upgraded one", async () => {
    const fresh = join(tmp(), "fresh.db");
    (await openDatabase(fresh)).db.close();
    const upgraded = fromFixture("0.5.0.sql");
    (await openDatabase(upgraded)).db.close();
    expect(floors(fresh)).toEqual(floors(upgraded));
  });

  it("a migration without a header stores no floor", async () => {
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_notes.sql": ADDITIVE });
    (await openDatabase(file, dir, undefined, { appVersion: "0.7.0" })).db.close();
    expect(floors(file)["0010_notes.sql"]).toBeNull();
  });

  it("a headerless migration is refused by every build that lacks it, the one that applied it included", async () => {
    // a source-channel install applies unreleased migrations under the version of the last release (APP_VERSION only
    // moves at a release), and that release's code does not have the file
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_drop.sql": "-- migrate: breaking drops a table\nDROP TABLE sync_runs;" });
    (await openDatabase(file, dir)).db.close();
    expect(floors(file)["0010_drop.sql"]).toBeNull();
    for (const appVersion of [undefined, "0.5.1", "0.6.0", "9.0.0"]) {
      await expect(openDatabase(file, undefined, undefined, appVersion ? { appVersion } : {}), String(appVersion)).rejects.toThrow(newerRefusal("0010_drop.sql"));
    }
  });

  it("a header sets the floor, whatever version applied it", async () => {
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_notes.sql": `-- migrate: compat 0.6.0\n${ADDITIVE}` });
    (await openDatabase(file, dir, undefined, { appVersion: "0.7.0" })).db.close();
    expect(floors(file)["0010_notes.sql"]).toBe("0.6.0");
  });

  it("a bad header stops before a copy is taken or anything is applied", async () => {
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_notes.sql": `-- migrate: compat soon\n${ADDITIVE}` });
    await expect(openDatabase(file, dir)).rejects.toThrow(/0010_notes\.sql.*compat/);
    const raw = new DatabaseSync(file, { readOnly: true });
    expect((raw.prepare("SELECT count(*) AS n FROM _migrations").get() as { n: number }).n).toBe(8);
    raw.close();
    expect(existsSync(join(file, "..", "backups"))).toBe(false);
  });
});

/** The column names of _migrations. */
function columnsOf(file: string): Record<string, true> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries((db.prepare("PRAGMA table_info(_migrations)").all() as { name: string }[]).map((c) => [c.name, true]));
  } finally {
    db.close();
  }
}

describe("code older than the database", () => {
  /** A database that a newer release migrated: 0010 is additive and promises 0.6.0. */
  async function newerDb(extra: Record<string, string> = {}) {
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_notes.sql": `-- migrate: compat 0.6.0\n${ADDITIVE}`, ...extra });
    (await openDatabase(file, dir, undefined, { appVersion: "0.7.0" })).db.close();
    return file;
  }
  it("accepts it when its own version is at or above the floor, applies nothing, takes no copy and says what it saw", async () => {
    const file = await newerDb();
    for (const appVersion of ["0.6.0", "0.6.1", "0.10.0", "1.0.0"]) {
      const opened = await openDatabase(file, undefined, undefined, { appVersion });
      expect(opened.applied, appVersion).toEqual([]);
      expect(opened.snapshot, appVersion).toBeNull();
      expect(opened.ahead, appVersion).toEqual(["0010_notes.sql"]);
      // the schema it did not know is still there and still works
      expect(await opened.db.all("SELECT * FROM notes")).toEqual([]);
      opened.db.close();
    }
  });

  it("refuses it below the floor with the usual message, and changes nothing", async () => {
    const file = await newerDb();
    const before = floors(file);
    for (const appVersion of ["0.5.9", "0.5.1", "0.0.1"]) {
      await expect(openDatabase(file, undefined, undefined, { appVersion }), appVersion).rejects.toThrow(newerRefusal("0010_notes.sql"));
      await expect(openDatabase(file, undefined, undefined, { appVersion }), appVersion).rejects.toThrow(/scripts\/update\.sh --rollback/);
    }
    expect(floors(file)).toEqual(before);
  });

  it("with several unknown migrations every floor has to be met, and the message names the ones that are not", async () => {
    // 0011 promises 0.6.8, 0010 promises 0.6.0
    const file = await newerDb({ "0011_more.sql": "-- migrate: compat 0.6.8\nCREATE TABLE more (id INTEGER PRIMARY KEY);" });
    await expect(openDatabase(file, undefined, undefined, { appVersion: "0.6.5" })).rejects.toThrow(newerRefusal("0011_more.sql"));
    const opened = await openDatabase(file, undefined, undefined, { appVersion: "0.6.8" });
    expect(opened.ahead).toEqual(["0010_notes.sql", "0011_more.sql"]);
    opened.db.close();
  });

  it("a migration with no stored floor is refused, as before", async () => {
    const file = await newerDb();
    const raw = new DatabaseSync(file);
    raw.exec("UPDATE _migrations SET compat = NULL WHERE name = '0010_notes.sql'");
    raw.close();
    await expect(openDatabase(file, undefined, undefined, { appVersion: "9.0.0" })).rejects.toThrow(newerRefusal("0010_notes.sql"));
    const raw2 = new DatabaseSync(file);
    raw2.exec("UPDATE _migrations SET compat = 'soon' WHERE name = '0010_notes.sql'");
    raw2.close();
    await expect(openDatabase(file, undefined, undefined, { appVersion: "9.0.0" })).rejects.toThrow(newerRefusal("0010_notes.sql"));
  });

  it("a database from a release that has no column (0.5.x) with a migration this build does not know is refused, as before", async () => {
    const file = fromFixture("0.5.0.sql");
    const raw = new DatabaseSync(file);
    raw.exec("INSERT INTO _migrations (name, applied_at, checksum) VALUES ('9001_future.sql', 'x', 'y')");
    raw.close();
    await expect(openDatabase(file, undefined, undefined, { appVersion: "9.0.0" })).rejects.toThrow(newerRefusal("9001_future.sql"));
    expect(Object.keys(columnsOf(file))).not.toContain("compat"); // nothing was applied
  });

  it("known migrations are still checksummed next to compatible unknown ones", async () => {
    const file = await newerDb();
    const dir = migrationsWith({});
    writeFileSync(join(dir, "0001_init.sql"), `${readFileSync(join(dir, "0001_init.sql"), "utf8")}\n-- edited`);
    await expect(openDatabase(file, dir, undefined, { appVersion: "0.6.0" })).rejects.toThrow(/Applied migration 0001_init\.sql has changed/);
  });

  it("pendingMigrations reports the unknown ones it accepted", async () => {
    const file = await newerDb();
    const db = openNodeSqlite(file);
    try {
      const result = await pendingMigrations(db, readMigrations(findMigrationsDir()), { appVersion: "0.6.0" });
      expect(result.pending).toEqual([]);
      expect(result.ahead).toEqual(["0010_notes.sql"]);
    } finally {
      db.close();
    }
  });

  it("the next release can migrate a database again after a rollback that ran compatible code", async () => {
    const file = await newerDb();
    (await openDatabase(file, undefined, undefined, { appVersion: "0.6.0" })).db.close(); // rollback target runs and writes
    const dir = migrationsWith({ "0010_notes.sql": `-- migrate: compat 0.6.0\n${ADDITIVE}`, "0011_more.sql": `-- migrate: compat 0.6.0\nCREATE TABLE more (id INTEGER PRIMARY KEY);` });
    const opened = await openDatabase(file, dir, undefined, { appVersion: "0.7.0" });
    expect(opened.applied).toEqual(["0011_more.sql"]);
    expect(opened.ahead).toEqual([]);
    opened.db.close();
  });

  it("restore takes a copy from a compatible newer release and refuses one it cannot read", async () => {
    const file = await newerDb();
    const dataDir = join(file, "..");
    const copy = join(dataDir, "newer-copy.db");
    const src = new DatabaseSync(file);
    src.exec(`VACUUM INTO '${copy}'`);
    src.close();
    const target = fromFixture("0.5.0.sql");
    const copyInTarget = join(target, "..", "newer-copy.db");
    writeFileSync(copyInTarget, readFileSync(copy));
    expect(() => restoreDatabase(target, "newer-copy.db", new Date(), undefined, "0.5.9")).toThrow(/newer app version \(0010_notes\.sql\)/);
    writeFileSync(copyInTarget, readFileSync(copy));
    const lines = restoreDatabase(target, "newer-copy.db", new Date(), undefined, "0.6.0");
    expect(lines.join("\n")).toMatch(/Restored/);
  });

  it("applyMigrations stores the floor of every migration it applies in one run", async () => {
    const db = openNodeSqlite(":memory:");
    try {
      const shipped = readMigrations(findMigrationsDir());
      // a later release may rebuild a table: that migration is breaking and declares no floor, so no build may assume every migration has one
      const rebuild = { name: "0099_rebuilt.sql", sql: "-- migrate: foreign_keys=off\n-- migrate: breaking table rebuilt\nCREATE TABLE rebuilt (id INTEGER);" };
      const { pending } = await pendingMigrations(db, [...shipped, rebuild], { appVersion: "0.6.0" });
      await applyMigrations(db, pending);
      const rows = await db.all<{ name: string; compat: string | null }>("SELECT name, compat FROM _migrations ORDER BY name");
      expect(rows.find((r) => r.name === "0009_migration_compat.sql")).toEqual({ name: "0009_migration_compat.sql", compat: "0.6.0" });
      expect(rows.at(-1)).toEqual({ name: "0099_rebuilt.sql", compat: null });
      expect(rows.slice(0, 8).every((r) => r.compat === null)).toBe(true);
      // whatever a file declares is what is stored: a floor for an additive one, none for the others
      for (const r of rows) {
        const file = [...shipped, rebuild].find((m) => m.name === r.name)!;
        expect(r.compat, r.name).toBe(compatFloor(file));
      }
    } finally {
      db.close();
    }
  });
});
