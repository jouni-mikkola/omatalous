import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dailyBackup, openDatabase, takeSnapshot } from "../src/db/open.ts";
import { restoreDatabase } from "../src/db/restore.ts";

// Every flush is recorded with what the file looked like at that moment, then done for real.
const flushes = vi.hoisted(() => ({
  calls: [] as { fn: "file" | "dir"; path: string; size: number }[],
  failFile: false,
  failDir: false,
}));
vi.mock("../src/platform/durable.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/platform/durable.ts")>();
  const sizeOf = (p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return -1;
    }
  };
  return {
    ...real,
    fsyncFile: (path: string) => {
      flushes.calls.push({ fn: "file", path, size: sizeOf(path) });
      if (flushes.failFile) throw new Error("EIO: file");
      real.fsyncFile(path);
    },
    fsyncDir: (dir: string) => {
      flushes.calls.push({ fn: "dir", path: dir, size: -1 });
      if (flushes.failDir) throw new Error("EIO: dir");
      real.fsyncDir(dir);
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  flushes.calls.length = 0;
  flushes.failFile = false;
  flushes.failDir = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "talous-fsync-"));
  dirs.push(d);
  return d;
};

async function realDb(dir: string) {
  const path = join(dir, "banking.db");
  const { db } = await openDatabase(path);
  db.exec("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u1', 'aino', 'X', 'h', 'admin', '2026-01-01')");
  flushes.calls.length = 0; // what opening a fresh database flushed does not count
  return { path, db };
}

/** The flushes of one copy: the file first (with its content already written), then its folder. */
function expectFlushedCopy(file: string) {
  const dir = join(file, "..");
  const at = flushes.calls.findIndex((c) => c.fn === "file" && c.path === file);
  expect(at, `${file} was flushed`).toBeGreaterThanOrEqual(0);
  expect(flushes.calls[at]!.size, "the file had its content when it was flushed").toBeGreaterThan(4096);
  expect(flushes.calls.slice(at + 1).some((c) => c.fn === "dir" && c.path === dir), `${dir} was flushed after the file`).toBe(true);
}

describe("database copies are flushed before they count", () => {
  it("the pre-migration snapshot", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const file = takeSnapshot(db, path, "pre-0009_x", new Date("2026-10-01T10:00:00Z"));
    expectFlushedCopy(file);
    db.close();
  });

  it("the snapshot openDatabase takes before it migrates", async () => {
    const path = join(tmp(), "banking.db");
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL("./fixtures/db/0.5.0.sql", import.meta.url), "utf8"));
    old.close();
    const opened = await openDatabase(path);
    expect(opened.snapshot).toMatch(/pre-0009_migration_compat-/);
    expectFlushedCopy(opened.snapshot!);
    opened.db.close();
  });

  it("the daily copy", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    expectFlushedCopy(dailyBackup(db, path, "2026-10-01"));
    db.close();
  });

  it("the copy restore saves of the database it replaces", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    const copy = takeSnapshot(db, path, "pre-test", new Date("2026-10-01T10:00:00Z"));
    db.close();
    flushes.calls.length = 0;
    restoreDatabase(path, copy, new Date("2026-10-02T10:00:00Z"));
    const saved = readdirSync(join(dir, "backups")).find((f) => f.startsWith("pre-restore-"));
    expect(saved).toBeDefined();
    expectFlushedCopy(join(dir, "backups", saved!));
  });

  it("a copy whose file flush fails is removed and the error reaches the caller", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    flushes.failFile = true;
    expect(() => takeSnapshot(db, path, "pre-0009_x", new Date("2026-10-01T10:00:00Z"))).toThrow(/EIO: file/);
    expect(readdirSync(join(dir, "backups"))).toEqual([]);
    expect(() => dailyBackup(db, path, "2026-10-01")).toThrow(/EIO: file/);
    expect(readdirSync(join(dir, "backups"))).toEqual([]);
    db.close();
  });

  it("a copy whose folder flush fails is removed too", async () => {
    const dir = tmp();
    const { path, db } = await realDb(dir);
    flushes.failDir = true;
    expect(() => dailyBackup(db, path, "2026-10-01")).toThrow(/EIO: dir/);
    expect(existsSync(join(dir, "backups", "auto-2026-10-01.db"))).toBe(false);
    db.close();
  });
});
