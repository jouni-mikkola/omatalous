import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quickFileCheck, verifyDatabaseFile } from "../src/db/backup-check.ts";
import { dailyBackup, EmptyDatabaseError, openDatabase, takeSnapshot } from "../src/db/open.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { RestoreError, restoreDatabase } from "../src/db/restore.ts";
import { UserError } from "../src/platform/errors.ts";
import { backupForDownload, listAppBackups } from "../src/services/ops.ts";
import { setupApp, scratchDir } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = scratchDir("talous-dur-");
  dirs.push(d);
  return d;
};

/** A real database in <dir>/banking.db with one user. */
async function realDb(dir: string, username = "aino") {
  const path = join(dir, "banking.db");
  const { db } = await openDatabase(path);
  db.exec(`INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-${username}', '${username}', 'X', 'h', 'admin', '2026-01-01')`);
  return { path, db };
}
const names = (path: string): string[] => {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    return (d.prepare("SELECT username FROM users").all() as { username: string }[]).map((r) => r.username);
  } finally {
    d.close();
  }
};

describe("checking a database file", () => {
  it("accepts a real copy and names what is wrong with a bad one", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const good = join(dir, "good.db");
    db.exec(`VACUUM INTO '${good}'`);
    const ok = verifyDatabaseFile(good);
    expect(ok).toMatchObject({ ok: true, users: 1 });

    writeFileSync(join(dir, "empty.db"), "");
    expect(quickFileCheck(join(dir, "empty.db"))).toMatch(/empty/);
    writeFileSync(join(dir, "text.db"), "x".repeat(9000));
    expect(verifyDatabaseFile(join(dir, "text.db"))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a SQLite/) });

    const cut = join(dir, "cut.db");
    writeFileSync(cut, readFileSync(good));
    truncateSync(cut, Math.floor(readFileSync(good).length / 2));
    expect(verifyDatabaseFile(cut)).toMatchObject({ ok: false, reason: expect.stringMatching(/cut short/) });

    // a valid SQLite file that is not this app's
    const other = new DatabaseSync(join(dir, "other.db"));
    other.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1)");
    other.close();
    expect(verifyDatabaseFile(join(dir, "other.db"))).toMatchObject({ ok: false, reason: expect.stringMatching(/tables are missing/) });

    // a flipped page in the middle fails quick_check
    const bad = join(dir, "bad.db");
    const bytes = Buffer.from(readFileSync(good));
    bytes.fill(0xff, 4096 * 2, 4096 * 2 + 64);
    writeFileSync(bad, bytes);
    expect(verifyDatabaseFile(bad).ok).toBe(false);
    expect(path).toBeTruthy();
    db.close();
  });
});

