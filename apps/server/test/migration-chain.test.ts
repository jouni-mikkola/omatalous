import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// in version order, so 0.10.0 comes after 0.9.0
const fixtureNames = readdirSync(FIXTURES).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
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

describe("0007 widens the ops_requests action list and 0017 takes the list out of the table", () => {
  it("keeps every row, its rowid and both indexes, and accepts the new actions", async () => {
    const file = fromFixture("0.4.0.sql");
    const raw = new DatabaseSync(file);
    const ins = raw.prepare("INSERT INTO ops_requests (id, action, status, requested_by, requested_at, output) VALUES (?, ?, ?, 'u', '2026-10-01T00:00:00.000Z', ?)");
    const old = ["update", "rollback", "backup", "restart", "doctor", "check-update", "access", "port"];
    old.forEach((a, i) => ins.run(`op_000000000000000${i}`, a, "ok", `out ${a}`));
    // a gap in the rowids: a rebuild that does not copy them closes it, and the rows after it move
    raw.prepare("DELETE FROM ops_requests WHERE id = 'op_0000000000000002'").run();
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
      // since 0017 the table lists no names (the server's OPS_ACTIONS and the helper's ACTIONS are the gates): the one slot and the list of statuses still hold
      expect(pending.map((m) => m.name)).toContain("0017_ops_actions_open.sql");
      await expect(add("op_aaaaaaaaaaaaaaa4", "prerelease-on")).rejects.toThrow(/UNIQUE/);
      await expect(db.run("INSERT INTO ops_requests (id, action, status, requested_by, requested_at) VALUES ('op_aaaaaaaaaaaaaaa6', 'logs', 'bogus', 'u', 'x')")).rejects.toThrow(/CHECK/);
      await db.run("UPDATE ops_requests SET status = 'ok' WHERE id = 'o-4'");
      await add("op_aaaaaaaaaaaaaaa5", "helper-renew");
      await db.run("UPDATE ops_requests SET status = 'ok' WHERE id = 'op_aaaaaaaaaaaaaaa5'");
      await add("op_aaaaaaaaaaaaaaa7", "prerelease-off");
    } finally {
      db.close();
    }
  });
});

describe("0015 stores the bank's transaction code", () => {
  it("a database of 0.8.5 gets the column empty, and the upgrade fills it from the bank's payload", async () => {
    // the last frozen database without the column: a later one has the migration applied already
    const file = fromFixture("0.8.5.sql");
    // a row as that release stored one from the bank: the code is in the payload only
    const old = new DatabaseSync(file);
    const row = old.prepare("SELECT id FROM transactions WHERE amount_cents > 0 AND category_source != 'user' ORDER BY id LIMIT 1").get() as { id: string };
    old.prepare("UPDATE transactions SET source = 'enablebanking', raw = ? WHERE id = ?").run(JSON.stringify({ bank_transaction_code: { code: "PMNT", sub_code: "RCDT-SALA" } }), row.id);
    old.close();

    const { db, applied } = await openDatabase(file);
    expect(applied).toContain("0015_bank_txn_code.sql");
    expect(await db.all("SELECT DISTINCT bank_txn_code FROM transactions")).toEqual([{ bank_txn_code: null }]);
    const { createApp } = await import("../src/app.ts");
    const { loadConfig } = await import("../src/platform/config.ts");
    const config = loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" });
    const app = createApp({ db, config, now: () => new Date("2026-10-09T10:00:00Z") });
    const { runUpgradeTasks } = await import("../src/services/upgrade.ts");
    expect(await runUpgradeTasks(app.services, `${APP_VERSION}+codes`)).toMatchObject({ bankCodes: 1 });
    expect(await db.all("SELECT id, bank_txn_code, category FROM transactions WHERE bank_txn_code IS NOT NULL")).toEqual([{ id: row.id, bank_txn_code: "PMNT-RCDT-SALA", category: "salary" }]);
    db.close();
  });
});

