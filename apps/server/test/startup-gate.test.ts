import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDatabaseFile } from "../src/db/backup-check.ts";
import { copyDatabase, openDatabase } from "../src/db/open.ts";
import { newestIntactCopy } from "../src/db/restore.ts";
import { gateDatabase, gateEvent, isNews, restoreRequestPath } from "../src/db/startup-gate.ts";
import { fiTime, noticesFor, recordEvent } from "../src/services/security.ts";
import { loadFixture } from "./fixture-db.ts";
import { setupApp, scratchDir } from "./helpers.ts";

const ENTRY = fileURLToPath(new URL("../src/entry/node.ts", import.meta.url));
// the sources are TypeScript with syntax Node cannot strip, so the entry runs under tsx as `pnpm dev` does
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
/** apps/server: where `--import tsx` finds tsx. */
const SERVER = fileURLToPath(new URL("..", import.meta.url));

/** The start the gate runs at. Files it writes carry 20261012T040000 in their names. */
const NOW = new Date("2026-10-12T04:00:00Z");
const DAY_10 = "2026-10-10T00:15:00.000Z";
const DAY_11 = "2026-10-11T00:15:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = scratchDir("talous-gate-");
  dirs.push(d);
  return d;
};

/** A restore request as the browser left it just before the start at NOW: the gate drops a marker older than 15 minutes. */
function ask(marker: string, text: string): void {
  writeFileSync(marker, text);
  utimesSync(marker, NOW, NOW);
}

type Household = Awaited<ReturnType<typeof household>>;

/**
 * A data folder with a real banking.db: one admin, and filler rows written last, so the last pages of the file hold
 * only them. `damage` hits those pages: the check fails and the schema stays readable.
 */
async function household() {
  const dir = tmp();
  const path = join(dir, "banking.db");
  const { db } = await openDatabase(path);
  addUser(db, "aino");
  db.exec("CREATE TABLE filler (x BLOB)");
  db.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) INSERT INTO filler SELECT randomblob(1000) FROM n");
  return { dir, path, db, backups: join(dir, "backups"), damaged: join(dir, "damaged") };
}

function addUser(db: { exec(sql: string): void }, username: string): void {
  db.exec(`INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-${username}', '${username}', 'X', 'h', 'admin', '2026-01-01')`);
}

/** A checked copy of the database as it is now, written at `at`. */
function copyOf(h: Household, name: string, at: string): string {
  const file = copyDatabase(h.db, h.backups, name);
  utimesSync(file, new Date(at), new Date(at));
  return file;
}

/** Overwrites the start of the last three pages. The file keeps its size and its time. */
function damage(file: string): void {
  const { mtime } = statSync(file);
  const bytes = readFileSync(file);
  const page = bytes.readUInt16BE(16);
  for (let n = 1; n <= 3; n++) bytes.fill(0xff, bytes.length - n * page, bytes.length - n * page + 64);
  writeFileSync(file, bytes);
  utimesSync(file, mtime, mtime);
  expect(verifyDatabaseFile(file), "the damage is one the check sees").toMatchObject({ ok: false, reason: expect.stringMatching(/integrity check failed|malformed/) });
}

/**
 * What a start leaves that was cut off after the damaged database had moved and before the copy got its name: the
 * database in damaged/, no banking.db, and the checked copy beside where it should be.
 */
async function cutOff(): Promise<Household> {
  const h = await household();
  const copy = copyOf(h, "auto-2026-10-11.db", DAY_11);
  addUser(h.db, "ville");
  h.db.close();
  mkdirSync(h.damaged);
  for (const suffix of ["-wal", "-shm", ""]) {
    if (existsSync(h.path + suffix)) renameSync(h.path + suffix, join(h.damaged, `banking-20261011T230000.db${suffix}`));
  }
  copyFileSync(copy, `${h.path}.restore-tmp`);
  return h;
}