describe("restore", () => {
  it("swaps the database, saves the old one first and drops the old WAL", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir, "uusi");
    db.exec(`VACUUM INTO '${join(dir, "restore.db")}'`);
    db.exec("DELETE FROM users");
    db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u2', 'vanha', 'X', 'h', 'admin', '2026-01-01')");
    db.close();
    writeFileSync(`${path}-wal`, "stale wal from the old database");

    const lines = restoreDatabase(path, "restore.db", new Date("2026-10-10T12:00:00Z"));
    expect(lines.join("\n")).toMatch(/Checked restore\.db: ok, 1 users/);
    expect(names(path)).toEqual(["uusi"]);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(join(dir, "restore.db"))).toBe(false);
    expect(existsSync(`${path}.restore-tmp`)).toBe(false);
    const saved = join(dir, "backups", "pre-restore-20261010T120000.db");
    expect(names(saved)).toEqual(["vanha"]);

    // the restored file starts as a normal database
    const reopened = await openDatabase(path);
    expect((await reopened.db.all<{ username: string }>("SELECT username FROM users")).map((u) => u.username)).toEqual(["uusi"]);
    reopened.db.close();
  });

  it("refuses an empty, cut-short, foreign or newer file and leaves the database as it was", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    db.exec(`VACUUM INTO '${join(dir, "good.db")}'`);
    db.close();
    const before = readFileSync(path);

    writeFileSync(join(dir, "empty.db"), "");
    expect(() => restoreDatabase(path, "empty.db", new Date())).toThrow(/not a usable database: the file is empty/);
    writeFileSync(join(dir, "cut.db"), readFileSync(join(dir, "good.db")).subarray(0, 6000));
    expect(() => restoreDatabase(path, "cut.db", new Date())).toThrow(RestoreError);

    const newer = join(dir, "newer.db");
    writeFileSync(newer, readFileSync(join(dir, "good.db")));
    const n = new DatabaseSync(newer);
    n.exec("INSERT INTO _migrations (name, applied_at, checksum) VALUES ('9999_future.sql', 'x', 'y')");
    n.exec("PRAGMA journal_mode = DELETE");
    n.close();
    expect(() => restoreDatabase(path, "newer.db", new Date())).toThrow(/newer app version/);

    expect(() => restoreDatabase(path, "banking.db", new Date())).toThrow(/live database/);
    expect(() => restoreDatabase(path, "../outside.db", new Date())).toThrow(/outside the data folder|cannot be read/);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });

  it("works on an empty live database and keeps a file taken from backups/", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const copy = takeSnapshot(db, path, "pre-test", new Date("2026-10-01T10:00:00Z"));
    db.close();
    rmSync(path);
    writeFileSync(path, "");
    const lines = restoreDatabase(path, copy, new Date());
    expect(lines.some((l) => l.startsWith("The current database is saved"))).toBe(false);
    expect(names(path)).toEqual(["aino"]);
    expect(existsSync(copy)).toBe(true);
  });
});

describe("opening over lost data", () => {
  it("refuses an empty file when copies exist, and starts fresh when none do", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    takeSnapshot(db, path, "pre-x", new Date("2026-10-01T10:00:00Z"));
    db.close();
    rmSync(path);
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
    writeFileSync(path, "");
    const err = await openDatabase(path).catch((e: Error) => e);
    expect(err).toBeInstanceOf(EmptyDatabaseError);
    expect((err as Error).message).toMatch(/not a new install[\s\S]*node dist\/node\.js restore backups\/pre-x-/);

    // a fresh folder without copies is a normal first start
    const fresh = tmp();
    writeFileSync(join(fresh, "banking.db"), "");
    const ok = await openDatabase(join(fresh, "banking.db"));
    expect(ok.applied.length).toBeGreaterThan(0);
    ok.db.close();
  });
});

