import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { copiesNewestFirst, NoRoomError, protectedCopies, restorableCopyName, type Statfs } from "../src/db/backup-keep.ts";
import { MigrationError } from "../src/db/migrate.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { dailyBackup, findMigrationsDir, openDatabase, pruneBackupsByAge, takeSnapshot } from "../src/db/open.ts";
import { newestIntactCopy } from "../src/db/restore.ts";
import type { Services } from "../src/services/context.ts";
import { diskState, keepReserve, RESERVE_BYTES, RESERVE_FILE, startReserve } from "../src/services/disk.ts";
import { listAppBackups } from "../src/services/ops.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { NOW, setupApp } from "./helpers.ts";

// the tick's call is counted, the reserve itself stays real
vi.mock("../src/services/disk.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/services/disk.ts")>();
  return { ...real, keepReserve: vi.fn(real.keepReserve) };
});
// one switch makes the flush of a folder fail, every other flush is real
const flush = vi.hoisted(() => ({ failDir: false }));
vi.mock("../src/platform/durable.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/platform/durable.ts")>();
  return {
    ...real,
    fsyncDir: (dir: string) => {
      if (flush.failDir) throw new Error("EIO: dir");
      real.fsyncDir(dir);
    },
  };
});

const DAY = 86_400_000;
const MB = 1_048_576;
const dirs: string[] = [];
/** One migrated database with a user; every test copies the file instead of migrating again. */
let template = "";
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "talous-keep-template-"));
  template = join(dir, "template.db");
  const { db } = await openDatabase(join(dir, "source.db"));
  db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-aino', 'aino', 'X', 'h', 'admin', '2026-01-01')");
  db.exec(`VACUUM INTO '${template}'`);
  db.close();
});
afterAll(() => rmSync(join(template, ".."), { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  flush.failDir = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A data folder: the live database and an empty backups/. */
function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), "talous-keep-"));
  dirs.push(dir);
  copyFileSync(template, join(dir, "banking.db"));
  mkdirSync(join(dir, "backups"));
  return { dir, path: join(dir, "banking.db"), backups: join(dir, "backups"), files: () => readdirSync(join(dir, "backups")).sort() };
}
const written = (file: string, daysAgo: number) => {
  const t = (NOW.getTime() - daysAgo * DAY) / 1000;
  utimesSync(file, t, t);
};
/** A copy that opens and passes its check, written `daysAgo` days before NOW. */
function intact(backups: string, name: string, daysAgo: number) {
  copyFileSync(template, join(backups, name));
  written(join(backups, name), daysAgo);
}
/** What a full disk or a power cut leaves under a good name. */
function junk(backups: string, name: string, daysAgo: number) {
  writeFileSync(join(backups, name), "cut short");
  written(join(backups, name), daysAgo);
}
/** Complete on the outside, broken pages inside: only quick_check sees it. The time it was written stays. */
function damage(file: string) {
  const bytes = Buffer.from(readFileSync(file));
  bytes.fill(0xff, 4096, 4096 * 4);
  const { mtime } = statSync(file);
  writeFileSync(file, bytes);
  utimesSync(file, mtime, mtime);
}
/** A disk with this many MB free. */
const free = (mb: number): Statfs => () => ({ bavail: mb * 256, bsize: 4096 });