const users = (path: string): string[] => {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    return (d.prepare("SELECT username FROM users ORDER BY username").all() as { username: string }[]).map((r) => r.username);
  } finally {
    d.close();
  }
};

describe("a damaged database at start", () => {
  it("is moved to damaged/ with its -wal and -shm, and the newest intact copy takes its place", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-10.db", DAY_10);
    addUser(h.db, "ville");
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    addUser(h.db, "liisa"); // after the last copy: this is what the household loses
    h.db.close();
    damage(h.path);
    const before = readFileSync(h.path);
    writeFileSync(`${h.path}-wal`, "a log that belongs to the damaged file".repeat(4));
    writeFileSync(`${h.path}-shm`, "its index");

    const r = gateDatabase(h.path, NOW);
    expect(r).toMatchObject({ state: "restored", cause: "damaged", copy: { name: "auto-2026-10-11.db", at: DAY_11 } });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/was damaged \(database disk image is malformed\)\. It was moved to .+damaged.banking-20261012T040000\.db and backups\/auto-2026-10-11\.db \(written 2026-10-11T00:15:00\.000Z\) was restored/);

    // moved, not copied and not deleted: the damaged file is there byte for byte, with its log
    expect(readdirSync(h.damaged).sort()).toEqual(["banking-20261012T040000.db", "banking-20261012T040000.db-shm", "banking-20261012T040000.db-wal"]);
    expect(readFileSync(join(h.damaged, "banking-20261012T040000.db")).equals(before)).toBe(true);
    expect(readFileSync(join(h.damaged, "banking-20261012T040000.db-wal"), "utf8")).toMatch(/^a log that belongs/);
    // the copy is in place alone: no stale log beside it, no temporary file, and every copy is still in backups/
    expect(readdirSync(h.dir).sort()).toEqual(["backups", "banking.db", "damaged"]);
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-10.db", "auto-2026-10-11.db"]);
    expect(users(h.path)).toEqual(["aino", "ville"]);

    // the app starts on it, and the next start finds nothing to do
    const opened = await openDatabase(h.path);
    expect((await opened.db.all<{ username: string }>("SELECT username FROM users ORDER BY username")).map((u) => u.username)).toEqual(["aino", "ville"]);
    opened.db.close();
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
  });

  it("skips a damaged newest copy and leaves it where it is", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-10.db", DAY_10);
    addUser(h.db, "ville");
    const newest = copyOf(h, "auto-2026-10-11.db", DAY_11);
    h.db.close();
    damage(newest);
    damage(h.path);

    expect(newestIntactCopy(h.backups)).toMatchObject({ name: "auto-2026-10-10.db", at: DAY_10, size: statSync(join(h.backups, "auto-2026-10-10.db")).size });
    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "restored", copy: { name: "auto-2026-10-10.db", at: DAY_10 } });
    expect(users(h.path)).toEqual(["aino"]);
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-10.db", "auto-2026-10-11.db"]);
  });

  it("skips a copy of a newer schema", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-10.db", DAY_10);
    addUser(h.db, "ville");
    const newer = copyOf(h, "pre-update-20261011T001500.db", DAY_11);
    h.db.close();
    const n = new DatabaseSync(newer);
    n.exec("INSERT INTO _migrations (name, applied_at, checksum) VALUES ('9999_future.sql', 'x', 'y')");
    n.exec("PRAGMA journal_mode = DELETE");
    n.close();
    utimesSync(newer, new Date(DAY_11), new Date(DAY_11));
    expect(verifyDatabaseFile(newer).ok).toBe(true);
    damage(h.path);

    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "restored", copy: { name: "auto-2026-10-10.db" } });
    expect(users(h.path)).toEqual(["aino"]);
  });

  it("with no intact copy keeps the file where it is and the app starts on it", async () => {
    const h = await household();
    const only = copyOf(h, "auto-2026-10-11.db", DAY_11);
    // an index written last: its damaged pages are found by quick_check itself, as lines and not as an error
    h.db.exec("CREATE INDEX filler_start ON filler (hex(substr(x, 1, 60)))");
    h.db.close();
    damage(only);
    damage(h.path);
    const before = readFileSync(h.path);

    const r = gateDatabase(h.path, NOW);
    expect(r).toMatchObject({ state: "damaged", reason: expect.stringMatching(/^quick_check: /), waiting: null });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/is damaged \(quick_check: .+\) and .+backups holds no intact copy\. Starting on the damaged file\. Restore a backup: docs\/ADVANCED\.md#restore-a-backup/);
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(existsSync(h.damaged)).toBe(false);
    expect(existsSync(`${h.path}.restore-tmp`)).toBe(false);

    const opened = await openDatabase(h.path);
    expect(await opened.db.all("SELECT username FROM users")).toHaveLength(1);
    opened.db.close();
  });

  it("says that an intact copy waits when it could not be put in place, and the next start restores it", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    addUser(h.db, "ville");
    h.db.close();
    damage(h.path);
    const before = readFileSync(h.path);

    // the folder for the damaged file cannot be made
    writeFileSync(h.damaged, "a file where the folder should be");
    const r = gateDatabase(h.path, NOW);
    expect(r).toMatchObject({ state: "damaged", reason: "database disk image is malformed", waiting: { name: "auto-2026-10-11.db", why: expect.stringMatching(/^EEXIST/) } });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/is damaged \(.+\)\. The intact copy backups\/auto-2026-10-11\.db could not be put in its place \(EEXIST.+\)\. Starting on the damaged file\. Make room on the disk and restart: the next start restores the copy\.$/);
    expect(r.lines[0]).not.toMatch(/no intact copy/);
    expect(readFileSync(h.path).equals(before)).toBe(true);

    // the copy cannot be written beside the database, as on a full disk
    rmSync(h.damaged);
    mkdirSync(`${h.path}.restore-tmp`);
    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "damaged", waiting: { name: "auto-2026-10-11.db" } });
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(readdirSync(h.damaged)).toEqual([]);

    // the way is clear: this start restores
    rmSync(`${h.path}.restore-tmp`, { recursive: true });
    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "restored", cause: "damaged", copy: { name: "auto-2026-10-11.db" } });
    expect(users(h.path)).toEqual(["aino"]);
    expect(readdirSync(h.dir).filter((f) => f.includes("restore-tmp"))).toEqual([]);
  });

  it("finishes a start that was cut off after the move, with one line, and the start after that is quiet", async () => {
    const h = await cutOff();
    expect(gateDatabase(h.path, NOW)).toEqual({
      state: "restored",
      cause: "damaged",
      copy: null,
      lines: [expect.stringMatching(/^database: .+banking\.db was missing and a checked copy waited beside it: .+ The copy is now the database\. Changes made after that copy are lost\.$/)],
    });
    expect(readdirSync(h.dir).sort()).toEqual(["backups", "banking.db", "damaged"]);
    expect(users(h.path)).toEqual(["aino"]);

    const opened = await openDatabase(h.path);
    opened.db.close();
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
  });

  it("does not finish with a staged copy that fails its check, or beside a log of a database", async () => {
    const h = await cutOff();
    writeFileSync(`${h.path}-wal`, "a log that is not the copy's");
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(existsSync(h.path)).toBe(false);

    rmSync(`${h.path}-wal`);
    damage(`${h.path}.restore-tmp`);
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(readdirSync(h.dir).sort()).toEqual(["backups", "banking.db.restore-tmp", "damaged"]);
  });

  it("moves a file that is no database, and keeps it when there is no copy", async () => {
    const h = await household();
    h.db.close();
    rmSync(`${h.path}-wal`, { force: true });
    rmSync(`${h.path}-shm`, { force: true });
    const good = readFileSync(h.path);
    writeFileSync(h.path, "this was a database once ".repeat(400));
    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "damaged", reason: expect.stringMatching(/not a database/) });
    expect(readFileSync(h.path, "utf8")).toMatch(/^this was a database once/);

    mkdirSync(h.backups);
    writeFileSync(join(h.backups, "manual-2026-10-11.db"), good);
    expect(gateDatabase(h.path, NOW)).toMatchObject({ state: "restored", cause: "damaged", copy: { name: "manual-2026-10-11.db" } });
    expect(readFileSync(join(h.damaged, "banking-20261012T040000.db"), "utf8")).toMatch(/^this was a database once/);
    expect(users(h.path)).toEqual(["aino"]);
    // the copy was a raw file in WAL mode: checking it under the temporary name left nothing behind
    expect(readdirSync(h.dir).filter((f) => f.includes("restore-tmp"))).toEqual([]);
  });

  it("gives a second damaged file of the same second its own name", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    h.db.close();
    damage(h.path);
    expect(gateDatabase(h.path, NOW).state).toBe("restored");
    const first = readFileSync(join(h.damaged, "banking-20261012T040000.db"));
    damage(h.path);
    expect(gateDatabase(h.path, NOW).state).toBe("restored");
    expect(readdirSync(h.damaged).filter((f) => f.endsWith(".db")).sort()).toEqual(["banking-20261012T040000-2.db", "banking-20261012T040000.db"]);
    expect(readFileSync(join(h.damaged, "banking-20261012T040000.db")).equals(first)).toBe(true);
    expect(users(h.path)).toEqual(["aino"]);
  });

  it("restores a copy that 0.8.0 wrote, and the open brings it up to date", async () => {
    const dir = tmp();
    const path = join(dir, "banking.db");
    mkdirSync(join(dir, "backups"));
    loadFixture(join(dir, "backups", "auto-2026-10-11.db"), "0.8.0.sql");
    writeFileSync(path, "this was a database once ".repeat(400));

    expect(gateDatabase(path, NOW)).toMatchObject({ state: "restored", copy: { name: "auto-2026-10-11.db" } });
    const opened = await openDatabase(path);
    expect(opened.applied.length).toBeGreaterThan(0);
    expect((await opened.db.all<{ username: string }>("SELECT username FROM users ORDER BY username")).map((u) => u.username)).toEqual(["aino", "eero"]);
    opened.db.close();
  });
});