describe("0018 adds the table of who uses an account", () => {
  it("a database of 0.10.0 gets the table empty and keeps every row, and the code of 0.10.0 still opens it", async () => {
    const file = fromFixture("0.10.0.sql");
    const before = dump(file);
    // the frozen household has a joint account of two holders, which is what the table is for
    expect(before.accounts!.rows.find((r) => r.id === "a-5")).toMatchObject({ identity: "idn-5", holder: "MEIKALAINEN MATTI, KORHONEN ELISA" });
    const { db, applied } = await openDatabase(file);
    // 0019 follows on the way to today's schema
    expect(applied).toEqual(["0018_account_use.sql", "0019_loan_rate_review.sql"]);
    expect(await db.all("SELECT * FROM account_use")).toEqual([]);
    db.close();
    const after = dump(file);
    expect(Object.keys(after)).toEqual([...Object.keys(before), "account_use"].sort());
    expectAdditive(before, after, "0018_account_use.sql");

    // what the household says is held to one row for each user of a real account, the user with no id included
    const raw = openNodeSqlite(file);
    const say = (user: string | null, weight: number, key = "idn-5") => raw.run("INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, ?, 'u-aino', '2026-10-09T08:00:00.000Z')", [key, user, weight]);
    try {
      await say("u-aino", 60_000);
      await say("u-eero", 40_000);
      await say(null, 0);
      await expect(say("u-eero", 1)).rejects.toThrow(/UNIQUE/);
      await expect(say(null, 1)).rejects.toThrow(/UNIQUE/);
      await expect(say("u-aino", -1, "idn-1")).rejects.toThrow(/CHECK/);
      await expect(say("u-nobody", 1, "idn-1")).rejects.toThrow(/FOREIGN KEY/);
      // near misses: the same user on another account, and a weight of nothing
      await say("u-eero", 0, "idn-1");
      await say(null, 1, "idn-1");
    } finally {
      raw.close();
    }

    // a rollback: the release before has no such file, opens the database as it is and leaves what was said for the next update
    const dir = tmp();
    cpSync(findMigrationsDir(), dir, { recursive: true });
    rmSync(join(dir, "0018_account_use.sql"));
    const old = await openDatabase(file, dir, undefined, { appVersion: "0.10.0" });
    expect(old.applied).toEqual([]);
    expect(old.ahead).toEqual(["0018_account_use.sql"]);
    expect(await old.db.all("SELECT user_id, weight FROM account_use WHERE account_key = 'idn-5' ORDER BY user_id IS NULL, user_id")).toEqual([
      { user_id: "u-aino", weight: 60_000 },
      { user_id: "u-eero", weight: 40_000 },
      { user_id: null, weight: 0 },
    ]);
    old.db.close();
    // near miss: a release older than the floor is refused, as it was before this table
    await expect(openDatabase(file, dir, undefined, { appVersion: "0.9.9" })).rejects.toThrow(/upgraded by a newer app version \(0018_account_use\.sql\)/);
    const again = await openDatabase(file);
    expect(again.applied).toEqual([]);
    expect(await again.db.all("SELECT count(*) AS n FROM account_use")).toEqual([{ n: 5 }]);
    again.db.close();
  });
});

describe("0019 adds the review day of a loan's rate", () => {
  const MORTGAGE = "c1e2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d";

  it("a database of 0.11.0 gets no day on any loan and keeps every other column, and the code of 0.11.0 still opens it", async () => {
    const file = fromFixture("0.11.0.sql");
    const before = dump(file);
    // the frozen household has five typed loans of two users, one of them linked to an account
    expect(before.loans!.rows).toHaveLength(5);
    expect(before.loans!.columns).not.toContain("rate_review_date");
    const first = await openDatabase(file);
    expect(first.applied).toEqual(["0019_loan_rate_review.sql"]);
    first.db.close();
    const after = dump(file);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after.loans!.columns).toEqual([...before.loans!.columns, "rate_review_date"]);
    expect(after.loans!.rows.map((r) => r.rate_review_date)).toEqual([null, null, null, null, null]);
    expectAdditive(before, after, "0019_loan_rate_review.sql");

    // the store reads a loan with no day as it did before the column, saves a day with the loan and clears it again
    const { db } = await openDatabase(file);
    const { createApp } = await import("../src/app.ts");
    const { loadConfig } = await import("../src/platform/config.ts");
    const app = createApp({ db, config: loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" }), now: () => new Date("2026-10-12T10:00:00Z") });
    const aino = app.services.finance("u-aino");
    const loans = await aino.listLoans();
    expect(loans.map((l) => l.name)).toEqual(["Asuntolaina", "Joustoluotto", "Autolaina", "Visa"]);
    for (const loan of loans) expect(loan.rateReviewDate ?? null, loan.name).toBeNull();
    const mortgage = loans[0]!;
    expect(mortgage).toMatchObject({ id: MORTGAGE, rateBp: 340, reference: "euribor_12", marginBp: 65, endDate: "2051-06-15" });
    expect(await aino.updateLoan({ ...mortgage, rateReviewDate: "2027-03-14" }, "2026-10-12T11:00:00.000Z")).toBe(true);
    expect((await aino.listLoans())[0]).toEqual({ ...mortgage, rateReviewDate: "2027-03-14" });
    expect(await aino.updateLoan({ ...mortgage, rateReviewDate: null }, "2026-10-12T11:00:00.000Z")).toBe(true);
    expect((await aino.listLoans())[0]).toEqual(mortgage);
    expect(await aino.updateLoan({ ...mortgage, rateReviewDate: "2027-03-14" }, "2026-10-12T11:00:00.000Z")).toBe(true);
    db.close();

    // a rollback: the release before has no such file, opens the database as it is, writes a loan without the column and leaves the day for the next update
    const dir = tmp();
    cpSync(findMigrationsDir(), dir, { recursive: true });
    rmSync(join(dir, "0019_loan_rate_review.sql"));
    const old = await openDatabase(file, dir, undefined, { appVersion: "0.11.0" });
    expect(old.applied).toEqual([]);
    expect(old.ahead).toEqual(["0019_loan_rate_review.sql"]);
    await old.db.run("INSERT INTO loans (id, user_id, name, kind, balance_cents, balance_date, created_at, updated_at) VALUES ('old-1', 'u-eero', 'Vanha laina', 'other', 100000, '2026-10-12', '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z')");
    old.db.close();
    // near miss: a release older than the floor is refused, as it was before this column
    await expect(openDatabase(file, dir, undefined, { appVersion: "0.10.9" })).rejects.toThrow(/upgraded by a newer app version \(0019_loan_rate_review\.sql\)/);
    const again = await openDatabase(file);
    expect(again.applied).toEqual([]);
    expect(await again.db.all("SELECT id, rate_review_date FROM loans WHERE rate_review_date IS NOT NULL")).toEqual([{ id: MORTGAGE, rate_review_date: "2027-03-14" }]);
    expect(await again.db.all("SELECT count(*) AS n FROM loans")).toEqual([{ n: 6 }]);
    again.db.close();
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
