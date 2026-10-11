#!/usr/bin/env node
// @ts-check
/**
 * Writes the frozen database fixture of a release: tools/release/fixture.mjs X.Y.Z [--out FILE] [--at ISO]
 *
 * Takes the newest fixture below X.Y.Z in apps/server/test/fixtures/db/, loads it into a scratch database, applies the
 * migrations of this checkout with the runner the app uses (db/migrate.ts, so the `_migrations` rows hold the checksum
 * and the compat floor the runner writes), loads the seed rows and writes the result as apps/server/test/fixtures/db/
 * X.Y.Z.sql. Seed rows for a table the release added are in apps/server/test/fixtures/db/seeds/X.Y.Z/<table>.sql, one
 * file per table with INSERT statements. A leading comment in that file says what its rows cover. A seed file for a
 * table that already exists adds rows to it. The `applied_at` of the new `_migrations` rows is --at (default: today
 * 08:00 UTC) so that a second run writes the same file.
 *
 * It refuses a new table without seed rows, a seed file for a table that does not exist, a seed that changes the
 * schema or breaks a foreign key, a missing or different contracts/X.Y.Z/schema.sql, a database that still has a
 * pending migration, an existing output file and a written file that does not load back to the same schema and rows.
 * Nothing is written when it refuses. It prints the header it wrote: say there what the seed rows cover before you
 * commit the file. A released fixture is never edited, so there is no way to overwrite one.
 *
 * --facts writes nothing and checks no seed or contract: it migrates the previous fixture one migration at a time and
 * prints one JSON line, { version, previous, migrations: [{ name, compat, tables, columns, indexes }] }, what each
 * migration adds and the compat floor it carries (null: none). prepare.mjs writes contracts/X.Y.Z/README.md from it.
 *
 * Options for the tests: --fixtures DIR, --seeds DIR, --contracts DIR and --migrations DIR replace the repository's
 * folders. Needs Node 22.18 or newer, because it reads db/migrate.ts as it is.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// node:sqlite and the type stripping of the .ts import below each print an experimental notice that is no news here
const emitWarning = process.emitWarning;
process.emitWarning = /** @type {typeof process.emitWarning} */ (
  (warning, ...rest) => {
    const type = typeof rest[0] === "string" ? rest[0] : /** @type {{ type?: string } | undefined} */ (rest[0])?.type;
    if (type === "ExperimentalWarning") return;
    return /** @type {(...a: unknown[]) => void} */ (emitWarning).call(process, warning, ...rest);
  }
);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

class Refuse extends Error {}

/** @param {string} a @param {string} b */
const compare = (a, b) => {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return /** @type {number} */ (x[i]) - /** @type {number} */ (y[i]);
  return 0;
};

/** @typedef {import("node:sqlite").DatabaseSync} Sqlite */
/** @typedef {{ name: string, sql: string }} Migration */
/** @typedef {{ pendingMigrations(db: unknown, migrations: Migration[]): Promise<{ pending: Migration[], ahead: string[] }>, applyMigrations(db: unknown, pending: Migration[]): Promise<string[]>, compatFloor(m: Migration): string | null }} Runner */

const { DatabaseSync } = await import("node:sqlite");

/** @returns {Promise<Runner>} */
async function loadRunner() {
  try {
    return await import(pathToFileURL(join(ROOT, "apps/server/src/db/migrate.ts")).href);
  } catch (e) {
    throw new Refuse(`cannot read apps/server/src/db/migrate.ts (needs Node 22.18 or newer): ${/** @type {Error} */ (e).message}`);
  }
}

/** The database surface the runner uses (db/types.ts), over node:sqlite. @param {Sqlite} db */
function runnerDb(db) {
  return {
    exec: (/** @type {string} */ sql) => db.exec(sql),
    all: async (/** @type {string} */ sql, /** @type {any[]} */ p = []) => db.prepare(sql).all(...p),
    first: async (/** @type {string} */ sql, /** @type {any[]} */ p = []) => db.prepare(sql).get(...p) ?? null,
    run: async (/** @type {string} */ sql, /** @type {any[]} */ p = []) => ({ changes: Number(db.prepare(sql).run(...p).changes) }),
    batch: async () => {},
  };
}

/** @param {string} dir @returns {Migration[]} */
const readMigrations = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));

/** @param {Sqlite} db @returns {string[]} the user tables in creation order */
const tablesOf = (db) =>
  /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()).map((r) => r.name);

