import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateCheck, removeOnSignal, runMigrateCheck } from "../src/db/migrate-check.ts";
import { findMigrationsDir, openDatabase } from "../src/db/open.ts";

const FIXTURES = new URL("./fixtures/db/", import.meta.url);
const ENTRY = fileURLToPath(new URL("../src/entry/node.ts", import.meta.url));
// the sources are TypeScript with syntax Node cannot strip, so the entry runs under tsx as `pnpm dev` does
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "talous-mcheck-"));
  dirs.push(d);
  return d;
};

/** A database as a released version left it, in its own folder. */
function fromFixture(name: string): string {
  const file = join(tmp(), "banking.db");
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL(name, FIXTURES), "utf8"));
  db.close();
  return file;
}

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
/** A fingerprint of the original: content, modification time, and what else is in its folder. */
const fingerprint = (f: string) => ({ sha: sha(f), mtime: statSync(f).mtimeMs, files: readdirSync(join(f, "..")).sort() });
const rowCount = (f: string, table: string) => {
  const d = new DatabaseSync(f, { readOnly: true });
  try {
    return Number((d.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
  } finally {
    d.close();
  }
};
/** The shipped migrations plus extra files. */
function migrationsWith(extra: Record<string, string>): string {
  const dir = tmp();
  cpSync(findMigrationsDir(), dir, { recursive: true });
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("migrate-check on a database from an older release", () => {
  it("0.4.0: applies what is pending to a copy, checks it, and leaves the original and the temp folder as they were", async () => {
    const file = fromFixture("0.4.0.sql");
    const before = fingerprint(file);
    const report = await migrateCheck(file);
    expect(report).toMatchObject({ ok: true, problems: [], integrity: "ok", file });
    expect(report.applied).toEqual(["0007_ops_more_actions.sql", "0008_list_indexes.sql", "0009_migration_compat.sql"]);
    expect(report.from).toBe(6);
    expect(report.to).toBe(9);
    expect(report.foreignKeyViolations).toEqual({ before: 0, after: 0 });
    expect(Number.isInteger(report.elapsedMs) && report.elapsedMs >= 0).toBe(true);
    expect(report.migrateMs).toBeLessThanOrEqual(report.elapsedMs);
    // per-table counts: every table is there with the rows of the original, the migrations changed none
    expect(report.tables.transactions).toEqual({ before: rowCount(file, "transactions"), after: rowCount(file, "transactions") });
    expect(report.tables.transactions!.before).toBeGreaterThan(0);
    for (const [name, c] of Object.entries(report.tables)) expect(c.after, name).toBe(c.before);
    expect(Object.keys(report.tables)).not.toContain("_migrations");
    expect(fingerprint(file)).toEqual(before);
  });

  it("0.2.0: the oldest supported fixture works too", async () => {
    const report = await migrateCheck(fromFixture("0.2.0.sql"));
    expect(report.ok, report.problems.join("; ")).toBe(true);
    expect(report.applied.length).toBeGreaterThan(3);
  });

  it("a database that needs nothing passes with nothing applied", async () => {
    const file = join(tmp(), "banking.db");
    (await openDatabase(file)).db.close();
    const report = await migrateCheck(file);
    expect(report).toMatchObject({ ok: true, applied: [], from: report.to });
  });

  it("copies what only sits in the WAL of a database that is open, so a plain file copy would have lost it", async () => {
    const file = join(tmp(), "banking.db");
    const { db } = await openDatabase(file);
    db.exec("PRAGMA wal_autocheckpoint = 0");
    db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-wal', 'wal', 'W', 'h', 'member', '2026-01-01')");
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
    // the main file alone holds none of it (it all sits in the WAL): this is what a plain copy of the file would give
    copyFileSync(file, `${file}.plain`);
    expect(() => rowCount(`${file}.plain`, "users")).toThrow(/no such table/);
    const report = await migrateCheck(file);
    db.close();
    expect(report.ok, report.problems.join("; ")).toBe(true);
    expect(report.tables.users).toEqual({ before: 1, after: 1 });
  });

  it("an original in rollback-journal mode (a pre-update copy) is untouched down to its folder", async () => {
    const live = join(tmp(), "live.db");
    const { db } = await openDatabase(live);
    const copy = join(tmp(), "pre-update-1.db");
    db.exec(`VACUUM INTO '${copy}'`);
    db.close();
    const before = fingerprint(copy);
    expect((await migrateCheck(copy)).ok).toBe(true);
    expect(fingerprint(copy)).toEqual(before);
  });
});

describe("migrate-check failures", () => {
  it("a migration that fails on the data: not ok, says which, original untouched, no scratch folder left", async () => {
    const file = fromFixture("0.5.0.sql");
    const before = fingerprint(file);
    // a unique index over rows that repeat, the kind of fault a small test fixture does not show
    const dir = migrationsWith({ "0010_unique.sql": "-- migrate: compat 0.6.0\nCREATE UNIQUE INDEX idx_tx_one_per_account ON transactions(account_id);" });
    const report = await migrateCheck(file, { migrationsDir: dir, appVersion: "0.7.0" });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/Migration 0010_unique\.sql failed/);
    expect(fingerprint(file)).toEqual(before); // the listing of the folder too: no scratch folder is left
  });

  it("a migration that loses rows is a failure, a migration that adds rows is not", async () => {
    const file = fromFixture("0.5.0.sql");
    const lose = migrationsWith({ "0010_lose.sql": "-- migrate: breaking drop the pending rows\nDELETE FROM transactions WHERE status = 'pending';" });
    const lost = await migrateCheck(file, { migrationsDir: lose, appVersion: "0.7.0" });
    expect(lost.ok).toBe(false);
    expect(lost.problems.join(" ")).toMatch(/transactions: \d+ rows before, \d+ after/);
    const gain = migrationsWith({ "0010_gain.sql": "-- migrate: compat 0.6.0\nINSERT INTO settings (key, value, updated_at) VALUES ('added_by_migration', '1', 'x');" });
    const grown = await migrateCheck(file, { migrationsDir: gain, appVersion: "0.7.0" });
    expect(grown.ok, grown.problems.join("; ")).toBe(true);
    expect(grown.tables.settings!.after).toBe(grown.tables.settings!.before + 1);
  });

  it("a table that disappears is a failure", async () => {
    const file = fromFixture("0.5.0.sql");
    const dir = migrationsWith({ "0010_drop.sql": "-- migrate: breaking drop a table\nDROP TABLE sync_runs;" });
    const report = await migrateCheck(file, { migrationsDir: dir, appVersion: "0.7.0" });
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/sync_runs: .* missing after/);
  });

  it("a database that is newer than this build is a failure with the usual wording", async () => {
    const file = fromFixture("0.5.0.sql");
    const raw = new DatabaseSync(file);
    raw.exec("INSERT INTO _migrations (name, applied_at, checksum) VALUES ('9001_future.sql', 'x', 'y')");
    raw.close();
    const report = await migrateCheck(file);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/upgraded by a newer app version \(9001_future\.sql\)/);
  });

  it("a foreign key violation the file already had is reported and does not stop the update", async () => {
    const file = fromFixture("0.5.0.sql");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = OFF; INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('orphan', 'nobody', 'x', 'x', 'x')");
    old.close();
    const report = await migrateCheck(file);
    expect(report.ok, report.problems.join("; ")).toBe(true);
    expect(report.foreignKeyViolations).toEqual({ before: 1, after: 1 });
  });

  it("a file that is not a database, a missing file and a folder", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "text.db"), "not a database ".repeat(500));
    for (const target of [join(dir, "text.db"), join(dir, "missing.db"), dir]) {
      const report = await migrateCheck(target);
      expect(report.ok, target).toBe(false);
      expect(report.problems.length, target).toBeGreaterThan(0);
    }
    expect(existsSync(join(dir, "missing.db"))).toBe(false); // looking did not create it
  });
});

