import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { copiesNewestFirst, NoRoomError, type Statfs } from "../src/db/backup-keep.ts";
import { MigrationError } from "../src/db/migrate.ts";
import { openNodeSqlite } from "../src/db/node-sqlite.ts";
import { copyDatabase, findMigrationsDir, openDatabase, takeSnapshot } from "../src/db/open.ts";
import { diskState, keepReserve, RESERVE_BYTES, RESERVE_FILE, startReserve } from "../src/services/disk.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { NOW, setupApp, scratchDir } from "./helpers.ts";

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
  const dir = scratchDir("talous-keep-template-");
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
  const dir = scratchDir("talous-keep-");
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
/** A copy named as update.sh names its own, for the day `day`. */
const copyOf = (db: { exec(sql: string): void }, live: string, day: string, opts: { statfs?: Statfs } = {}) =>
  copyDatabase(db, join(live, "..", "backups"), `pre-update-${day.replaceAll("-", "")}T000000Z.db`, { ...opts, source: live });
/** A disk with this many MB free. */
const free = (mb: number): Statfs => () => ({ bavail: mb * 256, bsize: 4096 });

describe("the copies before a change", () => {
  it("are listed newest first, and of two written at once the later name first; what is no file is skipped", () => {
    const d = dataDir();
    for (const name of ["pre-update-20261008T000000Z.db", "pre-reset-20261008T000000Z.db"]) intact(d.backups, name, 1);
    intact(d.backups, "pre-0003_x-20261007T000000.db", 2);
    junk(d.backups, "pre-update-20261009T000000Z.db", 0);
    symlinkSync(template, join(d.backups, "link.db"));
    mkdirSync(join(d.backups, "folder.db"));
    expect(copiesNewestFirst(d.backups, (name) => name.endsWith(".db")).map((c) => c.name)).toEqual(["pre-update-20261009T000000Z.db", "pre-update-20261008T000000Z.db", "pre-reset-20261008T000000Z.db", "pre-0003_x-20261007T000000.db"]);
  });

  /** The names of the files in backups/ that start with this. */
  const starting = (d: { files(): string[] }, prefix: string) => d.files().filter((f) => f.startsWith(prefix));
  const later = (n: number) => new Date(NOW.getTime() + n * 1000);

  it("a snapshot keeps the newest five pre-migration copies and leaves the pre-update copies and every other file alone", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    writeFileSync(join(d.backups, ".last-update"), "x");
    writeFileSync(join(d.backups, "notes.txt"), "x");
    for (let day = 1; day <= 7; day++) intact(d.backups, `pre-update-2026010${day}T000000Z.db`, 100 - day);
    for (let day = 1; day <= 6; day++) intact(d.backups, `pre-000${day}_x-2026010${day}T000000.db`, 100 - day);
    takeSnapshot(db, d.path, "pre-0009_x", NOW);
    expect(d.files()).toEqual([
      ".last-update",
      "notes.txt",
      "pre-0003_x-20260103T000000.db",
      "pre-0004_x-20260104T000000.db",
      "pre-0005_x-20260105T000000.db",
      "pre-0006_x-20260106T000000.db",
      "pre-0009_x-20261009T100000.db",
      ...[1, 2, 3, 4, 5, 6, 7].map((day) => `pre-update-2026010${day}T000000Z.db`),
    ]);
    db.close();
  });

  it("the copy before a reset and the one before a secret rotation stay through six later updates and migrations", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    takeSnapshot(db, d.path, "pre-reset", NOW);
    takeSnapshot(db, d.path, "pre-secret-rotate", later(1));
    for (let i = 1; i <= 6; i++) {
      // an update's copy (written by update.sh) and the migration's copy that follows it
      copyOf(db, d.path, `2026-10-${10 + i}`);
      takeSnapshot(db, d.path, `pre-001${i}_x`, later(10 + i));
    }
    expect(starting(d, "pre-reset-")).toEqual(["pre-reset-20261009T100000.db"]);
    expect(starting(d, "pre-secret-rotate-")).toEqual(["pre-secret-rotate-20261009T100001.db"]);
    expect(starting(d, "pre-001")).toHaveLength(5);
    expect(starting(d, "pre-update-")).toHaveLength(6);
    db.close();
  });

  it("a reset's or rotation's copy goes after 14 days, and no other copy's turn takes it earlier", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    intact(d.backups, "pre-reset-20260919T000000.db", 20);
    intact(d.backups, "pre-reset-20260929T000000.db", 10);
    intact(d.backups, "pre-secret-rotate-20260925T000000.db", 14.5);
    intact(d.backups, "pre-secret-rotate-20261006T000000.db", 3);
    takeSnapshot(db, d.path, "pre-0020_x", NOW);
    expect(starting(d, "pre-reset-")).toEqual(["pre-reset-20260929T000000.db"]);
    expect(starting(d, "pre-secret-rotate-")).toEqual(["pre-secret-rotate-20261006T000000.db"]);
    db.close();
  });

  it("nothing is pruned while the live database fails its check", () => {
    const d = dataDir();
    const source = dataDir();
    const db = openNodeSqlite(source.path);
    for (let day = 1; day <= 7; day++) intact(d.backups, `pre-000${day}_x-2026010${day}T000000.db`, 100 - day);
    intact(d.backups, "pre-reset-20260919T000000.db", 20);
    writeFileSync(d.path, "this is not a database file ".repeat(300));
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = takeSnapshot(db, d.path, "pre-0009_x", NOW);
    expect(existsSync(file)).toBe(true);
    expect(d.files()).toHaveLength(7 + 1 + 1);
    expect(warn.mock.calls.join("\n")).toMatch(/database copies are not pruned: the live database .* fails its check/);
    db.close();
  });
});