/** @param {Sqlite} db @returns {string[]} the names of the indexes the schema declares */
const indexesOf = (db) =>
  /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY rowid").all()).map((r) => r.name);

/** @param {Sqlite} db @param {string} table @returns {string[]} */
const columnsOf = (db, table) => /** @type {{ name: string }[]} */ (db.prepare(`PRAGMA table_info("${table}")`).all()).map((c) => c.name);

/** The schema the way contracts.test.ts dumps it, without the header lines. @param {Sqlite} db */
function contractBody(db) {
  const rows = /** @type {{ sql: string }[]} */ (
    db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").all()
  );
  return `${rows.map((r) => `${r.sql};`).join("\n")}\n`;
}

/** The schema as the fixture lists it: tables first, then indexes and the rest, each in creation order. @param {Sqlite} db */
function schemaStatements(db) {
  const rows = /** @type {{ type: string, sql: string }[]} */ (db.prepare("SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all());
  return [...rows.filter((r) => r.type === "table"), ...rows.filter((r) => r.type !== "table")].map((r) => `${r.sql};`);
}

const ident = (/** @type {string} */ n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n.replaceAll('"', '""')}"`);

/** The order a table's rows are written in: rowid, or every column for a table without one. @param {Sqlite} db @param {string} table */
function orderOf(db, table) {
  const ddl = /** @type {{ sql: string }} */ (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).sql;
  return /WITHOUT\s+ROWID/i.test(ddl) ? columnsOf(db, table).map((_, i) => i + 1).join(",") : "rowid";
}

/** One INSERT per row, values written by SQLite's own quote(), so text, numbers, NULL and blobs load back exactly. @param {Sqlite} db @param {string} table */
function insertsOf(db, table) {
  const cols = columnsOf(db, table);
  const rows = /** @type {Record<string, string>[]} */ (db.prepare(`SELECT ${cols.map((c) => `quote("${c}")`).join(", ")} FROM "${table}" ORDER BY ${orderOf(db, table)}`).all());
  const head = `INSERT INTO ${ident(table)} (${cols.map(ident).join(",")}) VALUES (`;
  return rows.map((r) => `${head}${Object.values(r).join(",")});`);
}

/** Every row as JSON: the values themselves, which the statements above only spell. @param {Sqlite} db */
function valuesOf(db) {
  const bigint = (/** @type {string} */ _, /** @type {unknown} */ v) => (typeof v === "bigint" ? `${v}n` : v);
  return tablesOf(db).map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY ${orderOf(db, t)}`).all(), bigint)).join("\n");
}

/** Every table's INSERT statements, `_migrations` first. @param {Sqlite} db */
function dataStatements(db) {
  const tables = tablesOf(db);
  const ordered = [...tables.filter((t) => t === "_migrations"), ...tables.filter((t) => t !== "_migrations")];
  return ordered.flatMap((t) => insertsOf(db, t));
}

/**
 * A connection to a new database file that has the fixture loaded, closed and reopened as the app opens a file.
 * @param {string} file @param {string} sql @returns {Sqlite}
 */
function fromSql(file, sql) {
  const loader = new DatabaseSync(file);
  loader.exec(sql);
  loader.close();
  return new DatabaseSync(file);
}

/** The first lines of a seed file while they are comments: what its rows cover. @param {string} sql */
function leadingComment(sql) {
  const lines = [];
  for (const line of sql.split("\n")) {
    if (!line.startsWith("--")) break;
    lines.push(line.replace(/^--\s?/, "").trim());
  }
  return lines.join(" ").trim();
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i]);
    if (a === "-h" || a === "--help") opts.help = "1";
    else if (a === "--facts") opts.facts = "1";
    else if (/^--(out|at|fixtures|seeds|contracts|migrations)$/.test(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Refuse(`${a} needs a value.`);
      opts[a.slice(2)] = v;
    } else if (a.startsWith("-")) throw new Refuse(`Unknown option: ${a} (usage: fixture.mjs X.Y.Z [--out FILE] [--at ISO] [--facts])`);
    else rest.push(a);
  }
  return { opts, version: rest[0], extra: rest.slice(1) };
}

/** @param {string[]} argv */
async function main(argv) {
  const { opts, version, extra } = parseArgs(argv);
  if (opts.help) {
    const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
    console.log(lines.slice(3, lines.indexOf(" */")).map((l) => l.replace(/^ \* ?/, "")).join("\n"));
    return;
  }
  if (!version || extra.length || !SEMVER.test(version)) throw new Refuse("usage: fixture.mjs X.Y.Z [--out FILE] [--at ISO] [--facts]");
  const fixtures = resolve(opts.fixtures ?? join(ROOT, "apps/server/test/fixtures/db"));
  const seedsDir = resolve(opts.seeds ?? join(fixtures, "seeds", version));
  const contractFile = join(resolve(opts.contracts ?? join(ROOT, "contracts")), version, "schema.sql");
  const migrationsDir = resolve(opts.migrations ?? join(ROOT, "apps/server/migrations"));
  const out = resolve(opts.out ?? join(fixtures, `${version}.sql`));
  const at = opts.at ?? `${new Date().toISOString().slice(0, 10)}T08:00:00.000Z`;
  if (!ISO.test(at)) throw new Refuse(`--at must look like 2026-10-12T08:00:00.000Z, not ${at}.`);

  if (!opts.facts && existsSync(out)) throw new Refuse(`${out} exists. A fixture is frozen: never edit or overwrite one.`);
  const known = readdirSync(fixtures)
    .map((f) => /^(\d+\.\d+\.\d+)\.sql$/.exec(f)?.[1])
    .filter((v) => v !== undefined)
    .sort(compare);
  const prev = [...known].reverse().find((v) => compare(/** @type {string} */ (v), version) < 0);
  if (!prev) throw new Refuse(`no fixture below ${version} in ${fixtures}.`);
  if (!opts.facts && !existsSync(contractFile)) throw new Refuse(`${contractFile} is missing. Write it first: UPDATE_CONTRACT=${version} pnpm test apps/server/test/contracts.test.ts`);

  const runner = await loadRunner();
  const work = mkdtempSync(join(tmpdir(), "fixture-"));
  /** @type {Sqlite[]} */
  const open = [];
  try {
    const migrations = readMigrations(migrationsDir);
    const db = fromSql(join(work, "migrated.db"), readFileSync(join(fixtures, `${prev}.sql`), "utf8"));
    open.push(db);
    const tablesBefore = tablesOf(db);
    const columnsBefore = Object.fromEntries(tablesBefore.map((t) => [t, columnsOf(db, t)]));

    const { pending, ahead } = await runner.pendingMigrations(runnerDb(db), migrations);
    if (ahead.length) throw new Refuse(`${prev}.sql has migrations this checkout does not know: ${ahead.join(", ")}.`);
    // one at a time, so that what each adds is known: the runner loops over them the same way
    /** @type {{ name: string, compat: string | null, tables: string[], columns: string[], indexes: string[] }[]} */
    const facts = [];
    /** @type {string[]} */
    const applied = [];
    for (const m of pending) {
      const [tables, indexes] = [tablesOf(db), indexesOf(db)];
      const cols = Object.fromEntries(tables.map((t) => [t, columnsOf(db, t)]));
      applied.push(...(await runner.applyMigrations(runnerDb(db), [m])));
      facts.push({
        name: m.name,
        compat: runner.compatFloor(m),
        tables: tablesOf(db).filter((t) => !tables.includes(t)),
        columns: tables.flatMap((t) => columnsOf(db, t).filter((c) => !cols[t]?.includes(c)).map((c) => `${t}.${c}`)),
        indexes: indexesOf(db).filter((i) => !indexes.includes(i)),
      });
    }
    if (opts.facts) {
      console.log(JSON.stringify({ version, previous: prev, migrations: facts }));
      return;
    }
    for (const name of applied) db.prepare("UPDATE _migrations SET applied_at = ? WHERE name = ?").run(at, name);
    const tablesAfter = tablesOf(db);
    const added = tablesAfter.filter((t) => !tablesBefore.includes(t));
    const addedColumns = tablesBefore.flatMap((t) => columnsOf(db, t).filter((c) => !columnsBefore[t]?.includes(c)).map((c) => `${t}.${c}`));

    // the seed rows: the shape of the database must not change, and every new table needs rows
    const schemaBefore = contractBody(db);
    const seedFiles = existsSync(seedsDir) ? readdirSync(seedsDir).filter((f) => f.endsWith(".sql")).sort() : [];
    /** @type {Record<string, string>} */
    const covers = {};
    for (const file of seedFiles) {
      const table = file.slice(0, -4);
      if (!tablesAfter.includes(table)) throw new Refuse(`seeds/${version}/${file} is for a table that does not exist (tables: ${tablesAfter.join(", ")}).`);
      const sql = readFileSync(join(seedsDir, file), "utf8");
      covers[table] = leadingComment(sql);
      try {
        db.exec("BEGIN");
        db.exec(sql);
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // the failed statement already ended the transaction
        }
        throw new Refuse(`seeds/${version}/${file} fails: ${/** @type {Error} */ (e).message}`);
      }
    }
    if (contractBody(db) !== schemaBefore) throw new Refuse(`a seed file changed the schema. Seed files hold INSERT statements only.`);
    const counts = /** @type {Record<string, number>} */ ({});
    for (const t of added) {
      counts[t] = Number(/** @type {{ n: number }} */ (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get()).n);
      if (counts[t] === 0) throw new Refuse(`the new table ${t} has no rows. Write ${join(seedsDir, `${t}.sql`)} with INSERT statements that cover each kind of value the table holds.`);
    }
    const broken = /** @type {{ table: string }[]} */ (db.prepare("PRAGMA foreign_key_check").all());
    if (broken.length) throw new Refuse(`rows break a foreign key in ${[...new Set(broken.map((b) => b.table))].join(", ")}.`);

    // the schema is the one this release freezes
    const contract = readFileSync(contractFile, "utf8").split("\n").filter((l, i, all) => !(l.startsWith("--") && all.slice(0, i).every((p) => p.startsWith("--")))).join("\n");
    if (contractBody(db) !== contract) {
      const statements = (/** @type {string} */ body) => body.split(/;\n(?=CREATE )/);
      const theirs = new Set(statements(contract));
      const differs = statements(contractBody(db)).filter((s) => !theirs.has(s)).slice(0, 3).map((s) => s.split("\n")[0]);
      throw new Refuse(`the migrated schema differs from ${contractFile}${differs.length ? ` (for example: ${differs.join(" | ")})` : ""}. Regenerate the contract or fix the migration.`);
    }
    const left = await runner.pendingMigrations(runnerDb(db), migrations);
    if (left.pending.length || left.ahead.length) throw new Refuse(`migrations are still pending: ${[...left.pending.map((m) => m.name), ...left.ahead].join(", ")}.`);

    const header = [
      `-- Frozen database as written by Omatalous ${version}. Never edit; add a new file per release.`,
      `-- Everything in ${prev}.sql plus what ${version} adds: ${applied.length ? `the _migrations rows of ${applied.join(", ")} (the checksums and floors the runner writes)` : "no migration"}` +
        `${added.length ? `, the tables ${added.map((t) => `${t} (${counts[t]} rows)`).join(", ")}` : ""}` +
        `${addedColumns.length ? `, the columns ${addedColumns.join(", ")}` : ""}.`,
      ...Object.entries(covers).filter(([, c]) => c).map(([t, c]) => `-- Rows of ${t}: ${c}`),
      `-- The schema is the ${prev} schema migrated by the ${version} code and equals contracts/${version}/schema.sql.`,
      "-- Loaded by apps/server/test/migration-chain.test.ts and apps/server/test/contracts.test.ts.",
    ];
    const text = [...header, "PRAGMA foreign_keys = OFF;", ...schemaStatements(db), ...dataStatements(db)].join("\n") + "\n";

    // the file must load back to the database it was made from
    const back = fromSql(join(work, "back.db"), text);
    open.push(back);
    if (schemaStatements(back).join("\n") !== schemaStatements(db).join("\n")) throw new Refuse("the written file does not load back to the same schema. Nothing was written.");
    if (dataStatements(back).join("\n") !== dataStatements(db).join("\n") || valuesOf(back) !== valuesOf(db)) throw new Refuse("the written file does not load back to the same rows. Nothing was written.");
    const again = await runner.pendingMigrations(runnerDb(back), migrations);
    if (again.pending.length) throw new Refuse(`the written file leaves migrations pending: ${again.pending.map((m) => m.name).join(", ")}.`);

    mkdirSync(dirname(out), { recursive: true });
    const tmp = `${out}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, out);
    const rows = tablesAfter.reduce((n, t) => n + Number(/** @type {{ n: number }} */ (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get()).n), 0);
    console.log(`fixture: wrote ${out} from ${prev}.sql (${tablesAfter.length} tables, ${rows} rows, ${applied.length} migrations applied, ${added.length} new tables).`);
    console.log("Say what the seed rows cover in the header (see 0.8.0.sql) before you commit it:");
    console.log(header.map((l) => `  ${l}`).join("\n"));
  } finally {
    for (const d of open) d.close();
    rmSync(work, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((e) => {
  if (e instanceof Refuse) {
    console.error(`fixture: refused: ${e.message}`);
    process.exit(1);
  }
  console.error(e);
  process.exit(2);
});
