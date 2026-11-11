import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dailyBackup, openDatabase, takeSnapshot } from "../src/db/open.ts";
import { restoreDatabase } from "../src/db/restore.ts";
import { gateDatabase } from "../src/db/startup-gate.ts";

// Every file beside the database holds transactions in plain text (docs/SECURITY.md): each is mode 600 and its folder 700,
// whatever the umask of the process. 022 is the usual one, and with it SQLite and copyFile make files that all can read.
let umaskBefore = 0;
beforeAll(() => {
  umaskBefore = process.umask(0o022);
});
afterAll(() => {
  process.umask(umaskBefore);
});

const NOW = new Date("2026-10-12T04:00:00Z");
const realChmod = fs.chmodSync;
const dirs: string[] = [];
afterEach(() => {
  fs.chmodSync = realChmod;
  syncBuiltinESMExports();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A data folder on a real disk: the modes of a folder in memory are the same, but this is where a household's files are. */
function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), "talous-modes-"));
  dirs.push(dir);
  return { dir, path: join(dir, "banking.db"), backups: join(dir, "backups"), damaged: join(dir, "damaged") };
}

/** What a start of the server does with the database: the check before the open, then the open. */
async function start(path: string) {
  gateDatabase(path, NOW);
  const { db } = await openDatabase(path);
  return db;
}

/** A started household with one admin, so a copy of it passes the check of a restore. */
async function household() {
  const h = dataDir();
  const db = await start(h.path);
  db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u1', 'aino', 'X', 'h', 'admin', '2026-01-01')");
  return { ...h, db };
}

const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const modes = (dir: string) => Object.fromEntries(readdirSync(dir).map((f) => [f, mode(join(dir, f))]));

/** From here a chmod of one of `paths` fails as it does on a file another user owns. The code under test reads chmodSync from node:fs, so the built-in itself is replaced. */
function notTheOwners(...paths: string[]): string[] {
  fs.chmodSync = ((path: fs.PathLike, to: fs.Mode) => {
    if (paths.includes(String(path))) throw Object.assign(new Error(`EPERM: operation not permitted, chmod '${String(path)}'`), { code: "EPERM" });
    realChmod(path, to);
  }) as typeof fs.chmodSync;
  syncBuiltinESMExports();
  const logged: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
  return logged;
}

describe("the database and the files beside it are the owner's only", () => {
  it("the database a start opens, its -wal and its -shm are mode 600", async () => {
    const h = await household();
    expect(modes(h.dir)).toEqual({ "banking.db": "600", "banking.db-wal": "600", "banking.db-shm": "600" });
    h.db.close();
  });

  it("a database that was 644 before the start is 600 after it, with the -wal and -shm an earlier start left", async () => {
    const h = await household();
    h.db.close();
    chmodSync(h.path, 0o644);
    writeFileSync(`${h.path}-shm`, "");
    expect(modes(h.dir)).toEqual({ "banking.db": "644", "banking.db-shm": "644" });

    const db = await start(h.path);
    expect(modes(h.dir)).toEqual({ "banking.db": "600", "banking.db-wal": "600", "banking.db-shm": "600" });
    db.close();
  });

  it("the day's copy and a pre-* copy are mode 600 in a folder of mode 700", async () => {
    const h = await household();
    const daily = dailyBackup(h.db, h.path, "2026-10-12");
    const pre = takeSnapshot(h.db, h.path, "pre-0002_next", NOW);
    expect(mode(h.backups)).toBe("700");
    expect(modes(h.backups)).toEqual({ [basename(daily)]: "600", [basename(pre)]: "600" });
    h.db.close();
  });

  it("backups/ that was 755 is 700 after a copy", async () => {
    const h = await household();
    mkdirSync(h.backups);
    expect(mode(h.backups)).toBe("755");
    dailyBackup(h.db, h.path, "2026-10-12");
    expect(mode(h.backups)).toBe("700");
    h.db.close();
  });

  it("pre-restore-*.db is mode 600 when the database that is replaced opens", async () => {
    const h = await household();
    dailyBackup(h.db, h.path, "2026-10-11");
    h.db.close();
    chmodSync(h.backups, 0o755);

    restoreDatabase(h.path, "backups/auto-2026-10-11.db", NOW);
    expect(mode(h.backups)).toBe("700");
    expect(modes(h.backups)).toEqual({ "auto-2026-10-11.db": "600", "pre-restore-20261012T040000.db": "600" });
  });

  it("pre-restore-*.db and its -wal are mode 600 when the database that is replaced cannot be read", async () => {
    const h = await household();
    dailyBackup(h.db, h.path, "2026-10-11");
    // another process holds the database for itself: no second connection reads it, so the raw files are what is saved,
    // and the log is there because the database is open
    h.db.exec("PRAGMA locking_mode = EXCLUSIVE; CREATE TABLE held (x)");
    chmodSync(`${h.path}-wal`, 0o644);

    restoreDatabase(h.path, "backups/auto-2026-10-11.db", NOW);
    expect(modes(h.backups)).toEqual({ "auto-2026-10-11.db": "600", "pre-restore-20261012T040000.db": "600", "pre-restore-20261012T040000.db-wal": "600" });
    h.db.close();
  });

  it("the three files a start moves to damaged/ are mode 600, and damaged/ that was 755 is 700", async () => {
    const h = await household();
    dailyBackup(h.db, h.path, "2026-10-11");
    h.db.close();
    rmSync(h.path);
    writeFileSync(h.path, "this is not a database. ".repeat(200));
    writeFileSync(`${h.path}-wal`, "a log that belongs to the damaged file".repeat(4));
    writeFileSync(`${h.path}-shm`, "its index");
    mkdirSync(h.damaged);
    expect(mode(h.damaged)).toBe("755");

    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "restored", cause: "damaged" });
    expect(mode(h.damaged)).toBe("700");
    expect(modes(h.damaged)).toEqual({ "banking-20261012T040000.db": "600", "banking-20261012T040000.db-wal": "600", "banking-20261012T040000.db-shm": "600" });
    expect(mode(h.path)).toBe("600");
  });
});

describe("a file whose mode cannot be set (not the owner's)", () => {
  it("stops no start, and one log line names it", async () => {
    const h = await household();
    h.db.close();
    chmodSync(h.path, 0o644);
    const logged = notTheOwners(h.path);

    const db = await start(h.path);
    expect(await db.first("SELECT username FROM users")).toEqual({ username: "aino" });
    db.close();
    expect(mode(h.path)).toBe("644");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`${h.path} could not be set to mode 600 (EPERM)`);
    expect(logged[0]).not.toContain("\n");
  });

  it("stops no copy, and one log line names it", async () => {
    const h = await household();
    mkdirSync(h.backups);
    const part = join(h.backups, "auto-2026-10-12.db.part");
    const logged = notTheOwners(part);

    const file = dailyBackup(h.db, h.path, "2026-10-12");
    h.db.close();
    expect(existsSync(file)).toBe(true);
    expect(mode(h.backups)).toBe("700");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`${part} could not be set to mode 600 (EPERM)`);
  });

  it("a folder that cannot be set stops no copy either", async () => {
    const h = await household();
    mkdirSync(h.backups);
    const logged = notTheOwners(h.backups);

    const file = dailyBackup(h.db, h.path, "2026-10-12");
    h.db.close();
    expect(mode(file)).toBe("600");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`${h.backups} could not be set to mode 700 (EPERM)`);
  });
});
