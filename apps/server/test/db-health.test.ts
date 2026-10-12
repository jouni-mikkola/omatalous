import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { restorableCopyName, type Statfs } from "../src/db/backup-keep.ts";
import { copyDatabase } from "../src/db/open.ts";
import { newestIntactCopy } from "../src/db/restore.ts";
import { checkNewestCopy, COPY_CHECK_KEY, watchCopies, weekOf } from "../src/services/db-health.ts";
import { pollOps } from "../src/services/ops.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { dismissNotices, noticesFor } from "../src/services/security.ts";
import { NOW, setupApp } from "./helpers.ts";

const HOUR = 3600_000;
const HEALTH = new Set(["copy_missing", "copy_check_failed", "disk_low", "helper_silent"]);
/** The four sentences, as an admin reads them. */
const TEXT = {
  copy: "Ehjää varmuuskopiota ei ole tehty 36 tuntiin. Ota varmuuskopio kohdassa Asetukset > Ylläpito.",
  check: (file: string) => `Varmuuskopio ${file} ei läpäissyt tarkistusta eikä sitä enää käytetä palautukseen. Ota uusi varmuuskopio kohdassa Asetukset > Ylläpito.`,
  disk: (mb: number) => `Palvelimen levyllä on enää ${mb} Mt vapaata tilaa. Siivoa levy kohdassa Asetukset > Ylläpito.`,
  helper: "Ylläpitoapurista ei ole kuulunut vuorokauteen. Käynnistä se palvelimella uudelleen: ohje on kohdassa Asetukset > Ylläpito.",
};

/** A disk with this many megabytes free. */
const disk =
  (freeMb: number): Statfs =>
  () => ({ bavail: freeMb * 256, bsize: 4096 });
const ROOMY = 50_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * An app with a copies folder, a clock the test moves and a disk the test makes. The install begins at `NOW`: the
 * first user was made then. Filler rows are written last, so the last pages of a copy hold only them and `damage` hits those.
 */
async function household() {
  const dir = mkdtempSync(join(tmpdir(), "talous-health-"));
  dirs.push(dir);
  const backups = join(dir, "backups");
  const clock = { now: new Date(NOW) };
  const app = await setupApp({}, undefined, { now: () => clock.now, backupDir: backups });
  // a user row takes its time from the machine's clock, not from the injected one
  app.db.exec(`UPDATE users SET created_at = '${NOW.toISOString()}'`);
  app.db.exec("CREATE TABLE filler (x BLOB)");
  app.db.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) INSERT INTO filler SELECT randomblob(1000) FROM n");
  /** The first admin, as the notice functions take a user. */
  const me = { id: app.adminId, role: "admin" };
  return {
    ...app,
    backups,
    me,
    later: (hours: number) => void (clock.now = new Date(clock.now.getTime() + hours * HOUR)),
    /** The local day of the clock; the instance runs on UTC here. */
    today: () => clock.now.toISOString().slice(0, 10),
    /** A checked copy of the database as it is. Its file last changed `age` ms before the clock's time: five minutes by default, so the weekly check takes it as whole. */
    copy: (name: string, age = 5 * 60_000) => {
      const file = copyDatabase(app.db, backups, name);
      const t = new Date(clock.now.getTime() - age);
      utimesSync(file, t, t);
      return file;
    },
    notices: async (freeMb = ROOMY, user = me) => (await noticesFor(app.s, user, { statfs: disk(freeMb) })).filter((n) => HEALTH.has(n.kind)).map((n) => n.text),
    read: (freeMb = ROOMY, user = me) => dismissNotices(app.s, user, { statfs: disk(freeMb) }),
    lastCheck: async () => JSON.parse((await app.s.settings.get(COPY_CHECK_KEY)) ?? "null") as unknown,
  };
}