describe("a database the gate leaves alone", () => {
  it("does nothing without a file or with an empty one", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    h.db.close();
    for (const f of ["", "-wal", "-shm"]) rmSync(h.path + f, { force: true });
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(readdirSync(h.dir)).toEqual(["backups"]);

    writeFileSync(h.path, "");
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(readdirSync(h.dir).sort()).toEqual(["backups", "banking.db"]);
    expect(statSync(h.path).size).toBe(0);
    // a data folder that does not exist yet: the first start of a new install
    expect(gateDatabase(join(h.dir, "new", "banking.db"), NOW)).toEqual({ state: "ok", lines: [] });
    expect(existsSync(join(h.dir, "new"))).toBe(false);
  });

  it("passes a WAL database: one that is open with changes in its log, and the files a killed process leaves", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    // a checkpoint, then one more write: the main file is complete without ville, who is in the log only
    h.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    addUser(h.db, "ville");
    expect(statSync(`${h.path}-wal`).size).toBeGreaterThan(0);
    const alone = join(tmp(), "banking.db");
    copyFileSync(h.path, alone);
    expect(users(alone)).toEqual(["aino"]);

    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(existsSync(h.damaged)).toBe(false);

    // the main file and its log without the -shm index, as after a kill: the copy in backups/ must not replace them
    const killed = tmp();
    const path = join(killed, "banking.db");
    copyFileSync(h.path, path);
    copyFileSync(`${h.path}-wal`, `${path}-wal`);
    mkdirSync(join(killed, "backups"));
    copyFileSync(join(h.backups, "auto-2026-10-11.db"), join(killed, "backups", "auto-2026-10-11.db"));
    h.db.close();

    expect(gateDatabase(path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(existsSync(join(killed, "damaged"))).toBe(false);
    const opened = await openDatabase(path);
    expect((await opened.db.all<{ username: string }>("SELECT username FROM users ORDER BY username")).map((u) => u.username)).toEqual(["aino", "ville"]);
    opened.db.close();
  });

  it("passes a database another process holds locked", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    h.db.close();
    const before = readFileSync(h.path);
    const holder = new DatabaseSync(h.path);
    try {
      holder.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN IMMEDIATE; INSERT INTO filler VALUES (x'00')");
      const r = gateDatabase(h.path, NOW);
      expect(r.state).toBe("ok");
      expect(r.lines).toEqual([expect.stringMatching(/^database: the check before the start was skipped \(database is locked\)\.$/)]);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(existsSync(h.damaged)).toBe(false);
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(users(h.path)).toEqual(["aino"]);
  });
});

