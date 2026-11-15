/**
 * `node dist/node.js migrate-check <database file>`: tries the pending migrations on a copy before a real update
 * touches the database. scripts/update.sh runs it with the new image on the pre-update copy while the old version
 * is still serving.
 *
 *   1. the file is opened read-only (never for writing) and copied with VACUUM INTO, the same way as every
 *      other database copy (open.ts), so the content of a WAL that another process still holds is included.
 *      The copy goes into a dot-named folder next to the file, on the same disk as the database and its other
 *      copies: the compose service has a 16 MB tmpfs on /tmp that counts against its memory limit, and the
 *      copy plus its WAL needs about twice the size of the database
 *   2. the pending migrations are applied to the copy, each in its own transaction as at start
 *   3. integrity_check, foreign_key_check and the row count of every table are compared with the copy before
 *   4. one JSON line goes to stdout, a short English line to stderr, the scratch folder is removed
 *
 * Exit code 0 when everything passed, 1 when anything failed, 2 for a wrong command line. The scratch folder is
 * removed on every way out: success, failure, and SIGINT or SIGTERM (exit 130 or 143). The event loop gets a turn
 * between the steps so the signal is served there; a single VACUUM INTO or migration cannot be interrupted. A
 * run that was killed with SIGKILL leaves its folder, and the next run removes folders older than a day.
 *
 * A table may gain rows but never lose them: a migration that deletes rows on purpose fails here, and a later
 * change has to say how many it may remove before such a migration ships.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { yieldToLoop } from "../platform/yield.ts";
import { applyMigrations, MigrationError, pendingMigrations } from "./migrate.ts";
import { openNodeSqlite } from "./node-sqlite.ts";
import { buildMigrations, copyDatabase, findMigrationsDir } from "./open.ts";

export interface MigrateCheckOptions {
  /** Defaults to the migrations this build carries. */
  migrationsDir?: string;
  /** Tests pretend to be another release. */
  appVersion?: string;
}

export interface MigrateCheckReport {
  ok: boolean;
  file: string;
  /** The whole check, the copy included. */
  elapsedMs: number;
  /** Applying the migrations only: what an update has to wait for. */
  migrateMs: number;
  from: number;
  to: number;
  applied: string[];
  /** Migrations the file has and this build does not know but may run on (migrate.ts). */
  ahead: string[];
  integrity: string;
  foreignKeyViolations: { before: number; after: number };
  tables: Record<string, { before: number; after: number }>;
  problems: string[];
}

type CopyDb = ReturnType<typeof openNodeSqlite>;