describe("protected copies", () => {
  it("three intact copies of 30 days survive the age limit", () => {
    const d = dataDir();
    for (let day = 6; day <= 9; day++) intact(d.backups, `auto-2026-09-0${day}.db`, 39 - day);
    intact(d.backups, "pre-0003_x-20260722T000000.db", 79);
    intact(d.backups, "pre-0004_x-20260801T000000.db", 69);
    expect([...protectedCopies(d.backups)].sort()).toEqual(["auto-2026-09-07.db", "auto-2026-09-08.db", "auto-2026-09-09.db"]);

    // every copy is past the 14 days: without protection only the newest pre copy would be left
    expect(pruneBackupsByAge(d.dir, NOW).sort()).toEqual(["auto-2026-09-06.db", "pre-0003_x-20260722T000000.db"]);
    expect(d.files()).toEqual(["auto-2026-09-07.db", "auto-2026-09-08.db", "auto-2026-09-09.db", "pre-0004_x-20260801T000000.db"]);
    expect(pruneBackupsByAge(d.dir, NOW)).toEqual([]);

    // copies of every kind count, newest by the time written
    intact(d.backups, "pre-update-20261001T000000Z.db", 8);
    intact(d.backups, "manual-20261002T000000Z.db", 7);
    expect([...protectedCopies(d.backups)].sort()).toEqual(["auto-2026-09-09.db", "manual-20261002T000000Z.db", "pre-update-20261001T000000Z.db"]);
  });

  it("the keep counts of the daily copy and of a snapshot leave them too", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    // the seven newest daily names are junk, the intact copies are older
    for (let day = 1; day <= 7; day++) junk(d.backups, `auto-2026-10-0${day}.db`, 9 - day);
    intact(d.backups, "auto-2026-09-28.db", 11);
    intact(d.backups, "auto-2026-09-29.db", 10);
    intact(d.backups, "auto-2026-09-30.db", 9);
    dailyBackup(db, d.path, "2026-10-08");
    // by name 10-02 to 10-08 stay. Of the rest the new copy, 09-30 and 09-29 are the three that must stay.
    expect(d.files()).toEqual(["auto-2026-09-29.db", "auto-2026-09-30.db", ...["02", "03", "04", "05", "06", "07", "08"].map((n) => `auto-2026-10-${n}.db`)]);

    const s = dataDir();
    const live = openNodeSqlite(s.path);
    for (let i = 1; i <= 5; i++) junk(s.backups, `pre-update-2026100${i}T000000Z.db`, 6 - i);
    intact(s.backups, "pre-update-20260928T000000Z.db", 11);
    intact(s.backups, "pre-update-20260929T000000Z.db", 10);
    intact(s.backups, "pre-update-20260930T000000Z.db", 9);
    const file = takeSnapshot(live, s.path, "pre-0009_x", NOW);
    // five by the time written: the new one and four junk. The oldest junk and the oldest intact copy go.
    expect(s.files()).toEqual([
      "pre-0009_x-20261009T100000.db",
      "pre-update-20260929T000000Z.db",
      "pre-update-20260930T000000Z.db",
      ...["2", "3", "4", "5"].map((n) => `pre-update-2026100${n}T000000Z.db`),
    ]);
    expect(file).toBe(join(s.backups, "pre-0009_x-20261009T100000.db"));
    db.close();
    live.close();
  });

  it("a damaged newest copy is not protected and the next one is", () => {
    const d = dataDir();
    for (let day = 1; day <= 5; day++) intact(d.backups, `auto-2026-09-0${day}.db`, 39 - day);
    damage(join(d.backups, "auto-2026-09-05.db"));
    junk(d.backups, "manual-20260906T000000Z.db", 33);
    expect([...protectedCopies(d.backups)].sort()).toEqual(["auto-2026-09-02.db", "auto-2026-09-03.db", "auto-2026-09-04.db"]);

    expect(pruneBackupsByAge(d.dir, NOW).sort()).toEqual(["auto-2026-09-01.db", "auto-2026-09-05.db"]);
    expect(d.files()).toEqual(["auto-2026-09-02.db", "auto-2026-09-03.db", "auto-2026-09-04.db", "manual-20260906T000000Z.db"]);
  });

  it("nothing is pruned over a damaged live database", () => {
    const d = dataDir();
    for (let day = 1; day <= 5; day++) intact(d.backups, `auto-2026-09-0${day}.db`, 39 - day);
    damage(d.path);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(pruneBackupsByAge(d.dir, NOW)).toEqual([]);
    expect(d.files()).toHaveLength(5);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/database copies are not pruned: the live database .*banking\.db fails its check/);

    // the same folder with a healthy database loses the two oldest
    copyFileSync(template, d.path);
    expect(pruneBackupsByAge(d.dir, NOW).sort()).toEqual(["auto-2026-09-01.db", "auto-2026-09-02.db"]);
  });

  it("counts the copies a restore would take: any plain name, and never what a restore saved", () => {
    for (const name of ["auto-2026-10-09.db", "pre-update-20261009T100000Z.db", "pre-0009_x-20261009T100000.db", "manual-20261009T100000Z.db", "kopio.db"]) {
      expect(restorableCopyName(name), name).toBe(true);
    }
    for (const name of ["pre-restore-20261009T100000.db", "auto-2026-10-09.db.part", "auto-2026-10-09.db-wal", "../banking.db", ".hidden.db", "notes.txt"]) {
      expect(restorableCopyName(name), name).toBe(false);
    }

    const d = dataDir();
    for (let day = 1; day <= 4; day++) intact(d.backups, `auto-2026-09-0${day}.db`, 39 - day);
    // what two restores saved is intact and newer than every copy, and so is a link: neither takes a place
    intact(d.backups, "pre-restore-20260910T000000.db", 29);
    intact(d.backups, "pre-restore-20260911T000000.db", 28);
    symlinkSync(template, join(d.backups, "link.db"));
    expect([...protectedCopies(d.backups)].sort()).toEqual(["auto-2026-09-02.db", "auto-2026-09-03.db", "auto-2026-09-04.db"]);
    // the age rule takes them as before: the newest pre copy stays, the older one goes
    expect(pruneBackupsByAge(d.dir, NOW).sort()).toEqual(["auto-2026-09-01.db", "pre-restore-20260910T000000.db"]);

    // a copy somebody put there under a name of their own is one a restore would take
    intact(d.backups, "kopio.db", 20);
    expect([...protectedCopies(d.backups)].sort()).toEqual(["auto-2026-09-03.db", "auto-2026-09-04.db", "kopio.db"]);
    expect(pruneBackupsByAge(d.dir, NOW)).toEqual(["auto-2026-09-02.db"]);
  });

  it("every reader of the copies sees one order: newest first, and of two written at once the later name first", () => {
    const d = dataDir();
    // three of one moment, an older one, a newest one that is cut short, and two things that are no file
    for (const name of ["auto-2026-10-08.db", "manual-20261008T000000Z.db", "pre-update-20261008T000000Z.db"]) intact(d.backups, name, 1);
    intact(d.backups, "auto-2026-10-07.db", 2);
    junk(d.backups, "auto-2026-10-09.db", 0);
    symlinkSync(template, join(d.backups, "link.db"));
    mkdirSync(join(d.backups, "folder.db"));
    const order = ["auto-2026-10-09.db", "pre-update-20261008T000000Z.db", "manual-20261008T000000Z.db", "auto-2026-10-08.db", "auto-2026-10-07.db"];
    expect(copiesNewestFirst(d.backups).map((c) => c.name)).toEqual(order);
    // the copy a restore takes, the three the pruning protects and the list on the page: that order, less what is not whole
    expect(newestIntactCopy(d.backups)?.name).toBe(order[1]);
    expect([...protectedCopies(d.backups)]).toEqual(order.slice(1, 4));
    expect(listAppBackups({ backupDir: d.backups } as Services).map((b) => b.name)).toEqual(order.slice(1));

    // the age rule keeps the newest snapshot: of two of one moment that is the later name
    for (const name of ["pre-restore-20260801T000000.db", "pre-restore-20260801T000001.db"]) intact(d.backups, name, 60);
    expect(copiesNewestFirst(d.backups, (name) => name.startsWith("pre-restore-")).map((c) => c.name)).toEqual(["pre-restore-20260801T000001.db", "pre-restore-20260801T000000.db"]);
    rmSync(join(d.backups, "pre-update-20261008T000000Z.db"));
    expect(pruneBackupsByAge(d.dir, NOW)).toEqual(["pre-restore-20260801T000000.db"]);
  });
});