describe("a restore asked for in the browser", () => {
  it("restores the copy the marker names, saves the database it replaces and removes the marker", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-10.db", DAY_10);
    addUser(h.db, "ville");
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    addUser(h.db, "liisa");
    h.db.close();
    // the older of the two: the gate restores the copy that is named, it does not pick one
    ask(restoreRequestPath(h.dir), "auto-2026-10-10.db");

    const r = gateDatabase(h.path, NOW);
    expect(r).toMatchObject({ state: "restored", cause: "requested", copy: { name: "auto-2026-10-10.db", at: DAY_10 } });
    expect(r.lines).toEqual([expect.stringMatching(/^database: restored from backups\/auto-2026-10-10\.db, as asked in the browser\. Checked auto-2026-10-10\.db: ok, 1 users, \d+ migrations\. The current database is saved as .+pre-restore-20261012T040000\.db$/)]);
    expect(users(h.path)).toEqual(["aino"]);
    expect(users(join(h.backups, "pre-restore-20261012T040000.db"))).toEqual(["aino", "liisa", "ville"]);
    expect(existsSync(restoreRequestPath(h.dir))).toBe(false);
    expect(existsSync(h.damaged)).toBe(false);

    // what the restore saved is the newest file in backups/, and it is never offered as the copy to restore
    expect(newestIntactCopy(h.backups)).toMatchObject({ name: "auto-2026-10-11.db" });
    // the next start has no request and a healthy database
    expect(gateDatabase(h.path, NOW)).toEqual({ state: "ok", lines: [] });
    expect(users(h.path)).toEqual(["aino"]);
  });

  it("removes a marker that names a path, a missing or damaged copy or anything but one name, and restores nothing", async () => {
    const h = await household();
    copyOf(h, "auto-2026-10-10.db", DAY_10);
    damage(copyOf(h, "auto-2026-10-11.db", DAY_11));
    addUser(h.db, "ville");
    h.db.close();
    const before = readFileSync(h.path);
    const marker = restoreRequestPath(h.dir);

    const refused = [
      "../banking.db",
      "backups/auto-2026-10-10.db",
      join(h.backups, "auto-2026-10-10.db"),
      "auto-2026-10-10.db\n",
      "auto-2026-10-10.db auto-2026-10-10.db",
      "auto-2026-10-10",
      "",
      `${"a".repeat(5000)}.db`,
    ];
    for (const text of refused) {
      ask(marker, text);
      const r = gateDatabase(h.path, NOW);
      expect(r, text).toEqual({ state: "ok", lines: ["database: the restore request did not hold the file name of a copy. It was removed and nothing was restored."] });
      expect(existsSync(marker), text).toBe(false);
    }
    for (const [name, why] of [
      ["auto-2026-09-01.db", /ENOENT/],
      ["auto-2026-10-11.db", /not a usable database/],
    ] as const) {
      ask(marker, name);
      const r = gateDatabase(h.path, NOW);
      expect(r.state, name).toBe("ok");
      expect(r.lines, name).toEqual([expect.stringMatching(/^database: the restore asked for in the browser was not done\. /)]);
      expect(r.lines[0], name).toMatch(why);
      expect(existsSync(marker), name).toBe(false);
    }
    // nothing was restored and nothing was saved as "replaced"
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(users(h.path)).toEqual(["aino", "ville"]);
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-10.db", "auto-2026-10-11.db"]);
  });
});

