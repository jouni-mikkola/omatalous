import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDatabaseFile } from "../src/db/backup-check.ts";
import { openDatabase } from "../src/db/open.ts";
import { DAMAGED_PAGE, damagedLine, damageOf } from "../src/db/startup-gate.ts";
import { scratchDir } from "./helpers.ts";

const ENTRY = fileURLToPath(new URL("../src/entry/node.ts", import.meta.url));
// the sources are TypeScript with syntax Node cannot strip, so the entry runs under tsx as `pnpm dev` does
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
/** apps/server: where `--import tsx` finds tsx. */
const SERVER = fileURLToPath(new URL("..", import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = scratchDir("talous-gate-");
  dirs.push(d);
  return d;
};

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
  return { dir, path, db };
}

function addUser(db: { exec(sql: string): void }, username: string): void {
  db.exec(`INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES ('u-${username}', '${username}', 'X', 'h', 'admin', '2026-01-01')`);
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

const users = (path: string): string[] => {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    return (d.prepare("SELECT username FROM users ORDER BY username").all() as { username: string }[]).map((r) => r.username);
  } finally {
    d.close();
  }
};

describe("a damaged database", () => {
  it("is named with SQLite's own words, and nothing is moved or written", async () => {
    const h = await household();
    h.db.close();
    damage(h.path);
    const before = readFileSync(h.path);
    const lines: string[] = [];
    expect(damageOf(h.path, lines)).toMatch(/^(quick_check: |database disk image is malformed)/);
    expect(lines).toEqual([]);
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(readdirSync(h.dir).filter((f) => !f.startsWith("banking.db"))).toEqual([]);
  });

  it("is a file that is no database too", async () => {
    const dir = tmp();
    const path = join(dir, "banking.db");
    writeFileSync(path, "this is not a database. ".repeat(200));
    expect(damageOf(path, [])).toMatch(/not a database/);
  });

  it("is told to the household in one line and one page that name no copy to restore", () => {
    expect(damagedLine("/data/banking.db", "quick_check: bad")).toBe(
      "database: /data/banking.db is damaged (quick_check: bad). The server does not start on it and has changed nothing. Put back your own copy of the data folder and start again.",
    );
    expect(DAMAGED_PAGE).toMatch(/Palauta oma kopiosi data-kansiosta/);
  });
});

describe("a database the gate leaves alone", () => {
  it("does nothing without a file or with an empty one", async () => {
    const dir = tmp();
    const path = join(dir, "banking.db");
    const lines: string[] = [];
    expect(damageOf(path, lines)).toBeNull();
    writeFileSync(path, "");
    expect(damageOf(path, lines)).toBeNull();
    expect(statSync(path).size).toBe(0);
    // a data folder that does not exist yet: the first start of a new install
    expect(damageOf(join(dir, "new", "banking.db"), lines)).toBeNull();
    expect(existsSync(join(dir, "new"))).toBe(false);
    expect(lines).toEqual([]);
  });

  it("passes a WAL database: one that is open with changes in its log, and the files a killed process leaves", async () => {
    const h = await household();
    // a checkpoint, then one more write: the main file is complete without ville, who is in the log only
    h.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    addUser(h.db, "ville");
    expect(statSync(`${h.path}-wal`).size).toBeGreaterThan(0);
    const alone = join(tmp(), "banking.db");
    copyFileSync(h.path, alone);
    expect(users(alone)).toEqual(["aino"]);

    expect(damageOf(h.path, [])).toBeNull();

    // the main file and its log without the -shm index, as after a kill
    const killed = tmp();
    const path = join(killed, "banking.db");
    copyFileSync(h.path, path);
    copyFileSync(`${h.path}-wal`, `${path}-wal`);
    h.db.close();

    expect(damageOf(path, [])).toBeNull();
    const opened = await openDatabase(path);
    expect((await opened.db.all<{ username: string }>("SELECT username FROM users ORDER BY username")).map((u) => u.username)).toEqual(["aino", "ville"]);
    opened.db.close();
  });

  it("passes a database another process holds locked", async () => {
    const h = await household();
    h.db.close();
    const before = readFileSync(h.path);
    const holder = new DatabaseSync(h.path);
    const lines: string[] = [];
    try {
      holder.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN IMMEDIATE; INSERT INTO filler VALUES (x'00')");
      expect(damageOf(h.path, lines)).toBeNull();
      expect(lines).toEqual([expect.stringMatching(/^database: the check before the start was skipped \(database is locked\)\.$/)]);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(users(h.path)).toEqual(["aino"]);
  });
});

describe("the entry point", () => {
  const env = (dataDir: string) => ({ PATH: process.env.PATH, TMPDIR: tmp(), DATA_DIR: dataDir, APP_SECRET: "test-secret-that-is-long-enough-0123456789", PORT: "0", HOST: "127.0.0.1" });

  it("on a damaged database prints the line, stays up and leaves the file as it was", async () => {
    const h = await household();
    addUser(h.db, "ville");
    h.db.close();
    damage(h.path);
    const before = readFileSync(h.path);
    const port = await new Promise<number>((done) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => done(free));
      });
    });
    // node itself with tsx as the loader, not the tsx command: that one waits 30 ms for its child to answer a signal
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", ENTRY], { cwd: SERVER, env: { ...env(h.dir), PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const line = await new Promise<string>((done) => {
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
        if (/is damaged/.test(err)) done(err);
      });
      child.on("exit", () => done(err));
    });
    const alive = child.exitCode === null;
    child.kill("SIGKILL");
    expect(line).toMatch(/^database: .+banking\.db is damaged \(.+\)\. The server does not start on it and has changed nothing/m);
    expect(alive).toBe(true);
    expect(readFileSync(h.path).equals(before)).toBe(true);
    expect(existsSync(join(h.dir, "damaged"))).toBe(false);
    expect(readdirSync(h.dir).includes("backups")).toBe(false);
  }, 120_000);

  it("never runs the check for a CLI call: the damaged file stays and nothing is printed about it", async () => {
    const h = await household();
    h.db.close();
    damage(h.path);
    mkdirSync(join(h.dir, "ops"), { recursive: true });
    const before = readFileSync(h.path);
    const r = spawnSync(TSX, ["--disable-warning=ExperimentalWarning", ENTRY, "version"], { env: env(h.dir), encoding: "utf8", timeout: 100_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/^database:/m);
    expect(readFileSync(h.path).equals(before)).toBe(true);
  }, 120_000);
});