describe("a copy under a name that is taken", () => {
  /** A copy of the database into <data>/backups, under a name with the day in it. */
  const copyOf = (db: { exec(sql: string): void }, path: string, day: string, opts: { statfs?: Statfs } = {}) =>
    copyDatabase(db, join(path, "..", "backups"), `pre-update-${day.replaceAll("-", "")}T000000Z.db`, { source: path, ...opts });
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
    const file = copyOf(db, d.path, "2026-10-09");
    const before = readFileSync(file);
    // the day's copy is taken again (a failed tick released backup_day), and this time the write fails
    expect(() => copyOf(failing("partial", "disk I/O error"), d.path, "2026-10-09")).toThrow(/disk I\/O error/);
    expect(() => copyOf(failing(""), d.path, "2026-10-09")).toThrow(/failed its check and was removed: the file is empty/);
    expect(d.files()).toEqual(["pre-update-20261009T000000Z.db"]);
    expect(readFileSync(file).equals(before)).toBe(true);

    // A good copy takes the name. When the folder's flush fails after that, the older copy is gone already, so the new one stays.
    db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-eero', 'eero', 'X', 'h', 'admin', '2026-01-01')");
    flush.failDir = true;
    expect(() => copyOf(db, d.path, "2026-10-09")).toThrow(/EIO: dir/);
    const copy = new DatabaseSync(file, { readOnly: true });
    expect((copy.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(2);
    copy.close();
    // a first copy of a name does not stay when its folder could not be flushed
    expect(() => copyOf(db, d.path, "2026-10-08")).toThrow(/EIO: dir/);
    expect(d.files()).toEqual(["pre-update-20261009T000000Z.db"]);
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
    part("pre-update-20261009T000000Z.db.part", 0);
    copyOf(db, d.path, "2026-10-09");
    expect(d.files()).toEqual(["manual-20261009T095900Z.db.part", "pre-update-20261009T000000Z.db"]);
    db.close();
  });
});

describe("room for a copy", () => {
  it("refuses a copy on a disk without twice the database and its WAL, and says both sizes", () => {
    const d = dataDir();
    const db = openNodeSqlite(d.path);
    intact(d.backups, "pre-update-20261009T000000Z.db", 0);
    const before = readFileSync(join(d.backups, "pre-update-20261009T000000Z.db"));
    const size = statSync(d.path).size + (existsSync(`${d.path}-wal`) ? statSync(`${d.path}-wal`).size : 0);
    const short: Statfs = () => ({ bavail: Math.floor((2 * size) / 4096) - 1, bsize: 4096 });

    const err = (() => {
      try {
        copyOf(db, d.path, "2026-10-09", { statfs: short });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(NoRoomError);
    expect(err!.message).toMatch(/not enough free space for a database copy: .*backups has \d+\.\d MB free and a copy needs \d+\.\d MB \(twice the database and its WAL, \d+\.\d MB\)/);
    expect(err!.message).toContain(`a copy needs ${((2 * size) / MB).toFixed(1)} MB`);
    // the copy of that name from before is not touched
    expect(readFileSync(join(d.backups, "pre-update-20261009T000000Z.db")).equals(before)).toBe(true);
    expect(() => takeSnapshot(db, d.path, "pre-0009_x", NOW, { statfs: free(0) })).toThrow(NoRoomError);
    expect(d.files()).toEqual(["pre-update-20261009T000000Z.db"]);

    // exactly twice is enough, and a disk that cannot be measured does not stop a copy
    const exact: Statfs = () => ({ bavail: Math.ceil((2 * size) / 4096), bsize: 4096 });
    expect(copyOf(db, d.path, "2026-10-08", { statfs: exact })).toBe(join(d.backups, "pre-update-20261008T000000Z.db"));
    const unknown: Statfs = () => {
      throw new Error("ENOSYS");
    };
    expect(copyOf(db, d.path, "2026-10-07", { statfs: unknown })).toBe(join(d.backups, "pre-update-20261007T000000Z.db"));
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

  it("is looked after by the hourly tick, first, and started by the server entry", async () => {
    const { s } = await setupApp();
    vi.mocked(keepReserve).mockClear();
    await hourlyTick(s);
    expect(vi.mocked(keepReserve).mock.calls.map((c) => c[0] === s)).toEqual([true]);

    const entry = readFileSync(join(import.meta.dirname, "../src/entry/node.ts"), "utf8");
    expect(entry).toMatch(/startReserve\(s\);[^\n]*\nawait recoverAfterCrash\(/);
  });
});