describe("what the admins are told", () => {
  const time = (iso: string) => fiTime(iso, "Europe/Helsinki");

  it("after a restore: the copy, its time and what was lost, once for every admin", async () => {
    const { s, adminId, member } = await setupApp();
    const eero = await member("eero");
    const event = gateEvent({ state: "restored", lines: [], cause: "damaged", copy: { name: "auto-2026-10-10.db", at: DAY_10 } }, time);
    expect(event).toEqual({ kind: "db_restored", detail: "Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta auto-2026-10-10.db (10.10. klo 03.15)" });
    await recordEvent(s, { ...event, userId: adminId, notify: true });

    expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => [n.kind, n.text])).toEqual([
      [
        "db_restored",
        "Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta auto-2026-10-10.db (10.10. klo 03.15). Sen jälkeen tehdyt muutokset menetettiin. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.",
      ],
    ]);
    expect(await noticesFor(s, { id: eero.id, role: "member" })).toEqual([]);
  });

  it("after a restore that was asked for: the same without the damage, and the longest copy name fits the event", async () => {
    const { s, adminId } = await setupApp();
    const name = `${"k".repeat(99)}.db`;
    const event = gateEvent({ state: "restored", lines: [], cause: "requested", copy: { name, at: DAY_11 } }, time);
    expect(event.detail).toBe(`Tietokanta palautettiin varmuuskopiosta ${name} (11.10. klo 03.15)`);
    await recordEvent(s, { ...event, userId: adminId, notify: true });
    expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => n.text)).toEqual([
      `Tietokanta palautettiin varmuuskopiosta ${name} (11.10. klo 03.15). Sen jälkeen tehdyt muutokset menetettiin. Pankkitapahtumat haetaan uudelleen seuraavassa haussa.`,
    ]);
    // the damaged case is the longer sentence
    expect(gateEvent({ state: "restored", lines: [], cause: "damaged", copy: { name, at: DAY_11 } }, time).detail.length).toBeLessThanOrEqual(200);
  });

  it("with no intact copy: that the database is damaged and where the instructions are", async () => {
    const { s, adminId } = await setupApp();
    const event = gateEvent({ state: "damaged", lines: [], reason: "quick_check: *** in database main ***", waiting: null }, time);
    expect(event).toEqual({ kind: "db_damaged", detail: "quick_check: *** in database main ***" });
    await recordEvent(s, { ...event, userId: adminId, notify: true });
    expect((await noticesFor(s, { id: adminId, role: "admin" })).map((n) => [n.kind, n.text])).toEqual([
      ["db_damaged", "Tietokanta on vaurioitunut, eikä ehjää varmuuskopiota löytynyt. Palauta muualle tallennettu varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md."],
    ]);
  });

  it("with an intact copy that could not be put in place: that it waits, and what lets the next start restore it", async () => {
    const { s, adminId } = await setupApp();
    const why = "ENOSPC: no space left on device, copyfile '/data/backups/auto-2026-10-11.db' -> '/data/banking.db.restore-tmp'";
    const event = gateEvent({ state: "damaged", lines: [], reason: "database disk image is malformed", waiting: { name: "auto-2026-10-11.db", why } }, time);
    expect(event).toEqual({ kind: "db_damaged", detail: `varmuuskopio auto-2026-10-11.db odottaa: ${why}` });
    await recordEvent(s, { ...event, userId: adminId, notify: true });
    // the longest name and a long reason: the cut of the detail takes the end of the reason, never the name
    const name = `${"k".repeat(99)}.db`;
    await recordEvent(s, { ...gateEvent({ state: "damaged", lines: [], reason: "x", waiting: { name, why: "y".repeat(200) } }, time), userId: adminId, notify: true });

    const tail = "on tallessa, mutta sitä ei saatu käyttöön. Vapauta levyltä tilaa ja käynnistä sovellus uudelleen: varmuuskopio palautetaan käynnistyksessä. Jos se ei auta, palauta varmuuskopio palvelimella komennolla ./scripts/restore.sh. Ohje on tiedostossa docs/ADVANCED.md.";
    const texts = (await noticesFor(s, { id: adminId, role: "admin" })).map((n) => n.text);
    expect(texts).toEqual([`Tietokanta on vaurioitunut. Ehjä varmuuskopio auto-2026-10-11.db ${tail}`, `Tietokanta on vaurioitunut. Ehjä varmuuskopio ${name} ${tail}`]);
    for (const text of texts) expect(text).not.toMatch(/eikä ehjää varmuuskopiota löytynyt/);
  });

  it("after a start that only finished an earlier one: the restore without the copy's name", () => {
    expect(gateEvent({ state: "restored", lines: [], cause: "damaged", copy: null }, time)).toEqual({ kind: "db_restored", detail: "Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta" });
  });

  it("tells a database that stays damaged once, and again when the notice would read differently", () => {
    const none = { kind: "db_damaged", detail: "quick_check: *** in database main ***" };
    const waits = { kind: "db_damaged", detail: "varmuuskopio auto-2026-10-11.db odottaa: ENOSPC: no space left on device" };
    expect(isNews(none, [])).toBe(true);
    expect(isNews(none, [{ kind: "new_device", detail: "Chrome, Windows" }, { kind: "db_restored", detail: null }])).toBe(true);
    // the same notice is unread: the words of SQLite may differ, the sentence the admin reads does not
    expect(isNews(none, [{ kind: "db_damaged", detail: "database disk image is malformed" }])).toBe(false);
    expect(isNews(waits, [{ kind: "db_damaged", detail: "varmuuskopio auto-2026-10-11.db odottaa: EEXIST: file already exists" }])).toBe(false);
    // a copy turned up and waits, another copy waits, or the copy is gone: the sentence changes
    expect(isNews(waits, [none])).toBe(true);
    expect(isNews(waits, [{ kind: "db_damaged", detail: "varmuuskopio auto-2026-10-10.db odottaa: ENOSPC" }])).toBe(true);
    expect(isNews(none, [waits])).toBe(true);
    // a restore is told every time
    expect(isNews({ kind: "db_restored", detail: "Tietokanta palautettiin varmuuskopiosta" }, [{ kind: "db_restored", detail: "Tietokanta palautettiin varmuuskopiosta" }])).toBe(true);
  });
});

