import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "@banking/core";
import { describe, expect, it } from "vitest";
import { MigrationError } from "../src/db/migrate.ts";
import { findMigrationsDir, openDatabase, takeSnapshot } from "../src/db/open.ts";
import { loadDemoData } from "../src/demo.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { APP_VERSION } from "../src/version.ts";
import { setupApp } from "./helpers.ts";

/** A data dir and a copy of the real migrations that a test can add "future" migrations to. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "talous-upgrade-"));
  const migrations = join(root, "migrations");
  cpSync(findMigrationsDir(), migrations, { recursive: true });
  mkdirSync(join(root, "data"));
  return { root, migrations, db: join(root, "data", "banking.db") };
}
const write = (dir: string, name: string, sql: string) => writeFileSync(join(dir, name), sql);
const columns = (file: string, table: string) =>
  (new DatabaseSync(file).prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
/** The app's own migrations; test-only ones are numbered 9001+ so they always sort after these. */
const REAL = readdirSync(findMigrationsDir()).filter((f) => f.endsWith(".sql")).sort();
const migrationNames = (file: string) => (new DatabaseSync(file).prepare("SELECT name FROM _migrations ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe("schema migrations", () => {
  it("creates a fresh database without a snapshot", async () => {
    const w = workspace();
    const { db, applied, snapshot } = await openDatabase(w.db, w.migrations);
    db.close();
    expect(applied).toEqual(REAL);
    expect(snapshot).toBeNull();
  });

  it("snapshots an existing database before applying a new migration", async () => {
    const w = workspace();
    (await openDatabase(w.db, w.migrations)).db.close();
    write(w.migrations, "9001_account_note.sql", "ALTER TABLE accounts ADD COLUMN note TEXT;");

    const { db, applied, snapshot } = await openDatabase(w.db, w.migrations, () => new Date("2026-10-09T12:00:00Z"));
    db.close();
    expect(applied).toEqual(["9001_account_note.sql"]);
    expect(snapshot).toMatch(/backups\/pre-9001_account_note-20261009T120000\.db$/);
    expect(columns(snapshot!, "accounts")).not.toContain("note"); // the copy is the old schema
    expect(columns(w.db, "accounts")).toContain("note");

    // nothing pending: no new snapshot
    const again = await openDatabase(w.db, w.migrations);
    again.db.close();
    expect(again).toMatchObject({ applied: [], snapshot: null });
  });

  it("refuses to run older code on a database a newer version migrated", async () => {
    const w = workspace();
    write(w.migrations, "9001_future.sql", "CREATE TABLE future_feature (id INTEGER PRIMARY KEY);");
    (await openDatabase(w.db, w.migrations)).db.close();
    const old = workspace(); // the real migrations only
    await expect(openDatabase(w.db, old.migrations)).rejects.toThrow(MigrationError);
    await expect(openDatabase(w.db, old.migrations)).rejects.toThrow(/uudemmalla sovellusversiolla.*9001_future\.sql.*--rollback/s);
  });

  it("refuses an applied migration that was edited, but not one with Windows line endings", async () => {
    const w = workspace();
    write(w.migrations, "9001_x.sql", "CREATE TABLE x (id INTEGER PRIMARY KEY);\nCREATE INDEX idx_x ON x(id);\n");
    (await openDatabase(w.db, w.migrations)).db.close();

    write(w.migrations, "9001_x.sql", "CREATE TABLE x (id INTEGER PRIMARY KEY);\r\nCREATE INDEX idx_x ON x(id);\r\n");
    (await openDatabase(w.db, w.migrations)).db.close();

    write(w.migrations, "9001_x.sql", "CREATE TABLE x (id INTEGER PRIMARY KEY, extra TEXT);\nCREATE INDEX idx_x ON x(id);\n");
    await expect(openDatabase(w.db, w.migrations)).rejects.toThrow(/9001_x\.sql on muuttunut/);
  });

  it("rolls a failed migration back completely", async () => {
    const w = workspace();
    (await openDatabase(w.db, w.migrations)).db.close();
    write(w.migrations, "9001_broken.sql", "CREATE TABLE half_done (id INTEGER);\nALTER TABLE no_such_table ADD COLUMN y TEXT;");
    await expect(openDatabase(w.db, w.migrations)).rejects.toThrow(/9001_broken\.sql epäonnistui/);
    expect(migrationNames(w.db)).toEqual(REAL);
    expect(new DatabaseSync(w.db).prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
  });

  it("rebuilds a parent table without cascading deletes when foreign keys are switched off", async () => {
    const w = workspace();
    write(w.migrations, "9001_family.sql", `
      CREATE TABLE parent (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
      INSERT INTO parent VALUES ('p1', 'a'); INSERT INTO child (parent_id) VALUES ('p1'), ('p1');`);
    (await openDatabase(w.db, w.migrations)).db.close();
    write(w.migrations, "9002_rebuild_parent.sql", `-- migrate: foreign_keys=off
      CREATE TABLE parent_new (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
      INSERT INTO parent_new SELECT id, COALESCE(name, '') FROM parent;
      DROP TABLE parent;
      ALTER TABLE parent_new RENAME TO parent;`);
    const { db } = await openDatabase(w.db, w.migrations);
    expect(await db.first<{ n: number }>("SELECT count(*) AS n FROM child")).toEqual({ n: 2 });
    expect(await db.first<{ foreign_keys: number }>("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 }); // back on
    db.close();
  });

  it("records checksums for databases created before they existed", async () => {
    const w = workspace();
    const raw = new DatabaseSync(w.db.replace("banking.db", "legacy.db"));
    raw.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    raw.exec(readFileSync(join(w.migrations, "0001_init.sql"), "utf8"));
    raw.exec("INSERT INTO _migrations VALUES ('0001_init.sql', '2026-10-01T00:00:00Z')");
    raw.close();
    const { db, applied } = await openDatabase(w.db.replace("banking.db", "legacy.db"), w.migrations);
    expect(applied).toEqual(REAL.slice(1));
    expect((await db.first<{ checksum: string }>("SELECT checksum FROM _migrations"))?.checksum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it("keeps the five newest snapshots", async () => {
    const w = workspace();
    const { db } = await openDatabase(w.db, w.migrations);
    for (let i = 0; i < 7; i++) {
      const file = takeSnapshot(db, w.db, `pre-test${i}`, new Date(Date.UTC(2026, 0, 1 + i)));
      const t = Date.UTC(2026, 0, 1 + i) / 1000;
      utimesSync(file, t, t);
    }
    // written after a clock change: still kept, the oldest others go
    takeSnapshot(db, w.db, "pre-afterclock", new Date(Date.UTC(2025, 0, 1)));
    db.close();
    const kept = readdirSync(join(w.root, "data", "backups")).sort();
    expect(kept).toHaveLength(5);
    expect(kept).toContain("pre-afterclock-20250101T000000.db");
    expect(kept.filter((f) => f.startsWith("pre-test"))).toEqual(["pre-test3", "pre-test4", "pre-test5", "pre-test6"].map((p, i) => `${p}-2026010${4 + i}T000000.db`));
  });
});

describe("after a version change", () => {
  it("re-derives merchant names and categories once, keeping the user's own choices", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    await loadDemoData(repo, s.settings, s.today());
    const before = (await admin.call("GET", "/api/dashboard?from=2025-10-01&to=2026-10-09")).body.totals;

    // simulate rows written by an older version: other merchant names and categories
    const wolt = normalizeMerchant(null, "WOLT HELSINKI FI");
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = ?", [adminId, wolt]);
    await s.db.run("UPDATE transactions SET category = 'other', category_source = 'default' WHERE user_id = ? AND category = 'groceries'", [adminId]);
    const pinned = (await repo.allTransactions()).find((t) => t.category === "restaurants")!;
    await repo.setUserCategory(pinned.id, "gifts");
    await repo.addRule({ field: "merchant", pattern: "WOLT OLD NAME", category: "restaurants", priority: 10 });

    const r = await runUpgradeTasks(s, "0.3.0+abc");
    expect(r).toMatchObject({ users: 1 });
    expect(r!.merchantsRenamed).toBeGreaterThan(10);
    expect(r!.recategorised).toBeGreaterThan(10);

    const txs = await repo.allTransactions();
    expect(txs.some((t) => t.merchant === "WOLT OLD NAME")).toBe(false);
    expect(txs.filter((t) => t.category === "groceries").length).toBeGreaterThan(50);
    expect(txs.find((t) => t.id === pinned.id)).toMatchObject({ category: "gifts", categorySource: "user" });
    expect((await repo.listRules()).map((x) => x.pattern)).toEqual([wolt]); // the user's rule followed the new name

    await repo.setUserCategory(pinned.id, null);
    await s.db.run("DELETE FROM category_rules WHERE user_id = ?", [adminId]);
    await runUpgradeTasks(s, "0.3.0+abc+again");
    expect((await admin.call("GET", "/api/dashboard?from=2025-10-01&to=2026-10-09")).body.totals).toEqual(before);

    expect(await runUpgradeTasks(s, "0.3.0+abc+again")).toBeNull(); // once per build
  });

  it("the version constant matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