describe("migrate-check command line", () => {
  const run = async (args: string[], opts = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMigrateCheck(args, { out: (l) => out.push(l), err: (l) => err.push(l) }, { ...opts });
    return { code, out, err };
  };

  it("prints one JSON line on stdout, a short English line on stderr, and exits 0", async () => {
    const r = await run([fromFixture("0.4.0.sql")]);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    const json = JSON.parse(r.out[0]!) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, applied: ["0007_ops_more_actions.sql", "0008_list_indexes.sql", "0009_migration_compat.sql"], integrity: "ok" });
    expect(Object.keys(json)).toEqual(["ok", "file", "elapsed_ms", "migrate_ms", "from", "to", "applied", "ahead", "integrity", "foreign_key_violations", "tables", "problems"]);
    expect(typeof json.elapsed_ms).toBe("number");
    expect(r.err.join("\n")).toMatch(/^migrate-check: ok, 3 migrations applied to a copy in \d+ ms/);
  });

  it("exits 1 with ok false on a failure, still one JSON line", async () => {
    const r = await run([join(tmp(), "missing.db")]);
    expect(r.code).toBe(1);
    expect(r.out).toHaveLength(1);
    expect(JSON.parse(r.out[0]!)).toMatchObject({ ok: false });
    expect(r.err.join("\n")).toMatch(/^migrate-check failed: /);
  });

  it("exits 2 with a usage line and no JSON without exactly one file", async () => {
    for (const args of [[], ["a.db", "b.db"], ["--help"]]) {
      const r = await run(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.out).toEqual([]);
      expect(r.err.join("\n")).toMatch(/^Usage: node dist\/node\.js migrate-check <database file>/);
    }
  });

  it("is dispatched by the entry point before anything of the app is set up", () => {
    const file = fromFixture("0.4.0.sql");
    const before = fingerprint(file);
    const dataDir = tmp();
    // no APP_SECRET and a data dir of its own: the command must not create a secret or open the app database
    const r = spawnSync(TSX, ["--disable-warning=ExperimentalWarning", ENTRY, "migrate-check", file], {
      env: { PATH: process.env.PATH, TMPDIR: tmp(), DATA_DIR: dataDir },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, to: 9 });
    expect(fingerprint(file)).toEqual(before);
    expect(readdirSync(dataDir)).toEqual([]);
    expect(existsSync(join(dataDir, "..", "secrets", "app_secret"))).toBe(false);
  }, 60_000);

  it("the entry point exits 1 on a failing check", () => {
    const r = spawnSync(TSX, ["--disable-warning=ExperimentalWarning", ENTRY, "migrate-check", join(tmp(), "missing.db")], {
      env: { PATH: process.env.PATH, TMPDIR: tmp() },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false });
  }, 60_000);
});