describe("the entry point", () => {
  const env = (dataDir: string) => ({ PATH: process.env.PATH, TMPDIR: tmp(), DATA_DIR: dataDir, APP_SECRET: "test-secret-that-is-long-enough-0123456789", PORT: "0", HOST: "127.0.0.1" });

  /** A damaged database with an intact copy and a restore request: everything the gate would act on. */
  async function damagedHousehold() {
    const h = await household();
    copyOf(h, "auto-2026-10-11.db", DAY_11);
    addUser(h.db, "ville");
    h.db.close();
    damage(h.path);
    return h;
  }

  /** One start of the server on a data folder: stopped once it answers, with its exit code and what it printed. */
  async function start(dataDir: string): Promise<{ code: number | null; out: string; err: string }> {
    // node itself with tsx as the loader, not the tsx command: that one waits 30 ms for its child to answer a signal
    // and then kills it, which on a busy machine turns the clean stop into exit code 143
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", ENTRY], { cwd: SERVER, env: env(dataDir), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let asked = false;
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const code = await new Promise<number | null>((done) => {
      child.on("exit", done);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        // the server answers: everything of the start has run
        if (!asked && out.includes("listening on")) {
          asked = true;
          child.kill("SIGTERM");
        }
      });
    });
    return { code, out, err };
  }

  /** What the gate's events in the security log are, for every user. */
  const events = (path: string) => {
    const d = new DatabaseSync(path, { readOnly: true });
    try {
      return d.prepare("SELECT user_id, kind, detail, notify, seen_at FROM security_events WHERE kind LIKE 'db_%' ORDER BY id").all();
    } finally {
      d.close();
    }
  };

  it("runs the gate in server mode: the line on stderr, and the event with a notice for the admin", async () => {
    const h = await damagedHousehold();
    const { code, err } = await start(h.dir);
    expect(code, err).toBe(0);
    expect(err).toMatch(/^database: .+banking\.db was damaged \(.+\)\. It was moved to .+banking-\d{8}T\d{6}\.db and backups\/auto-2026-10-11\.db/m);
    expect(readdirSync(h.damaged).filter((f) => f.endsWith(".db"))).toHaveLength(1);
    expect(events(h.path)).toEqual([
      { user_id: "u-aino", kind: "db_restored", detail: expect.stringMatching(/^Tietokanta oli vaurioitunut\. Se palautettiin varmuuskopiosta auto-2026-10-11\.db \(11\.10\. klo \d\d\.15\)$/), notify: 1, seen_at: null },
    ]);
  }, 120_000);

  it("finishes a start that was cut off: one line, and the start after that is quiet with the app up", async () => {
    const h = await cutOff();
    const first = await start(h.dir);
    expect(first.code, first.err).toBe(0);
    expect(first.err.match(/^database: .+$/gm)).toEqual([expect.stringMatching(/banking\.db was missing and a checked copy waited beside it/)]);

    const second = await start(h.dir);
    expect(second.code, second.err).toBe(0);
    expect(second.err).not.toMatch(/^database:/m);
    expect(second.out).toMatch(/listening on/);
    expect(users(h.path)).toEqual(["aino"]);
    // the admin is told by the start that finished it, and not again
    expect(events(h.path)).toEqual([{ user_id: "u-aino", kind: "db_restored", detail: "Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta", notify: 1, seen_at: null }]);
  }, 120_000);

  it("leaves an admin one unread notice of a database that stays damaged, whatever the number of starts", async () => {
    const h = await household();
    // damage that quick_check reports and the open lives with: the app starts on the file
    h.db.exec("CREATE INDEX filler_start ON filler (hex(substr(x, 1, 60)))");
    h.db.close();
    damage(h.path);
    for (let n = 0; n < 2; n++) {
      const r = await start(h.dir);
      expect(r.code, r.err).toBe(0);
      expect(r.err).toMatch(/^database: .+banking\.db is damaged \(quick_check: .+\) and .+backups holds no intact copy/m);
    }
    expect(events(h.path)).toEqual([{ user_id: "u-aino", kind: "db_damaged", detail: expect.stringMatching(/^quick_check: /), notify: 1, seen_at: null }]);
  }, 120_000);

  it("never runs the gate for a CLI call: the damaged file and the request stay", async () => {
    const h = await damagedHousehold();
    writeFileSync(restoreRequestPath(h.dir), "auto-2026-10-11.db");
    const before = readFileSync(h.path);
    const r = spawnSync(TSX, ["--disable-warning=ExperimentalWarning", ENTRY, "version"], { env: env(h.dir), encoding: "utf8", timeout: 100_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/^database:/m);
    expect(existsSync(h.damaged)).toBe(false);
    expect(readFileSync(restoreRequestPath(h.dir), "utf8")).toBe("auto-2026-10-11.db");
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(users(h.path)).toEqual(["aino", "ville"]);
  }, 120_000);
});
