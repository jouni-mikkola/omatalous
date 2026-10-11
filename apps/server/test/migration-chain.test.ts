import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, MigrationError, pendingMigrations } from "../src/db/migrate.ts";
import { findMigrationsDir, openDatabase, readMigrations } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { APP_VERSION } from "../src/version.ts";
import { loadFixture } from "./fixture-db.ts";
import { setupApp } from "./helpers.ts";

const FIXTURES = new URL("./fixtures/db/", import.meta.url);
const fixtureNames = readdirSync(FIXTURES).filter((f) => f.endsWith(".sql")).sort();
const tmp = () => mkdtempSync(join(tmpdir(), "talous-chain-"));

/** A data dir holding a database made by loading a frozen fixture, as an old release left it. */
function fromFixture(name: string): string {
  const file = join(tmp(), "data", "banking.db");
  mkdirSync(join(file, ".."), { recursive: true });
  loadFixture(file, name);
  return file;
}

type Row = Record<string, unknown>;
/** Every table with its rows, ordered by the first column, as a plain structure to compare. */
function dump(file: string): Record<string, { columns: string[]; rows: Row[] }> {
  const db = new DatabaseSync(file, { readOnly: true });
  const out: Record<string, { columns: string[]; rows: Row[] }> = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  for (const { name } of tables) {
    const columns = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
    out[name] = { columns, rows: db.prepare(`SELECT * FROM ${name} ORDER BY ${columns.map((_, i) => i + 1).join(",")}`).all() as Row[] };
  }
  db.close();
  return out;
}

/** The schema as SQLite stores it, sorted, to compare two databases. */
function schemaOf(file: string): { type: string; name: string; sql: string }[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as { type: string; name: string; sql: string }[];
  db.close();
  return rows;
}

/** Old columns keep their values: a migration may add columns and tables, never change what exists. */
function expectAdditive(before: ReturnType<typeof dump>, after: ReturnType<typeof dump>, step: string) {
  for (const [table, old] of Object.entries(before)) {
    if (table === "_migrations") continue;
    const now = after[table];
    expect(now, `${step} dropped table ${table}`).toBeDefined();
    for (const c of old.columns) expect(now!.columns, `${step} dropped ${table}.${c}`).toContain(c);
    expect(now!.rows.length, `${step} changed the row count of ${table}`).toBe(old.rows.length);
    old.rows.forEach((row, i) => {
      for (const c of old.columns) expect(now!.rows[i]![c], `${step} changed ${table}.${c} of row ${i}`).toEqual(row[c]);
    });
  }
}