describe("migrate-check scratch folder", () => {
  const scratchIn = (file: string) => readdirSync(join(file, "..")).filter((f) => f.startsWith(".talous-migrate-check-"));

  it("is made next to the file, so a small or missing temp folder does not matter", async () => {
    // under compose /tmp is a 16 MB tmpfs that counts against the memory limit; the copy needs about twice the database
    const file = fromFixture("0.4.0.sql");
    vi.stubEnv("TMPDIR", join(tmp(), "does-not-exist"));
    const report = await migrateCheck(file);
    expect(report.ok, report.problems.join("; ")).toBe(true);
  });

  it("is removed after an error and after a success", async () => {
    const file = fromFixture("0.5.0.sql");
    const before = fingerprint(file);
    const bad = migrationsWith({ "0010_unique.sql": "-- migrate: compat 0.6.0\nCREATE UNIQUE INDEX idx_one ON transactions(account_id);" });
    expect((await migrateCheck(file, { migrationsDir: bad, appVersion: "0.7.0" })).ok).toBe(false);
    expect(scratchIn(file)).toEqual([]);
    expect((await migrateCheck(file)).ok).toBe(true);
    expect(fingerprint(file)).toEqual(before);
    // an error before the copy exists: nothing was made, nothing is left
    const text = join(tmp(), "text.db");
    writeFileSync(text, "x".repeat(9000));
    expect((await migrateCheck(text)).ok).toBe(false);
    expect(scratchIn(text)).toEqual([]);
  });

  it("is removed when the process is told to stop, and the handlers go away with the check", () => {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      const dir = tmp();
      const scratch = join(dir, ".talous-migrate-check-x");
      mkdirSync(scratch);
      writeFileSync(join(scratch, "check.db"), "half a copy");
      const exits: number[] = [];
      const listeners = process.listenerCount(signal);
      const stop = removeOnSignal(scratch, ((c: number) => void exits.push(c)) as never);
      expect(process.listenerCount(signal)).toBe(listeners + 1);
      process.listeners(signal).at(-1)!(signal); // what the signal would call
      expect(existsSync(scratch), signal).toBe(false);
      expect(exits).toEqual([code]);
      stop();
      expect(process.listenerCount(signal)).toBe(listeners);
    }
  });

  it("clears a folder an earlier killed run left, and keeps a recent one", async () => {
    const file = fromFixture("0.4.0.sql");
    const dir = join(file, "..");
    const stale = join(dir, ".talous-migrate-check-stale");
    const recent = join(dir, ".talous-migrate-check-recent");
    for (const d of [stale, recent]) {
      mkdirSync(d);
      writeFileSync(join(d, "check.db"), "x");
    }
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(stale, old, old);
    expect((await migrateCheck(file)).ok).toBe(true);
    expect(scratchIn(file)).toEqual([".talous-migrate-check-recent"]);
  });

  it("lets the event loop run between its steps, so a stop signal is served", async () => {
    // node:sqlite is synchronous: without a yield the whole check is one run and a signal waits for its end
    let turns = 0;
    let done = false;
    const spin = () => {
      turns++;
      if (!done) setImmediate(spin);
    };
    setImmediate(spin);
    await migrateCheck(fromFixture("0.4.0.sql"));
    done = true;
    expect(turns).toBeGreaterThanOrEqual(2);
  });
});
