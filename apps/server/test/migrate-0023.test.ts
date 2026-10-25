/**
 * Migration 0023: what the bank says of an account, and who set its type. It only adds nullable columns, carries the
 * compat floor 0.64.0 so a rollback build opens the database, and leaves every account as it was. Made-up data.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigrations, compatFloor, pendingMigrations } from "../src/db/migrate.ts";
import { findMigrationsDir, buildMigrations } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { loadFixture } from "./fixture-db.ts";
import { scratchDir } from "./helpers.ts";

const NAME = "0023_account_bank_type.sql";
const COLUMNS = ["bank_type_code", "bank_usage", "bank_product", "psu_status", "type_source"];
const all = () => buildMigrations(findMigrationsDir()).sort((a, b) => a.name.localeCompare(b.name));
const FIXTURES = new URL("./fixtures/db/", import.meta.url);
// the newest release before 0023: the cut of 0.66.0 adds its own fixture, which already holds 0023
const newestFixture = () => readdirSync(FIXTURES).filter((f) => f.endsWith(".sql") && f.localeCompare("0.66.0.sql", "en", { numeric: true }) < 0).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1)!;

function fromFixture() {
  const file = join(scratchDir("talous-0023-"), "data", "banking.db");
  mkdirSync(join(file, ".."), { recursive: true });
  loadFixture(file, newestFixture());
  return openNodeSqlite(file);
}

describe("migration 0023", () => {
  it("adds five nullable columns to accounts, keeps every row, and stores the floor 0.64.0", async () => {
    const db = fromFixture();
    try {
      const before = await db.all("SELECT * FROM accounts ORDER BY id");
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const info = await db.all<{ name: string; notnull: number; dflt_value: unknown }>("PRAGMA table_info(accounts)");
      const added = info.filter((c) => COLUMNS.includes(c.name));
      expect(added.map((c) => c.name)).toEqual(COLUMNS);
      expect(added.every((c) => c.notnull === 0 && c.dflt_value === null)).toBe(true);
      const after = await db.all<Record<string, unknown>>("SELECT * FROM accounts ORDER BY id");
      expect(after.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !COLUMNS.includes(k))))).toEqual(before);
      expect(after.every((r) => COLUMNS.every((c) => r[c] === null))).toBe(true);
      expect(await db.all("SELECT compat FROM _migrations WHERE name = ?", [NAME])).toEqual([{ compat: "0.64.0" }]);
      expect(compatFloor(all().find((m) => m.name === NAME)!)).toBe("0.64.0");
      expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    } finally {
      db.close();
    }
  });

  it("takes only 'bank' or 'user' as who set the type", async () => {
    const db = fromFixture();
    try {
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const id = (await db.first<{ id: string }>("SELECT id FROM accounts LIMIT 1"))!.id;
      await db.run("UPDATE accounts SET type_source = 'user' WHERE id = ?", [id]);
      await expect(db.run("UPDATE accounts SET type_source = 'bank?' WHERE id = ?", [id])).rejects.toThrow(/CHECK|constraint/);
    } finally {
      db.close();
    }
  });

  it("is opened by a build that stops before it, and refused by one below its floor", async () => {
    const db = fromFixture();
    try {
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const known = all().filter((m) => m.name < NAME);
      const rollback = await pendingMigrations(db, known, { appVersion: "0.64.0" });
      expect(rollback.pending).toEqual([]);
      // the files after 0023 are ahead too, each with a floor at or below 0.64.0
      expect(rollback.ahead).toEqual(all().filter((m) => m.name >= NAME).map((m) => m.name));
      await expect(pendingMigrations(db, known, { appVersion: "0.63.9" })).rejects.toThrow(/newer app version/);
    } finally {
      db.close();
    }
  });
});