/** Overwrites the start of the last three pages. The file keeps its size, its header and its time. */
function damage(file: string): string {
  const { mtime } = statSync(file);
  const bytes = readFileSync(file);
  const page = bytes.readUInt16BE(16);
  for (let n = 1; n <= 3; n++) bytes.fill(0xff, bytes.length - n * page, bytes.length - n * page + 64);
  writeFileSync(file, bytes);
  utimesSync(file, mtime, mtime);
  return file;
}

/** A session of a user who is not there: a row that breaks a foreign key, written with the keys switched off. */
const ORPHAN = "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s-orphan', 'nobody', '2026-10-01', '2026-11-01', '2026-10-01')";
function orphanIn(file: string): string {
  const { mtime } = statSync(file);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = OFF; ${ORPHAN}`);
  db.close();
  utimesSync(file, mtime, mtime);
  return file;
}

describe("the weekly check of the newest copy", () => {
  it("names a week by its Monday", () => {
    expect(["2026-10-12", "2026-10-14", "2026-10-18", "2026-10-19", "2027-01-01"].map(weekOf)).toEqual(["2026-10-12", "2026-10-12", "2026-10-12", "2026-10-19", "2026-12-28"]);
  });

  it("runs once in a week and stores what it found", async () => {
    const h = await household();
    h.copy("auto-2026-10-08.db");
    h.later(1);
    h.copy("auto-2026-10-09.db");
    expect(await checkNewestCopy(h.s, "2026-10-14")).toEqual({ at: "2026-10-09T11:00:00.000Z", file: "auto-2026-10-09.db", ok: true, reason: null });
    expect(await h.lastCheck()).toEqual({ at: "2026-10-09T11:00:00.000Z", file: "auto-2026-10-09.db", ok: true, reason: null });
    h.later(24);
    expect(await checkNewestCopy(h.s, "2026-10-14"), "the same day").toBeNull();
    expect(await checkNewestCopy(h.s, "2026-10-18"), "the Sunday of that week").toBeNull();
    expect(await checkNewestCopy(h.s, "2026-10-19"), "the Monday after").toMatchObject({ at: "2026-10-10T11:00:00.000Z", ok: true });
    expect(readdirSync(h.backups).sort(), "a copy that passes is left as it is, with no file beside it").toEqual(["auto-2026-10-08.db", "auto-2026-10-09.db"]);
    expect(await h.notices()).toEqual([]);
  });

  it("renames a copy that fails to <name>.damaged, keeps its bytes, and it no longer counts as a copy", async () => {
    const h = await household();
    h.copy("auto-2026-10-08.db");
    h.later(1);
    const bad = damage(h.copy("auto-2026-10-09.db"));
    const bytes = readFileSync(bad);
    const result = await checkNewestCopy(h.s, h.today());
    expect(result).toMatchObject({ file: "auto-2026-10-09.db", ok: false, reason: expect.stringMatching(/^(integrity_check: |cannot be read as a database: )/) });
    expect(await h.lastCheck()).toEqual(result);
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-08.db", "auto-2026-10-09.db.damaged"]);
    expect(readFileSync(join(h.backups, "auto-2026-10-09.db.damaged")).equals(bytes), "set aside, not rewritten").toBe(true);
    expect(restorableCopyName("auto-2026-10-09.db.damaged")).toBe(false);
    expect(newestIntactCopy(h.backups)?.name).toBe("auto-2026-10-08.db");
    expect(await h.notices()).toEqual([TEXT.check("auto-2026-10-09.db")]);
  });

  it("skips a week with no copy, and checks the copy that comes later in that week", async () => {
    const h = await household();
    expect(await checkNewestCopy(h.s, "2026-10-14")).toBeNull();
    mkdirSync(h.backups);
    writeFileSync(join(h.backups, "auto-2026-10-09.db"), "cut short"); // fails the header check: not a copy to open
    expect(await checkNewestCopy(h.s, "2026-10-14")).toBeNull();
    expect(await h.lastCheck(), "no copy is no failed check").toBeNull();
    expect(await h.notices()).toEqual([]);
    h.later(1);
    h.copy("auto-2026-10-10.db");
    expect(await checkNewestCopy(h.s, "2026-10-15")).toMatchObject({ file: "auto-2026-10-10.db", ok: true });
    expect(existsSync(join(h.backups, "auto-2026-10-09.db")), "the file cut short is not the weekly check's to rename").toBe(true);
  });

  it("fails a copy with a row whose parent is missing, but not when the database itself has that row", async () => {
    const h = await household();
    orphanIn(h.copy("auto-2026-10-09.db"));
    expect(await checkNewestCopy(h.s, "2026-10-14")).toMatchObject({ file: "auto-2026-10-09.db", ok: false, reason: expect.stringMatching(/^foreign_key_check: 1 rows .*\(0 in the database itself\)$/) });
    expect(readdirSync(h.backups)).toEqual(["auto-2026-10-09.db.damaged"]);

    // the same row in the database: its copy is a true copy, and setting one aside every week would empty the net
    h.db.exec(`PRAGMA foreign_keys = OFF; ${ORPHAN}; PRAGMA foreign_keys = ON`);
    h.later(1);
    h.copy("auto-2026-10-16.db");
    expect(await checkNewestCopy(h.s, "2026-10-21")).toMatchObject({ file: "auto-2026-10-16.db", ok: true, reason: null });
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-09.db.damaged", "auto-2026-10-16.db"]);
  });

  it("keeps an earlier <name>.damaged when a copy of the same name fails again", async () => {
    const h = await household();
    damage(h.copy("manual.db"));
    await checkNewestCopy(h.s, "2026-10-14");
    damage(h.copy("manual.db"));
    await checkNewestCopy(h.s, "2026-10-21");
    expect(readdirSync(h.backups).sort()).toEqual(["manual.db.20261009T100000.damaged", "manual.db.damaged"]);
  });

  it("waits for the next tick when this tick wrote the daily copy", async () => {
    const h = await household();
    h.copy("auto-2026-10-09.db");
    expect(await watchCopies(h.s, h.today(), true)).toBeNull();
    expect(await h.lastCheck()).toBeNull();
    expect(await watchCopies(h.s, h.today(), false)).toMatchObject({ file: "auto-2026-10-09.db", ok: true });
  });

  it("leaves a copy alone while its file changed in the last two minutes, and checks it once it is two minutes old", async () => {
    const h = await household();
    h.copy("auto-2026-10-08.db");
    h.later(1);
    // 90 seconds old and not whole: a copy that is still on its way into the folder reads like this
    const fresh = damage(h.copy("auto-2026-10-09.db", 90_000));
    const bytes = readFileSync(fresh);
    for (const waited of [0, 18]) {
      h.later(waited / 3600);
      expect(await checkNewestCopy(h.s, h.today()), `${90 + waited} s old`).toBeNull();
      expect(await h.lastCheck(), "the older copy is not checked in its place").toBeNull();
      expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-08.db", "auto-2026-10-09.db"]);
      expect(readFileSync(fresh).equals(bytes)).toBe(true);
    }
    // 126 seconds old: the same week is still open, and the same copy is the one that is checked
    h.later(18 / 3600);
    expect(await checkNewestCopy(h.s, h.today())).toMatchObject({ file: "auto-2026-10-09.db", ok: false });
    expect(readdirSync(h.backups).sort()).toEqual(["auto-2026-10-08.db", "auto-2026-10-09.db.damaged"]);
  });

  it("is run by the hourly tick: the tick that writes the copy leaves it, the next one checks that copy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "talous-health-"));
    dirs.push(dir);
    const backups = join(dir, "backups");
    const app = await setupApp({}, undefined, { backupDir: backups, backup: (day) => copyDatabase(app.db, backups, `auto-${day}.db`) });
    expect((await hourlyTick(app.s)).backup).toBe(join(backups, "auto-2026-10-09.db"));
    expect(await app.s.settings.get(COPY_CHECK_KEY)).toBeNull();
    expect((await hourlyTick(app.s)).backup).toBeNull();
    expect(JSON.parse((await app.s.settings.get(COPY_CHECK_KEY))!)).toEqual({ at: NOW.toISOString(), file: "auto-2026-10-09.db", ok: true, reason: null });
    await hourlyTick(app.s);
    expect(readdirSync(backups)).toEqual(["auto-2026-10-09.db"]);
  });
});

describe("the admin's notices about the safety net", () => {
  it("no intact copy in 36 hours: not in the install's first 36 hours, then until a copy is made", async () => {
    const h = await household();
    h.later(35);
    expect(await h.notices(), "a new install has no copy yet").toEqual([]);
    h.later(2);
    expect(await h.notices()).toEqual([TEXT.copy]);
    h.copy("auto-2026-10-11.db");
    expect(await h.notices()).toEqual([]);
    h.later(35);
    expect(await h.notices()).toEqual([]);
    h.later(2);
    expect(await h.notices()).toEqual([TEXT.copy]);
    damage(h.copy("auto-2026-10-12.db"));
    expect(await h.notices(), "a damaged copy is not one").toEqual([TEXT.copy]);
    h.copy("pre-update-20261012T230000.db");
    expect(await h.notices(), "any intact copy counts, whatever made it").toEqual([]);
  });

  it("the last copy check failed: until a check passes", async () => {
    const h = await household();
    h.copy("auto-2026-10-08.db");
    h.later(1);
    damage(h.copy("auto-2026-10-09.db"));
    await checkNewestCopy(h.s, "2026-10-14");
    expect(await h.notices()).toEqual([TEXT.check("auto-2026-10-09.db")]);
    await checkNewestCopy(h.s, "2026-10-21"); // the older copy is the newest now
    expect(await h.notices()).toEqual([]);
  });

  it("the disk: under 1 GB free, or the reserve released", async () => {
    const h = await household();
    h.copy("auto-2026-10-09.db");
    expect(await h.notices(2048)).toEqual([]);
    expect(await h.notices(1023)).toEqual([TEXT.disk(1023)]);
    expect(await h.notices(1024), "no reserve file and no more than 1 GB free: released").toEqual([TEXT.disk(1024)]);
    expect(await h.notices(0)).toEqual([TEXT.disk(0)]);
    expect(await h.notices(1025)).toEqual([]);
    const unreadable: Statfs = () => {
      throw new Error("ENOSYS");
    };
    expect((await noticesFor(h.s, h.me, { statfs: unreadable })).filter((n) => HEALTH.has(n.kind)), "a disk that cannot be measured is not called full").toEqual([]);
  });

  it("the helper: not seen for 24 hours, after it was seen once", async () => {
    const h = await household();
    h.copy("auto-2026-10-09.db");
    h.later(30);
    expect(await h.notices(), "an install without the helper hears nothing").toEqual([]);
    await pollOps(h.s, { done: [] });
    h.copy("auto-2026-10-10.db");
    h.later(24);
    expect(await h.notices()).toEqual([]);
    h.later(1);
    expect(await h.notices()).toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [], dry: true });
    expect(await h.notices(), "the helper's self-test is no sign of life").toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [] });
    expect(await h.notices()).toEqual([]);
  });

  it("marked as read, a notice stays away while its condition lasts and comes back when the condition does", async () => {
    const h = await household();
    h.copy("auto-2026-10-09.db");

    // the disk
    expect(await h.notices(412)).toEqual([TEXT.disk(412)]);
    await h.read(412);
    h.later(1);
    expect(await h.notices(300), "still low: read once is enough").toEqual([]);
    h.later(1);
    expect(await h.notices(5000)).toEqual([]);
    h.later(1);
    expect(await h.notices(700)).toEqual([TEXT.disk(700)]);
    await h.read(700);

    // the helper
    await pollOps(h.s, { done: [] });
    h.later(25);
    h.copy("auto-2026-10-10.db");
    expect(await h.notices()).toEqual([TEXT.helper]);
    await h.read();
    h.later(24);
    h.copy("auto-2026-10-11.db");
    expect(await h.notices()).toEqual([]);
    await pollOps(h.s, { done: [] });
    h.later(25);
    h.copy("auto-2026-10-12.db");
    expect(await h.notices()).toEqual([TEXT.helper]);
    await pollOps(h.s, { done: [] });

    // the copies that stopped
    h.later(37);
    await pollOps(h.s, { done: [] });
    expect(await h.notices()).toEqual([TEXT.copy]);
    await h.read();
    h.later(24);
    expect(await h.notices()).toEqual([]);
    h.copy("auto-2026-10-15.db");
    await pollOps(h.s, { done: [] });
    expect(await h.notices()).toEqual([]);
    h.later(23);
    await pollOps(h.s, { done: [] });
    h.later(14);
    expect(await h.notices()).toEqual([TEXT.copy]);
  });

  it("a copy check read once comes back when another copy fails", async () => {
    const h = await household();
    h.copy("auto-2026-10-08.db");
    h.later(1);
    damage(h.copy("auto-2026-10-09.db"));
    await checkNewestCopy(h.s, "2026-10-14");
    await h.read();
    expect(await h.notices()).toEqual([]);
    h.later(1);
    damage(h.copy("auto-2026-10-10.db"));
    await checkNewestCopy(h.s, "2026-10-21");
    expect(await h.notices()).toEqual([TEXT.check("auto-2026-10-10.db")]);
  });

  it("the hourly tick notes that the disk had room again, though nobody read the list meanwhile", async () => {
    const h = await household();
    h.copy("auto-2026-10-09.db");
    expect(await h.notices(412)).toEqual([TEXT.disk(412)]);
    await h.read(412);
    h.later(1);
    await watchCopies(h.s, h.today(), true); // the real disk of the machine that runs the tests: it has room
    h.later(1);
    expect(await h.notices(412)).toEqual([TEXT.disk(412)]);
  });

  it("each admin marks their own, a member sees none, and the page's two routes carry them", async () => {
    const h = await household();
    const created = await h.admin.call("POST", "/api/users", { username: "kaisa", displayName: "Kaisa", role: "admin" });
    expect(created.status).toBe(201);
    const kaisa = { id: created.body.user.id as string, role: "admin" };
    const matti = await h.member("matti");
    await pollOps(h.s, { done: [] });
    h.later(37); // no copy was ever made, and the helper went quiet
    const all = [TEXT.copy, TEXT.disk(412), TEXT.helper];
    expect(await h.notices(412)).toEqual(all);
    expect(await h.notices(412, { id: matti.id, role: "member" })).toEqual([]);

    // through the routes the disk is the real one of the machine that runs the tests, so only the other two are asked for
    const sure = (body: { notices: { kind: string }[] }) => body.notices.map((n) => n.kind).filter((k) => k === "copy_missing" || k === "helper_silent");
    expect(sure((await h.admin.call("GET", "/api/security/notices")).body)).toEqual(["copy_missing", "helper_silent"]);
    expect((await matti.call("GET", "/api/security/notices")).body.notices.filter((n: { kind: string }) => HEALTH.has(n.kind))).toEqual([]);
    expect((await h.admin.call("POST", "/api/security/notices/seen")).status).toBe(200);
    expect(sure((await h.admin.call("GET", "/api/security/notices")).body)).toEqual([]);
    await h.read(412);
    expect(await h.notices(412)).toEqual([]);
    expect(await h.notices(412, kaisa), "the other admin has not read hers").toEqual(all);
    await dismissNotices(h.s, { id: matti.id, role: "member" }, { statfs: disk(412) });
    expect(await h.s.settings.get(`notice_health_seen:${matti.id}`), "a member's reading marks nothing of these").toBeNull();
    expect(JSON.parse((await h.s.settings.get(`notice_health_seen:${h.adminId}`))!), "what was seen: each kind with the time it began or its own").toEqual({
      copy_missing: "2026-10-10T23:00:00.000Z",
      disk_low: "2026-10-10T23:00:00.000Z",
      helper_silent: "2026-10-09T10:00:00.000Z",
    });
  });
});