describe("a copy under a name that is taken", () => {
  /** A database whose VACUUM INTO leaves this at the path it was asked to write, and fails with this. */
  const failing = (leaves: string, error?: string) => ({
    exec: (sql: string) => {
      writeFileSync(/^VACUUM INTO '(.+)'$/.exec(sql)![1]!, leaves);
      if (error) throw new Error(error);
    },
  });

  it("a copy that fails leaves the one of that name from before, and no part file", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    const file = dailyBackup(db, d.path, "2026-10-09");
    const before = readFileSync(file);
    // the day's copy is taken again (a failed tick released backup_day), and this time the write fails
    expect(() => dailyBackup(failing("partial", "disk I/O error"), d.path, "2026-10-09")).toThrow(/disk I\/O error/);
    expect(() => dailyBackup(failing(""), d.path, "2026-10-09")).toThrow(/failed its check and was removed: the file is empty/);
    expect(d.files()).toEqual(["auto-2026-10-09.db"]);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect([...protectedCopies(d.backups)]).toEqual(["auto-2026-10-09.db"]);

    // A good copy takes the name. When the folder's flush fails after that, the older copy is gone already, so the new one stays.
    db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-eero', 'eero', 'X', 'h', 'admin', '2026-01-01')");
    flush.failDir = true;
    expect(() => dailyBackup(db, d.path, "2026-10-09")).toThrow(/EIO: dir/);
    const copy = new DatabaseSync(file, { readOnly: true });
    expect((copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
    copy.close();
    // a first copy of a name does not stay when its folder could not be flushed
    expect(() => dailyBackup(db, d.path, "2026-10-08")).toThrow(/EIO: dir/);
    expect(d.files()).toEqual(["auto-2026-10-09.db"]);
    db.close();
  });

  it("a part file a power cut left goes with the next copy, and a young one of another copy stays", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    const part = (name: string, hoursAgo: number) => {
      writeFileSync(join(d.backups, name), "cut short");
      const t = Date.now() / 1000 - hoursAgo * 3600;
      utimesSync(join(d.backups, name), t, t);
    };
    part("pre-0003_x-20260101T000000.db.part", 2);
    part("manual-20261009T095900Z.db.part", 0);
    part("auto-2026-10-09.db.part", 0);
    dailyBackup(db, d.path, "2026-10-09");
    expect(d.files()).toEqual(["auto-2026-10-09.db", "manual-20261009T095900Z.db.part"]);
    db.close();
  });
});