describe("verified copies", () => {
  it("removes a copy that fails its check and a copy that could not be written", async () => {
    const dir = tmp();
    const path = join(dir, "banking.db");
    const file = join(dir, "backups", "auto-2026-10-10.db");
    // the copy is written under the name in the statement (a part file) and gets its own name when it is good
    const target = (sql: string) => /^VACUUM INTO '(.+)'$/.exec(sql)![1]!;
    // a database whose VACUUM INTO leaves an empty file, as a full disk does
    const empty = { exec: (sql: string) => writeFileSync(target(sql), "") };
    expect(() => dailyBackup(empty, path, "2026-10-10")).toThrow(/failed its check and was removed: the file is empty/);
    expect(readdirSync(join(dir, "backups"))).toEqual([]);
    const failing = {
      exec: (sql: string) => {
        writeFileSync(target(sql), "partial");
        throw new Error("database or disk is full");
      },
    };
    expect(() => dailyBackup(failing, path, "2026-10-10")).toThrow(/disk is full/);
    expect(readdirSync(join(dir, "backups"))).toEqual([]);
  });

  it("lists only usable copies and downloads the newest one that passes", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const backups = join(dir, "backups");
    mkdirSync(backups);
    db.exec(`VACUUM INTO '${join(backups, "auto-2026-10-08.db")}'`);
    db.exec(`VACUUM INTO '${join(backups, "auto-2026-10-09.db")}'`);
    writeFileSync(join(backups, "auto-2026-10-10.db"), ""); // a leftover of a full disk
    writeFileSync(join(backups, "pre-update-x.db"), "x".repeat(9000));
    // a copy that is complete but damaged inside: only the full check at download time sees it
    const damaged = Buffer.from(readFileSync(join(backups, "auto-2026-10-09.db")));
    damaged.fill(0xff, 4096 * 2, 4096 * 2 + 64);
    writeFileSync(join(backups, "auto-2026-10-09.db"), damaged);
    utimesSync(join(backups, "auto-2026-10-09.db"), new Date("2026-10-09T10:00:00Z"), new Date("2026-10-09T10:00:00Z"));
    utimesSync(join(backups, "auto-2026-10-08.db"), new Date("2026-10-08T10:00:00Z"), new Date("2026-10-08T10:00:00Z"));
    db.close();

    const t = await setupApp({}, undefined, { backupDir: backups });
    // the file with the bad header is out, the others are listed
    expect(listAppBackups(t.s).map((b) => b.name).sort()).toEqual(["auto-2026-10-08.db", "auto-2026-10-09.db"]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = (await t.s.users.list())[0]!;
    const got = await backupForDownload(t.s, user, "aino-salasana-123", { ip: "1.1.1.1", userAgent: "t" });
    expect(got.name).toBe("auto-2026-10-08.db");
    await new Promise<void>((resolve) => got.stream.on("close", () => resolve()).destroy());
    expect(errors.mock.calls.flat().join(" ")).toMatch(/auto-2026-10-09\.db failed its check/);
    expect(readdirSync(backups)).toContain("auto-2026-10-10.db"); // listing never deletes
  });
});