describe("migration chain from frozen release databases", () => {
  it("has a fixture for the oldest supported release", () => {
    expect(fixtureNames).toContain("0.2.0.sql");
  });

  for (const name of fixtureNames) {
    it(`${name}: each migration applies cleanly and only adds`, async () => {
      const file = fromFixture(name);
      const all = readMigrations(findMigrationsDir()).sort((a, b) => a.name.localeCompare(b.name));
      const db = openNodeSqlite(file);
      try {
        const { pending } = await pendingMigrations(db, all);
        if (pending.length === 0) {
          // the newest release has nothing to apply (the schema comparison is in the next test)
          expect((await db.all<{ name: string }>("SELECT name FROM _migrations ORDER BY name")).map((r) => r.name)).toEqual(all.map((m) => m.name));
          expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
          expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
          return;
        }
        let state = dump(file);
        for (const m of pending) {
          await applyMigrations(db, [m]);
          expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
          expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
          const next = dump(file);
          expectAdditive(state, next, m.name);
          state = next;
        }
        const done = (await db.all<{ name: string }>("SELECT name FROM _migrations ORDER BY name")).map((r) => r.name);
        expect(done).toEqual(all.map((m) => m.name));
      } finally {
        db.close();
      }
    });

    it(`${name}: opens, upgrades and keeps the data and the user's own choices`, async () => {
      const file = fromFixture(name);
      const before = dump(file);
      const { db, applied, snapshot } = await openDatabase(file);
      db.close();
      if (applied.length === 0) {
        // the newest release opens as it is and equals a fresh database
        const fresh = join(tmp(), "fresh.db");
        (await openDatabase(fresh)).db.close();
        expect(schemaOf(file)).toEqual(schemaOf(fresh));
        expect(dump(file)).toEqual(before);
      } else {
        expect(snapshot).toMatch(/backups\/pre-/); // an existing database is copied first
        expectAdditive(before, dump(file), "openDatabase");
      }
    });

    it(`${name}: the upgrade tasks keep counts, sums and user-set categories`, async () => {
      const file = fromFixture(name);
      const sums = (f: string) => {
        const d = new DatabaseSync(f, { readOnly: true });
        const r = d.prepare("SELECT user_id, count(*) AS n, sum(amount_cents) AS cents FROM transactions GROUP BY user_id ORDER BY user_id").all();
        const user = d.prepare("SELECT id, category FROM transactions WHERE category_source = 'user' ORDER BY id").all();
        d.close();
        return { r, user };
      };
      const before = sums(file);
      const { db } = await openDatabase(file);
      const { createApp } = await import("../src/app.ts");
      const { loadConfig } = await import("../src/platform/config.ts");
      const app = createApp({
        db,
        config: loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" }),
        now: () => new Date("2026-10-09T10:00:00Z"),
      });
      const { runUpgradeTasks } = await import("../src/services/upgrade.ts");
      const result = await runUpgradeTasks(app.services, `${APP_VERSION}+chain`);
      expect(result).toMatchObject({ users: 2 });
      expect(await db.all("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
      db.close();
      const after = sums(file);
      expect(after.r).toEqual(before.r); // no row lost or changed in amount
      expect(after.user).toEqual(before.user); // category_source = 'user' is never overwritten
    });
  }
});

describe("version guards", () => {
  it("older code refuses a database with a migration it does not know, and says so in Finnish", async () => {
    const file = fromFixture(fixtureNames.at(-1)!);
    const dir = tmp();
    cpSync(findMigrationsDir(), dir, { recursive: true });
    writeFileSync(join(dir, "9001_future.sql"), "CREATE TABLE future (id INTEGER PRIMARY KEY);");
    (await openDatabase(file, dir)).db.close();
    await expect(openDatabase(file)).rejects.toThrow(/upgraded by a newer app version \(9001_future\.sql\)/);
    // the refused start changed nothing
    expect(dump(file).future).toBeDefined();
  });

  it("refuses a changed applied migration", async () => {
    const file = fromFixture("0.2.0.sql");
    const dir = tmp();
    cpSync(findMigrationsDir(), dir, { recursive: true });
    writeFileSync(join(dir, "0001_init.sql"), `${readFileSync(join(dir, "0001_init.sql"), "utf8")}\n-- edited`);
    await expect(openDatabase(file, dir)).rejects.toThrow(MigrationError);
  });

  it("refuses a database from before 0.1.0 in plain words and leaves it untouched", async () => {
    const file = join(tmp(), "old.db");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE transactions (id TEXT PRIMARY KEY, amount REAL); INSERT INTO transactions VALUES ('x', 1.5);");
    old.close();
    await expect(openDatabase(file)).rejects.toThrow(/before version 0\.1\.0/);
    expect(Object.keys(dump(file))).toEqual(["transactions"]); // not even _migrations was added

    // the same with a migration history that predates the multi-user layout
    const file2 = join(tmp(), "old2.db");
    const old2 = new DatabaseSync(file2);
    old2.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO _migrations VALUES ('0001_init.sql', 'x');");
    old2.close();
    await expect(openDatabase(file2)).rejects.toThrow(/before version 0\.1\.0/);
  });
});

describe("release bookkeeping", () => {
  const root = new URL("../../../", import.meta.url);
  const json = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8")) as { version: string };

  it("every package.json and the CHANGELOG heading carry APP_VERSION", () => {
    for (const p of ["package.json", "apps/server/package.json", "apps/web/package.json", "packages/core/package.json"]) {
      const v = json(p).version;
      // the root package may stay private and unversioned
      if (p === "package.json" && !v) continue;
      expect(v, p).toBe(APP_VERSION);
    }
    const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
    // notes for the next release collect under "Unreleased" above the current version; release.yml
    // checks on a tag that the section has been renamed to the version
    const sections = changelog.split(/^## /m).slice(1);
    const released = sections[0]?.startsWith("Unreleased") ? sections[1] : sections[0];
    expect(released?.match(/^\S+/)?.[0]).toBe(APP_VERSION);
    expect(released).toMatch(/^- /m);
  });
});

describe("0007 widens the ops_requests action list", () => {
  it("keeps every row, its rowid and both indexes, and accepts the new actions", async () => {
    const file = fromFixture("0.4.0.sql");
    const raw = new DatabaseSync(file);
    const ins = raw.prepare("INSERT INTO ops_requests (id, action, status, requested_by, requested_at, output) VALUES (?, ?, ?, 'u', '2026-10-01T00:00:00.000Z', ?)");
    const old = ["update", "rollback", "backup", "restart", "doctor", "check-update", "access", "port"];
    old.forEach((a, i) => ins.run(`op_000000000000000${i}`, a, "ok", `out ${a}`));
    const before = raw.prepare("SELECT rowid, * FROM ops_requests ORDER BY rowid").all();
    raw.close();
    const all = readMigrations(findMigrationsDir()).sort((a, b) => a.name.localeCompare(b.name));
    const db = openNodeSqlite(file);
    try {
      const { pending } = await pendingMigrations(db, all);
      expect(pending.map((m) => m.name)).toContain("0007_ops_more_actions.sql");
      await applyMigrations(db, pending);
      expect(await db.all("SELECT rowid, * FROM ops_requests ORDER BY rowid")).toEqual(before);
      expect((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ops_requests' AND name LIKE 'idx_%' ORDER BY name")).map((i) => i.name)).toEqual(["idx_ops_one_active", "idx_ops_status"]);
      expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
      // the fixture's queued restart holds the slot: logs does not need it, prune does
      const add = (id: string, action: string) => db.run("INSERT INTO ops_requests (id, action, requested_by, requested_at) VALUES (?, ?, 'u', 'x')", [id, action]);
      await add("op_aaaaaaaaaaaaaaa1", "logs");
      await add("op_aaaaaaaaaaaaaaa2", "logs");
      await expect(add("op_aaaaaaaaaaaaaaa3", "prune")).rejects.toThrow(/UNIQUE/);
      await expect(add("op_aaaaaaaaaaaaaaa4", "rm -rf")).rejects.toThrow(/CHECK/);
      await db.run("UPDATE ops_requests SET status = 'ok' WHERE id = 'o-4'");
      await add("op_aaaaaaaaaaaaaaa5", "helper-renew");
    } finally {
      db.close();
    }
  });
});

describe("migration lint", () => {
  const dir = findMigrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  it("numbers run without gaps or repeats", () => {
    expect(files.map((f) => Number(f.slice(0, 4)))).toEqual(files.map((_, i) => i + 1));
  });

  it("a migration that removes or rewrites data says so in a header", () => {
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8");
      // foreign key actions (ON DELETE CASCADE) are schema, not statements
      const code = sql.replace(/--[^\n]*/g, "").replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/gi, "");
      const risky = /\b(DROP\s+(TABLE|COLUMN|INDEX)|RENAME\s+(TO|COLUMN)|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i.test(code);
      if (risky) expect(sql, `${f} needs a "-- migrate: breaking <reason>" header`).toMatch(/^--\s*migrate:\s*breaking\s+\S+/m);
    }
  });

  it("runs on a fresh database from the oldest fixture and from nothing to the same schema", async () => {
    const { db } = await setupApp();
    const fresh = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((t) => t.name);
    const upgradedFile = fromFixture("0.2.0.sql");
    (await openDatabase(upgradedFile)).db.close();
    expect(Object.keys(dump(upgradedFile))).toEqual(fresh);
  });
});

describe("release wiring", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), "utf8");

  it("the compose layout number matches the Dockerfile default", () => {
    const compose = read("docker-compose.yml").match(/^x-talous-compat:\s*(\d+)/m)?.[1];
    const docker = read("Dockerfile").match(/^ARG COMPOSE_COMPAT=(\d+)/m)?.[1];
    expect(compose).toBeDefined();
    expect(docker).toBe(compose);
  });

  it("the signing identity in the release workflow is the one the scripts pin", () => {
    const wf = read(".github/workflows/release.yml").match(/SIGN_IDENTITY_REGEXP: (\S+)/)?.[1];
    const sh = read("scripts/lib/release.sh").match(/^SIGN_IDENTITY_REGEXP='([^']+)'/m)?.[1];
    expect(wf).toBeDefined();
    expect(sh).toBe(wf);
  });

  it("every action in the workflows is pinned by commit SHA", () => {
    for (const f of readdirSync(new URL(".github/workflows/", root))) {
      for (const line of read(`.github/workflows/${f}`).split("\n")) {
        const use = line.match(/^\s*-?\s*uses:\s*(\S+)/)?.[1];
        if (use && !use.startsWith("./")) expect(use, `${f}: ${line}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