/** Row counts of every table except the migration history, which grows by design. */
async function rowCounts(db: CopyDb): Promise<Record<string, number>> {
  const names = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name");
  const out: Record<string, number> = {};
  for (const { name } of names) out[name] = Number((await db.first<{ n: number }>(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`))!.n);
  return out;
}

const violations = async (db: CopyDb) => (await db.all("PRAGMA foreign_key_check")).length;

const SCRATCH_PREFIX = ".talous-migrate-check-";
const STALE_MS = 86_400_000;

/**
 * Removes `dir` and exits when the process is told to stop (docker stop, Ctrl-C), so no half-made copy stays next to
 * a database. Returns the function that takes the handlers away again.
 */
export function removeOnSignal(dir: string, exit: (code: number) => never = process.exit): () => void {
  const handlers = (["SIGINT", "SIGTERM"] as const).map((signal) => {
    const handler = () => {
      rmSync(dir, { recursive: true, force: true });
      exit(signal === "SIGINT" ? 130 : 143);
    };
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

/** Folders of earlier runs that were killed before they could clean up. */
function removeStale(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue;
    try {
      if (Date.now() - statSync(join(dir, name)).mtimeMs > STALE_MS) rmSync(join(dir, name), { recursive: true, force: true });
    } catch {
      // gone already, or not ours to remove: leave it
    }
  }
}

export async function migrateCheck(file: string, opts: MigrateCheckOptions = {}): Promise<MigrateCheckReport> {
  const started = performance.now();
  const report: MigrateCheckReport = {
    ok: false,
    file,
    elapsedMs: 0,
    migrateMs: 0,
    from: 0,
    to: 0,
    applied: [],
    ahead: [],
    integrity: "not run",
    foreignKeyViolations: { before: 0, after: 0 },
    tables: {},
    problems: [],
  };
  let step = "reading the file";
  let scratch: string | undefined;
  let stopListening: (() => void) | undefined;
  let original: DatabaseSync | undefined;
  let copy: CopyDb | undefined;
  try {
    if (!statSync(file).isFile()) throw new Error("it is not a regular file");
    // read-only: a live database may be open elsewhere, and this command never writes to it
    original = new DatabaseSync(file, { readOnly: true });
    original.exec("PRAGMA busy_timeout = 5000");
    step = "copying";
    const home = dirname(resolve(file));
    removeStale(home);
    scratch = mkdtempSync(join(home, SCRATCH_PREFIX));
    stopListening = removeOnSignal(scratch);
    const path = copyDatabase(original, scratch, "check.db");
    original.close();
    original = undefined;
    await yieldToLoop();

    step = "opening the copy";
    copy = openNodeSqlite(path);
    const before = await rowCounts(copy);
    report.foreignKeyViolations.before = await violations(copy);
    const migrations = buildMigrations(opts.migrationsDir ?? findMigrationsDir());
    const { pending, applied, ahead } = await pendingMigrations(copy, migrations, opts);
    report.from = applied;
    report.ahead = ahead;

    await yieldToLoop();
    step = "migrating the copy";
    const migrating = performance.now();
    report.applied = await applyMigrations(copy, pending);
    report.migrateMs = Math.round(performance.now() - migrating);
    report.to = Number((await copy.first<{ n: number }>("SELECT count(*) AS n FROM _migrations"))!.n);

    await yieldToLoop();
    step = "checking the copy";
    const integrity = (await copy.all<{ integrity_check: string }>("PRAGMA integrity_check")).map((r) => r.integrity_check);
    report.integrity = integrity.length === 1 && integrity[0] === "ok" ? "ok" : integrity.slice(0, 5).join("; ");
    if (report.integrity !== "ok") report.problems.push(`integrity_check failed: ${report.integrity}`);
    report.foreignKeyViolations.after = await violations(copy);
    // violations the file already had are reported; the migrations must not add any
    if (report.foreignKeyViolations.after > report.foreignKeyViolations.before) {
      report.problems.push(`foreign_key_check found ${report.foreignKeyViolations.after} violations after the migrations, ${report.foreignKeyViolations.before} before`);
    }
    const after = await rowCounts(copy);
    for (const [table, n] of Object.entries(before)) {
      report.tables[table] = { before: n, after: after[table] ?? 0 };
      if (after[table] === undefined) report.problems.push(`${table}: ${n} rows before, table missing after the migrations`);
      else if (after[table]! < n) report.problems.push(`${table}: ${n} rows before, ${after[table]} after`);
    }
    for (const [table, n] of Object.entries(after)) if (!(table in before)) report.tables[table] = { before: 0, after: n };
  } catch (err) {
    // a MigrationError already says what failed and in which file
    report.problems.push(err instanceof MigrationError ? err.message : `${step}: ${(err as Error).message}`);
  } finally {
    for (const open of [original, copy]) {
      try {
        open?.close();
      } catch {
        // nothing left to release
      }
    }
    stopListening?.();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  report.ok = report.problems.length === 0;
  report.elapsedMs = Math.round(performance.now() - started);
  return report;
}

const USAGE = "Usage: node dist/node.js migrate-check <database file>";

/** The command: one JSON line on stdout for scripts, a short English line on stderr for people. */
export async function runMigrateCheck(
  args: string[],
  io: { out: (line: string) => void; err: (line: string) => void } = { out: console.log, err: console.error },
  opts: MigrateCheckOptions = {},
): Promise<number> {
  if (args.length !== 1 || args[0]!.startsWith("-")) {
    io.err(USAGE);
    return 2;
  }
  const r = await migrateCheck(args[0]!, opts);
  io.out(
    JSON.stringify({
      ok: r.ok,
      file: r.file,
      elapsed_ms: r.elapsedMs,
      migrate_ms: r.migrateMs,
      from: r.from,
      to: r.to,
      applied: r.applied,
      ahead: r.ahead,
      integrity: r.integrity,
      foreign_key_violations: r.foreignKeyViolations,
      tables: r.tables,
      problems: r.problems,
    }),
  );
  if (r.ok) {
    const n = r.applied.length;
    io.err(`migrate-check: ok, ${n === 0 ? "nothing to apply" : `${n} migration${n === 1 ? "" : "s"} applied to a copy`} in ${r.elapsedMs} ms (migrating took ${r.migrateMs} ms). ${r.file} was not changed.`);
  } else {
    io.err(`migrate-check failed: ${r.problems.join("; ")}`);
  }
  return r.ok ? 0 : 1;
}
