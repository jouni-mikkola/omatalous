/**
 * Migration 0022: the closed months of a joint account's settlement. It only adds a table, carries the compat floor
 * 0.55.0 so a rollback build opens the database, and keeps a month once. Made-up data.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMigrations, checksum, compatFloor, pendingMigrations } from "../src/db/migrate.ts";
import { findMigrationsDir, buildMigrations } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { loadFixture } from "./fixture-db.ts";
import { scratchDir, setupApp } from "./helpers.ts";

const NAME = "0022_settlement_closed.sql";
const all = () => buildMigrations(findMigrationsDir()).sort((a, b) => a.name.localeCompare(b.name));
const FIXTURES = new URL("./fixtures/db/", import.meta.url);
// the newest release before 0022: the cut of 0.56.0 adds its own fixture, which already holds 0022
const newestFixture = () => readdirSync(FIXTURES).filter((f) => f.endsWith(".sql") && f.localeCompare("0.56.0.sql", "en", { numeric: true }) < 0).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1)!;

/** A database as the newest frozen release left it, for the migration to run on. */
function fromFixture() {
  const file = join(scratchDir("talous-0022-"), "data", "banking.db");
  mkdirSync(join(file, ".."), { recursive: true });
  loadFixture(file, newestFixture());
  return openNodeSqlite(file);
}

const AT = "2026-10-20T08:00:00.000Z";
const SNAPSHOT = '{"month":"2026-09","status":{"open":false,"closedOn":"2026-09-30","by":"time"}}';

describe("migration 0022", () => {
  it("applies on the newest frozen release database, adds one table, and stores the floor 0.55.0", async () => {
    const db = fromFixture();
    try {
      const before = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
      const { pending } = await pendingMigrations(db, all());
      expect(pending.map((m) => m.name)).toContain(NAME);
      await applyMigrations(db, pending);
      const after = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
      expect(after.filter((t) => !before.includes(t))).toContain("settlement_closed");
      for (const t of before) expect(after).toContain(t);
      expect(await db.all("SELECT compat FROM _migrations WHERE name = ?", [NAME])).toEqual([{ compat: "0.55.0" }]);
      expect(compatFloor(all().find((m) => m.name === NAME)!)).toBe("0.55.0");
      expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    } finally {
      db.close();
    }
  });

  it("makes the columns of the paper: one row per account key and month", async () => {
    const { db } = await setupApp();
    const columns = (await db.all<{ name: string; type: string; notnull: number; pk: number }>("PRAGMA table_info(settlement_closed)")).map((c) => [c.name, c.type, c.notnull ? "NN" : "", c.pk ? `PK${c.pk}` : ""].filter(Boolean).join(" "));
    expect(columns).toEqual(["account_key TEXT NN PK1", "month TEXT NN PK2", "closed_on TEXT NN", "snapshot TEXT NN", "written_at TEXT NN"]);
    const put = (key: string, month: string, snapshot = SNAPSHOT) => db.run("INSERT INTO settlement_closed (account_key, month, closed_on, snapshot, written_at) VALUES (?, ?, '2026-09-30', ?, ?)", [key, month, snapshot, AT]);
    await put("idn-joint", "2026-09");
    await put("idn-joint", "2026-10");
    await put("idn-other", "2026-09");
    await expect(put("idn-joint", "2026-09")).rejects.toThrow(/UNIQUE|constraint/);
    // the near misses of the checks: a month that is no month and a snapshot that is no JSON
    await expect(put("idn-joint", "2026-9")).rejects.toThrow(/CHECK|constraint/);
    await expect(put("idn-joint", "2026-11", "{nope")).rejects.toThrow(/CHECK|constraint|malformed/);
    expect(await db.all("SELECT month FROM settlement_closed WHERE account_key = 'idn-joint' ORDER BY month")).toEqual([{ month: "2026-09" }, { month: "2026-10" }]);
  });

  it("run a second time applies nothing, and a copy run without its record stops and leaves nothing half made", async () => {
    const db = fromFixture();
    try {
      const m = all().find((x) => x.name === NAME)!;
      await applyMigrations(db, (await pendingMigrations(db, all())).pending);
      const schema = await db.all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name");
      expect(await applyMigrations(db, [m])).toEqual([]);
      await db.run("INSERT INTO settlement_closed (account_key, month, closed_on, snapshot, written_at) VALUES ('idn-joint', '2026-09', '2026-09-30', ?, ?)", [SNAPSHOT, AT]);
      await db.run("DELETE FROM _migrations WHERE name = ?", [NAME]);
      await expect(applyMigrations(db, [m])).rejects.toThrow(/already exists/);
      expect(await db.all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")).toEqual(schema);
      // the month that was kept is still there
      expect(await db.all("SELECT snapshot FROM settlement_closed")).toEqual([{ snapshot: SNAPSHOT }]);
      await db.run("INSERT INTO _migrations (name, applied_at, checksum, compat) VALUES (?, ?, ?, '0.55.0')", [NAME, AT, checksum(m.sql)]);
      expect((await pendingMigrations(db, all())).pending).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("is opened by a build that stops at 0021, and refused by one below its floor", async () => {
    const db = fromFixture();
    try {
      // the database as 0022 leaves it: later files (0023 has a higher floor) are not applied here
      await applyMigrations(db, (await pendingMigrations(db, all())).pending.filter((m) => m.name <= NAME));
      const known = all().filter((m) => m.name < NAME);
      const rollback = await pendingMigrations(db, known, { appVersion: "0.55.0" });
      expect(rollback.pending).toEqual([]);
      expect(rollback.ahead).toEqual([NAME]);
      await expect(pendingMigrations(db, known, { appVersion: "0.54.9" })).rejects.toThrow(/newer app version/);
    } finally {
      db.close();
    }
  });
});
