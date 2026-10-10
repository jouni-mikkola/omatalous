import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyBackup } from "../src/db/open.ts";
import { hourlyTick } from "../src/services/schedule.ts";
import { setupApp } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An app whose daily copy goes to a temp directory and whose clock the test moves. */
async function withBackup(start: string, backup?: (day: string, write: (day: string) => string) => string) {
  const root = mkdtempSync(join(tmpdir(), "talous-backup-"));
  dirs.push(root);
  const dbPath = join(root, "banking.db");
  const backups = join(root, "backups");
  const holder: { db?: Parameters<typeof dailyBackup>[0] } = {};
  const write = (day: string) => dailyBackup(holder.db!, dbPath, day);
  const clock = { now: new Date(start) };
  const t = await setupApp({}, undefined, { now: () => clock.now, backup: (day) => (backup ? backup(day, write) : write(day)) });
  holder.db = t.db;
  return { ...t, clock, backups, files: () => (existsSync(backups) ? readdirSync(backups).sort() : []) };
}

describe("daily backup", () => {
  it("is written by the first tick of the local day and not again that day", async () => {
    const t = await withBackup("2026-10-09T10:00:00Z");
    const first = await hourlyTick(t.s);
    expect(first.backup).toBe(join(t.backups, "auto-2026-10-09.db"));
    expect(t.files()).toEqual(["auto-2026-10-09.db"]);

    // the copy is a complete database
    const copy = new DatabaseSync(first.backup!, { readOnly: true });
    expect(copy.prepare("SELECT username FROM users").all()).toEqual([{ username: "aino" }]);
    copy.close();

    // 20:59 UTC is still the same day in Helsinki (summer time), 21:00 is the next
    t.clock.now = new Date("2026-10-09T20:59:00Z");
    expect((await hourlyTick(t.s)).backup).toBeNull();
    expect(t.files()).toEqual(["auto-2026-10-09.db"]);

    t.clock.now = new Date("2026-10-09T21:00:00Z");
    expect((await hourlyTick(t.s)).backup).toBe(join(t.backups, "auto-2026-10-10.db"));
    expect((await hourlyTick(t.s)).backup).toBeNull();
    expect(t.files()).toEqual(["auto-2026-10-09.db", "auto-2026-10-10.db"]);
  });

  it("tries again at the next tick when a copy fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const t = await withBackup("2026-10-09T10:00:00Z", (day, write) => {
      if (fail) throw new Error("disk full");
      return write(day);
    });
    expect((await hourlyTick(t.s)).backup).toBeNull();
    expect(errors).toHaveBeenCalled();
    expect(t.files()).toEqual([]);

    fail = false;
    expect((await hourlyTick(t.s)).backup).toBe(join(t.backups, "auto-2026-10-09.db"));
  });

  it("does nothing where no backup function is given", async () => {
    const { s } = await setupApp();
    expect((await hourlyTick(s)).backup).toBeNull();
    expect(await s.settings.get("backup_day")).toBeNull();
  });
});

describe("daily backup rotation", () => {
  it("keeps the 7 newest daily copies and leaves every other file alone", async () => {
    const t = await withBackup("2026-10-09T10:00:00Z");
    const dbPath = join(t.backups, "..", "banking.db");
    mkdirSync(t.backups, { recursive: true });
    const others = ["pre-0003_x-20260101T000000.db", "pre-update-20260102T000000.db", "notes.txt", "auto-notes.db", "auto-2026-10-01.db.bak", "talous-20260101-0300.db.gz"];
    for (const f of others) writeFileSync(join(t.backups, f), "keep");

    for (let day = 1; day <= 9; day++) dailyBackup(t.db, dbPath, `2026-10-0${day}`);
    const auto = t.files().filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(auto).toEqual(["03", "04", "05", "06", "07", "08", "09"].map((d) => `auto-2026-10-${d}.db`));
    for (const f of others) expect(t.files(), f).toContain(f);
  });

  it("keeps the copy just written even when the clock was turned back", async () => {
    const t = await withBackup("2026-10-09T10:00:00Z");
    const dbPath = join(t.backups, "..", "banking.db");
    for (let day = 1; day <= 7; day++) dailyBackup(t.db, dbPath, `2026-10-0${day}`);
    dailyBackup(t.db, dbPath, "2026-09-01");
    expect(t.files()).toEqual(["auto-2026-09-01.db", ...["02", "03", "04", "05", "06", "07"].map((d) => `auto-2026-10-${d}.db`)]);
  });

  it("writing the same day again replaces that day's copy", async () => {
    const t = await withBackup("2026-10-09T10:00:00Z");
    const dbPath = join(t.backups, "..", "banking.db");
    dailyBackup(t.db, dbPath, "2026-10-09");
    dailyBackup(t.db, dbPath, "2026-10-09");
    expect(t.files()).toEqual(["auto-2026-10-09.db"]);
  });
});