describe("room for a copy", () => {
  it("refuses a copy on a disk without twice the database and its WAL, and says both sizes", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    intact(d.backups, "auto-2026-10-09.db", 0);
    const before = readFileSync(join(d.backups, "auto-2026-10-09.db"));
    const size = statSync(d.path).size + (existsSync(`${d.path}-wal`) ? statSync(`${d.path}-wal`).size : 0);
    const short: Statfs = () => ({ bavail: Math.floor((2 * size) / 4096) - 1, bsize: 4096 });

    const err = (() => {
      try {
        dailyBackup(db, d.path, "2026-10-09", { statfs: short });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(NoRoomError);
    expect(err!.message).toMatch(/not enough free space for a database copy: .*backups has \d+\.\d MB free and a copy needs \d+\.\d MB \(twice the database and its WAL, \d+\.\d MB\)/);
    expect(err!.message).toContain(`a copy needs ${((2 * size) / MB).toFixed(1)} MB`);
    // the copy of that name from before is not touched
    expect(readFileSync(join(d.backups, "auto-2026-10-09.db")).equals(before)).toBe(true);
    expect(() => takeSnapshot(db, d.path, "pre-0009_x", NOW, { statfs: free(0) })).toThrow(NoRoomError);
    expect(d.files()).toEqual(["auto-2026-10-09.db"]);

    // exactly twice is enough, and a disk that cannot be measured does not stop a copy
    const exact: Statfs = () => ({ bavail: Math.ceil((2 * size) / 4096), bsize: 4096 });
    expect(dailyBackup(db, d.path, "2026-10-08", { statfs: exact })).toBe(join(d.backups, "auto-2026-10-08.db"));
    const unknown: Statfs = () => {
      throw new Error("ENOSYS");
    };
    expect(dailyBackup(db, d.path, "2026-10-07", { statfs: unknown })).toBe(join(d.backups, "auto-2026-10-07.db"));
    db.close();
  });

  it("a snapshot refused before a migration says why and changes nothing", async () => {
    const d = dataDir();
    const migrations = join(d.dir, "migrations");
    cpSync(findMigrationsDir(), migrations, { recursive: true });
    writeFileSync(join(migrations, "9001_account_note.sql"), "ALTER TABLE accounts ADD COLUMN note TEXT;");

    const err = await openDatabase(d.path, migrations, () => NOW, { statfs: free(0) }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toMatch(
      /^No copy could be made before migrating, so 9001_account_note\.sql did not run and the database is unchanged: not enough free space for a database copy: .* has 0\.0 MB free and a copy needs \d+\.\d MB/,
    );
    const live = new DatabaseSync(d.path, { readOnly: true });
    expect((live.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map((c) => c.name)).not.toContain("note");
    live.close();
    expect(d.files()).toEqual([]);

    // with room the same start takes its copy and migrates
    const ok = await openDatabase(d.path, migrations, () => NOW, { statfs: free(4000) });
    expect(ok.applied).toEqual(["9001_account_note.sql"]);
    expect(d.files()).toEqual(["pre-9001_account_note-20261009T100000.db"]);
    ok.db.close();
  });
});

describe("the reserve", () => {
  it("is written, released and written again", () => {
    const d = dataDir();
    const s = { backupDir: d.backups };
    const file = join(d.dir, RESERVE_FILE);
    expect(diskState(s, free(2000))).toEqual({ freeBytes: 2000 * MB, reserve: "missing" });
    // only a server that started the reserve keeps it: a CLI run or a test with a data folder writes nothing
    expect(keepReserve(s, free(2000)).reserve).toBe("missing");
    expect(existsSync(file)).toBe(false);

    expect(startReserve(s, free(2000))).toEqual({ freeBytes: 2000 * MB, reserve: "held" });
    expect(statSync(file).size).toBe(RESERVE_BYTES);
    // real blocks, not a hole
    expect(statSync(file).blocks * 512).toBeGreaterThanOrEqual(RESERVE_BYTES);
    expect(readFileSync(file).equals(Buffer.alloc(RESERVE_BYTES))).toBe(true);

    // between the limits nothing changes
    expect(keepReserve(s, free(500)).reserve).toBe("held");
    expect(keepReserve(s, free(128)).reserve).toBe("held");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(keepReserve(s, free(127))).toEqual({ freeBytes: 127 * MB, reserve: "released" });
    expect(existsSync(file)).toBe(false);
    expect(errors.mock.calls.flat().join(" ")).toMatch(/the data disk is nearly full \(127 MB free\): the reserve .*\.reserve was deleted/);
    expect(keepReserve(s, free(1024)).reserve).toBe("released");
    expect(existsSync(file)).toBe(false);

    expect(keepReserve(s, free(1025)).reserve).toBe("held");
    expect(statSync(file).size).toBe(RESERVE_BYTES);
  });

  it("is no condition for running: no data folder, an unreadable disk and a failed write are not errors", () => {
    expect(diskState({})).toEqual({ freeBytes: null, reserve: "none" });
    expect(startReserve({})).toEqual({ freeBytes: null, reserve: "none" });

    const d = dataDir();
    const unknown: Statfs = () => {
      throw new Error("ENOSYS");
    };
    expect(startReserve({ backupDir: d.backups }, unknown)).toEqual({ freeBytes: null, reserve: "missing" });
    expect(existsSync(join(d.dir, RESERVE_FILE))).toBe(false);

    // a data folder that is gone: the write fails and the start goes on
    const gone = { backupDir: join(d.dir, "gone", "backups") };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(startReserve(gone, free(2000)).reserve).toBe("missing");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/the reserve .*\.reserve could not be kept/);
  });

  it("is looked after by the hourly tick, first and after the copy, and started by the server entry", async () => {
    const { s } = await setupApp({}, undefined, { backup: () => "the copy of the day" });
    vi.mocked(keepReserve).mockClear();
    await hourlyTick(s);
    expect(vi.mocked(keepReserve).mock.calls.map((c) => c[0] === s)).toEqual([true, true]);

    // a full disk ends the tick at its first write (the claim of the day's copy): the reserve was looked after before that
    vi.mocked(keepReserve).mockClear();
    vi.spyOn(s.settings, "claim").mockRejectedValue(new Error("database or disk is full"));
    await expect(hourlyTick(s)).rejects.toThrow(/disk is full/);
    expect(vi.mocked(keepReserve).mock.calls.map((c) => c[0] === s)).toEqual([true]);

    const entry = readFileSync(join(import.meta.dirname, "../src/entry/node.ts"), "utf8");
    expect(entry).toMatch(/startReserve\(s\);[^\n]*\nawait recoverAfterCrash\(/);
  });
});