describe("node-sqlite errors", () => {
  it("keeps the real error when ROLLBACK fails after a full disk", async () => {
    const dir = tmp();
    const db = openNodeSqlite(join(dir, "t.db"));
    db.exec("CREATE TABLE t (x TEXT)");
    db.exec("PRAGMA max_page_count = 4");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = Array.from({ length: 200 }, () => ({ sql: "INSERT INTO t VALUES (?)", params: ["x".repeat(1000)] }));
    const err = await db.batch(rows).catch((e: Error) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toBe("Levy on täynnä, eikä tietoja voitu tallentaa. Pyydä ylläpitäjää vapauttamaan tilaa.");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/the disk is full \(SQLITE_FULL\)/);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/cannot rollback/);
    // nothing was half written and the connection works after space is back
    db.exec("PRAGMA max_page_count = 100000");
    expect(await db.first("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 0 });
    await db.batch(rows.slice(0, 3));
    expect(await db.first("SELECT COUNT(*) AS n FROM t")).toEqual({ n: 3 });
    db.close();
  });

  it("turns a locked database into a Finnish message and a log line", async () => {
    const dir = tmp();
    const file = join(dir, "t.db");
    const a = openNodeSqlite(file);
    a.exec("CREATE TABLE t (x TEXT)");
    const b = openNodeSqlite(file, { busyTimeoutMs: 30 });
    a.exec("BEGIN IMMEDIATE");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await b.run("INSERT INTO t VALUES ('x')").catch((e: Error) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toBe("Tietokanta on varattu. Yritä hetken päästä uudelleen.");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/SQLITE_BUSY/);
    a.exec("ROLLBACK");
    a.close();
    b.close();
  });
});

describe("scripts/lib/dbcopy.sh (the copy that update.sh, backup.sh and the helper make in the container)", () => {
  /** `preload` is a script node loads first: the tests' way to give the disk a free space of their choice. */
  const run = (data: string, options: string, target: string, preload?: string) =>
    spawnSync("bash", ["-c", '. scripts/lib/dbcopy.sh; node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" "$0" "$1"', options, target], {
      cwd: join(import.meta.dirname, "../../.."),
      env: { ...process.env, DBCOPY_DATA: data, ...(preload ? { NODE_OPTIONS: `--require=${preload}` } : {}) },
      encoding: "utf8",
    });

  it("writes a checked copy and keeps the five newest of a name pattern", async () => {
    const dir = tmp();
    const { db } = await realDb(dir);
    db.close();
    const backups = join(dir, "backups");
    mkdirSync(backups);
    for (let i = 1; i <= 7; i++) writeFileSync(join(backups, `manual-2026010${i}T000000Z.db`), "old");
    const r = run(dir, "keep:^manual-[0-9TZ]+\\.db$", join(backups, "manual-20261010T000000Z.db"));
    expect(r.status).toBe(0);
    expect(names(join(backups, "manual-20261010T000000Z.db"))).toEqual(["aino"]);
    expect(readdirSync(backups).sort()).toEqual(["manual-20260104T000000Z.db", "manual-20260105T000000Z.db", "manual-20260106T000000Z.db", "manual-20260107T000000Z.db", "manual-20261010T000000Z.db"]);
  });

  it("keep: never deletes the three newest intact copies, and nothing while the live database is damaged", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const backups = join(dir, "backups");
    mkdirSync(backups);
    const name = (day: number) => `manual-2026010${day}T000000Z.db`;
    // the intact copies are the oldest; the newer names are what a full disk left behind
    for (let day = 1; day <= 3; day++) {
      db.exec(`VACUUM INTO '${join(backups, name(day))}'`);
      utimesSync(join(backups, name(day)), new Date(`2026-01-0${day}T00:00:00Z`), new Date(`2026-01-0${day}T00:00:00Z`));
    }
    db.close();
    for (let day = 4; day <= 8; day++) writeFileSync(join(backups, name(day)), "cut short");
    const r = run(dir, "keep:^manual-[0-9TZ]+\\.db$", join(backups, "manual-20261010T000000Z.db"));
    expect(r.status, r.stderr).toBe(0);
    // by name the new copy and 05 to 08 stay. Of 01 to 04 the count would take all: 03 and 02 stay, with the new copy they are the three.
    expect(readdirSync(backups).sort()).toEqual([name(2), name(3), name(5), name(6), name(7), name(8), "manual-20261010T000000Z.db"]);

    // `prune` makes no copy and applies the same rule to the folder
    for (let day = 4; day <= 5; day++) writeFileSync(join(backups, `manual-2026020${day}T000000Z.db`), "cut short");
    const damaged = Buffer.from(readFileSync(path));
    const healthy = Buffer.from(damaged);
    damaged.fill(0xff, 4096, 4096 * 4);
    writeFileSync(path, damaged);
    const before = readdirSync(backups).sort();
    const held = run(dir, "prune,keep:^manual-[0-9TZ]+\\.db$", backups);
    expect(held.status, held.stderr).toBe(0);
    expect(held.stderr).toMatch(/database copies are not pruned: the live database /);
    expect(readdirSync(backups).sort()).toEqual(before);

    writeFileSync(path, healthy);
    const pruned = run(dir, "prune,keep:^manual-[0-9TZ]+\\.db$", backups);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(readdirSync(backups).sort()).toEqual([name(2), name(3), name(7), name(8), "manual-20260204T000000Z.db", "manual-20260205T000000Z.db", "manual-20261010T000000Z.db"]);
    expect(run(dir, "prune,keep:^manual-", join(dir, "no-such-folder")).status).toBe(0);
  });

  it("does not start a copy on a disk without twice the database and its WAL free", async () => {
    const dir = tmp();
    const { db } = await realDb(dir);
    db.close();
    const backups = join(dir, "backups");
    mkdirSync(backups);
    const target = join(backups, "pre-update-20261010T000000Z.db");
    writeFileSync(target, "a file of that name from before");
    // a preload in place of a full disk: one free block
    const preload = join(dir, "full.cjs");
    writeFileSync(preload, 'require("node:fs").statfsSync = () => ({ bavail: 1, bsize: 4096 });\n');
    const r = spawnSync("bash", ["-c", '. scripts/lib/dbcopy.sh; node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" exists "$0"', target], {
      cwd: join(import.meta.dirname, "../../.."),
      env: { ...process.env, DBCOPY_DATA: dir, NODE_OPTIONS: `--require=${preload}` },
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/database copy failed: not enough free space in .*backups: 0\.0 MB free, a copy needs \d+\.\d MB \(twice the database and its WAL\)/);
    // a refusal removes nothing
    expect(readFileSync(target, "utf8")).toBe("a file of that name from before");
  });

  it("room:3 asks for three times the database, which is what update.sh asks before it switches", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    db.close();
    const backups = join(dir, "backups");
    mkdirSync(backups);
    const size = statSync(path).size + (existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0);
    // Between twice and three times the database free: room for one copy. After it the new version would find too
    // little for its copy before a migration, and by then the old version is gone.
    const preload = join(dir, "free.cjs");
    writeFileSync(preload, `require("node:fs").statfsSync = () => ({ bavail: ${Math.ceil((2.5 * size) / 4096)}, bsize: 4096 });\n`);
    const target = join(backups, "pre-update-20261010T000000Z.db");
    const refused = run(dir, "exists,room:3", target, preload);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/database copy failed: not enough free space in .*backups: \d+\.\d MB free, a copy needs /);
    expect(refused.stderr).toContain(`a copy needs ${((3 * size) / 1048576).toFixed(1)} MB (3 times the database and its WAL)`);
    expect(readdirSync(backups)).toEqual([]);
    expect(run(dir, "exists", target, preload).status).toBe(0);
    expect(readdirSync(backups)).toEqual(["pre-update-20261010T000000Z.db"]);

    const update = readFileSync(join(import.meta.dirname, "../../../scripts/update.sh"), "utf8");
    expect(update).toMatch(/in_app -e "\$DBCOPY_JS" exists,room:3 "\$snapshot" \|\| die "[^"\n]*three times the size of the database/);
  });

  it("keep: counts among the three only the copies a restore would take", async () => {
    const dir = tmp();
    const { db } = await realDb(dir);
    const backups = join(dir, "backups");
    mkdirSync(backups);
    const name = (day: number) => `manual-2026010${day}T000000Z.db`;
    const intact = (file: string, at: string) => {
      db.exec(`VACUUM INTO '${join(backups, file)}'`);
      utimesSync(join(backups, file), new Date(at), new Date(at));
    };
    for (let day = 1; day <= 3; day++) intact(name(day), `2026-01-0${day}T00:00:00Z`);
    // what two restores saved is intact and newer than those copies: it takes no place among the three
    intact("pre-restore-20260601T000000.db", "2026-06-01T00:00:00Z");
    intact("pre-restore-20260602T000000.db", "2026-06-02T00:00:00Z");
    intact("kopio.db", "2025-12-01T00:00:00Z");
    db.close();
    for (let day = 4; day <= 8; day++) writeFileSync(join(backups, name(day)), "cut short");
    const keep = "keep:^manual-[0-9TZ]+\\.db$";
    const r = run(dir, keep, join(backups, "manual-20261010T000000Z.db"));
    expect(r.status, r.stderr).toBe(0);
    // by name the new copy and 05 to 08 stay. The three are the new copy, 03 and 02, as without the pre-restore copies.
    const saved = ["pre-restore-20260601T000000.db", "pre-restore-20260602T000000.db"];
    expect(readdirSync(backups).sort()).toEqual(["kopio.db", name(2), name(3), name(5), name(6), name(7), name(8), "manual-20261010T000000Z.db", ...saved]);

    // a copy somebody put there under a name of their own is one a restore would take: with it and the new copy, 03 is the third
    utimesSync(join(backups, "kopio.db"), new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
    expect(run(dir, `prune,${keep}`, backups).status).toBe(0);
    expect(readdirSync(backups).sort()).toEqual(["kopio.db", name(3), name(5), name(6), name(7), name(8), "manual-20261010T000000Z.db", ...saved]);
  });

  it("removes a copy that fails its check and exits 1, and does nothing without a database when told so", () => {
    const dir = tmp();
    // a SQLite file without this app's tables
    const other = new DatabaseSync(join(dir, "banking.db"));
    other.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('y')");
    other.close();
    const target = join(dir, "backups", "pre-update-x.db");
    const bad = run(dir, "-", target);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/database copy failed: (the copy is empty or too small|the copy has no table _migrations)/);
    expect(existsSync(target)).toBe(false);

    const empty = tmp();
    expect(run(empty, "exists", join(empty, "x.db")).status).toBe(0);
    const missing = run(empty, "-", join(empty, "x.db"));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/there is no database/);
  });

  it("DBCHECK_JS (what a rollback checks before it stops anything) accepts an intact copy and refuses a missing, damaged or foreign file", async () => {
    const dir = tmp();
    const { db } = await realDb(dir);
    db.close();
    const check = (file: string) =>
      spawnSync("bash", ["-c", '. scripts/lib/dbcopy.sh; node --disable-warning=ExperimentalWarning -e "$DBCHECK_JS" "$0"', file], { cwd: join(import.meta.dirname, "../../.."), encoding: "utf8" });
    expect(check(join(dir, "banking.db")).status).toBe(0);

    const missing = check(join(dir, "gone.db"));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/database copy unusable: .*(ENOENT|no such file)/i);
    // read-only: the missing file is not created
    expect(existsSync(join(dir, "gone.db"))).toBe(false);

    // overwrite a stretch after the header: the file still opens, its pages do not pass quick_check
    const damaged = join(dir, "damaged.db");
    const bytes = readFileSync(join(dir, "banking.db"));
    bytes.fill(0xff, 4096, Math.min(bytes.length, 4096 * 4));
    writeFileSync(damaged, bytes);
    expect(check(damaged).status).toBe(1);

    const garbage = join(dir, "garbage.db");
    writeFileSync(garbage, "not a database at all");
    expect(check(garbage).status).toBe(1);

    const foreign = join(dir, "foreign.db");
    const other = new DatabaseSync(foreign);
    other.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('y')");
    other.close();
    const r = check(foreign);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no migration history/);
  });

  it("flushes the copy to disk and then its folder", async () => {
    const dir = tmp();
    const { db } = await realDb(dir);
    db.close();
    const backups = join(dir, "backups");
    // a preload that reports every fsync with the path its descriptor was opened for
    const preload = join(dir, "spy.cjs");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const open = fs.openSync;
const fds = new Map();
fs.openSync = function (p, ...a) { const fd = open.call(this, p, ...a); fds.set(fd, String(p)); return fd; };
const sync = fs.fsyncSync;
fs.fsyncSync = function (fd) { fs.writeSync(2, "FSYNC " + fds.get(fd) + "\\n"); return sync.call(this, fd); };
`,
    );
    const target = join(backups, "pre-update-20261010T000000Z.db");
    const r = spawnSync("bash", ["-c", '. scripts/lib/dbcopy.sh; node --disable-warning=ExperimentalWarning -e "$DBCOPY_JS" - "$0"', target], {
      cwd: join(import.meta.dirname, "../../.."),
      env: { ...process.env, DBCOPY_DATA: dir, NODE_OPTIONS: `--require=${preload}` },
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    const synced = r.stderr.split("\n").filter((l) => l.startsWith("FSYNC ")).map((l) => l.slice(6));
    expect(synced).toContain(target);
    expect(synced).toContain(backups);
    // the file first, the folder after the checks
    expect(synced.indexOf(target)).toBeLessThan(synced.indexOf(backups));
  });
});
