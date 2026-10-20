/**
 * The frozen contracts under contracts/<version>/ (see contracts/README.md): what an older installation reads from a
 * newer release. This file checks that the current code satisfies every one of them, and that the checks themselves
 * notice the changes they exist for.
 *
 * To regenerate the schema dump of a version that has not shipped yet:
 *   UPDATE_CONTRACT=0.6.0 pnpm test apps/server/test/contracts.test.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { openDatabase } from "../src/db/open.ts";
import { normaliseState } from "../src/services/ops-validate.ts";
import { APP_VERSION } from "../src/version.ts";
import { loadFixture } from "./fixture-db.ts";
import { setupApp, scratchDir } from "./helpers.ts";

const CONTRACTS = fileURLToPath(new URL("../../../contracts/", import.meta.url));
const FIXTURES = new URL("./fixtures/db/", import.meta.url);

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = scratchDir("talous-contract-");
  dirs.push(d);
  return d;
};

const versions = readdirSync(CONTRACTS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => compareVersions(a, b));

function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

// ── schema ───────────────────────────────────────────────

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface TableInfo {
  columns: Column[];
  /** `from -> table.to on delete / on update`, one per foreign key column. */
  foreignKeys: string[];
  /** One key per index: unique flag, columns and the WHERE of a partial index. Names do not count. */
  indexes: string[];
  /** Every CHECK (...) of the table as written, without the parentheses. */
  checkClauses: string[];
  /** The quoted values inside each CHECK (...), by the column the clause limits: an old build may still write any of them. */
  checkValues: Record<string, string[]>;
}
type Schema = Record<string, TableInfo>;

/** The text inside the parentheses of each CHECK of a table. */
function checkClauses(sql: string): string[] {
  const out: string[] = [];
  const re = /CHECK\s*\(/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) depth += sql[i] === "(" ? 1 : sql[i] === ")" ? -1 : 0;
    out.push(sql.slice(start, i));
  }
  return out;
}

/** Quoted strings inside the parentheses of each CHECK clause, under the first word of the clause, which is its column. */
function checkValues(clauses: string[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const clause of clauses) {
    const values = (out[/[A-Za-z_]\w*/.exec(clause)?.[0] ?? ""] ??= new Set());
    for (const lit of clause.matchAll(/'((?:[^']|'')*)'/g)) values.add(lit[1]!);
  }
  return Object.fromEntries(Object.entries(out).map(([column, values]) => [column, [...values].sort()]));
}

function describeSchema(db: DatabaseSync): Schema {
  const out: Schema = {};
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
  for (const { name, sql } of tables) {
    const q = `"${name}"`;
    const fks = db.prepare(`PRAGMA foreign_key_list(${q})`).all() as { from: string; table: string; to: string | null; on_update: string; on_delete: string }[];
    const indexes = (db.prepare(`PRAGMA index_list(${q})`).all() as { name: string; unique: number; partial: number }[]).map((ix) => {
      const cols = (db.prepare(`PRAGMA index_info("${ix.name}")`).all() as { name: string | null }[]).map((c) => c.name ?? "<expression>");
      const ixSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(ix.name) as { sql: string | null } | undefined)?.sql ?? "";
      const where = ix.partial ? ` where ${/\bWHERE\b([\s\S]*)$/i.exec(ixSql)?.[1]?.replace(/\s+/g, " ").trim() ?? "?"}` : "";
      return `${ix.unique ? "unique " : ""}(${cols.join(", ")})${where}`;
    });
    const clauses = checkClauses(sql);
    out[name] = {
      columns: db.prepare(`PRAGMA table_info(${q})`).all() as unknown as Column[],
      foreignKeys: fks.map((f) => `${f.from} -> ${f.table}.${f.to ?? ""} on delete ${f.on_delete} on update ${f.on_update}`).sort(),
      indexes: indexes.sort(),
      checkClauses: clauses,
      checkValues: checkValues(clauses),
    };
  }
  return out;
}

/** What a newer database must still offer to code that knows only the contract. */
function schemaProblems(contract: Schema, head: Schema): string[] {
  const out: string[] = [];
  for (const [table, c] of Object.entries(contract)) {
    const h = head[table];
    if (!h) {
      out.push(`table ${table} is gone`);
      continue;
    }
    const headColumns = new Map(h.columns.map((x) => [x.name, x]));
    const known = new Set(c.columns.map((x) => x.name));
    for (const col of c.columns) {
      const x = headColumns.get(col.name);
      const at = `${table}.${col.name}`;
      if (!x) out.push(`column ${at} is gone`);
      else {
        if (x.type.toUpperCase() !== col.type.toUpperCase()) out.push(`column ${at} changed its type from ${col.type} to ${x.type}`);
        if (x.pk !== col.pk) out.push(`column ${at} changed its place in the primary key`);
        if (x.notnull && !col.notnull) out.push(`column ${at} became NOT NULL, older code may write NULL`);
        if (col.dflt_value !== null && x.dflt_value !== col.dflt_value) out.push(`column ${at} changed its default from ${col.dflt_value} to ${x.dflt_value}`);
      }
    }
    for (const x of h.columns) {
      if (!known.has(x.name) && x.notnull && x.dflt_value === null && !x.pk) out.push(`new column ${table}.${x.name} is NOT NULL without a default, older code cannot insert rows`);
    }
    const headFks = h.foreignKeys.filter((f) => known.has(f.split(" -> ")[0]!));
    if (JSON.stringify(headFks) !== JSON.stringify(c.foreignKeys)) out.push(`foreign keys of ${table} changed: ${c.foreignKeys.join("; ") || "none"} became ${headFks.join("; ") || "none"}`);
    for (const ix of c.indexes) if (!h.indexes.includes(ix)) out.push(`index ${ix} of ${table} is gone`);
    for (const ix of h.indexes) {
      const cols = /^unique \(([^)]*)\)$/.exec(ix)?.[1]?.split(", ");
      if (cols && !c.indexes.includes(ix) && cols.every((x) => known.has(x))) out.push(`new unique index ${ix} on ${table}, older code may break it`);
    }
    // a column whose CHECK is gone takes every value; a CHECK that is still there must list what the contract's did. A clause
    // that limits the column but starts with another word (lower(status) IN (...)) is filed elsewhere: it still counts, as one
    // that lists nothing, so every old value is reported.
    for (const [column, values] of Object.entries(c.checkValues)) {
      const now = h.checkValues[column] ?? (h.checkClauses.some((x) => new RegExp(`\\b${column}\\b`).test(x)) ? [] : undefined);
      for (const v of now ? values : []) if (!now!.includes(v)) out.push(`CHECK of ${table} no longer allows '${v}'`);
    }
  }
  return out;
}

const HEADER = (v: string) =>
  `-- Frozen schema of a fresh Omatalous ${v} database. apps/server/test/contracts.test.ts checks that later versions\n` +
  `-- keep it (contracts/README.md). Regenerate while ${v} is unreleased: UPDATE_CONTRACT=${v} pnpm test apps/server/test/contracts.test.ts\n`;

function dumpSchema(db: DatabaseSync, version: string): string {
  const rows = db
    .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name")
    .all() as { sql: string }[];
  return `${HEADER(version)}${rows.map((r) => `${r.sql};`).join("\n")}\n`;
}

async function freshDb(): Promise<DatabaseSync> {
  const file = join(tmp(), "fresh.db");
  (await openDatabase(file)).db.close();
  return new DatabaseSync(file, { readOnly: true });
}

/** Every released fixture, brought up to the current schema the way an update does it. */
async function upgradedDbs(): Promise<[string, DatabaseSync][]> {
  const out: [string, DatabaseSync][] = [];
  for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".sql")).sort()) {
    const file = join(tmp(), "banking.db");
    loadFixture(file, name);
    (await openDatabase(file)).db.close();
    out.push([name, new DatabaseSync(file, { readOnly: true })]);
  }
  return out;
}

let upgraded: Promise<[string, Schema][]> | undefined;
/** The schemas of `upgradedDbs`, made once for every version's test. */
const upgradedSchemas = () =>
  (upgraded ??= upgradedDbs().then((dbs) =>
    dbs.map(([name, db]): [string, Schema] => {
      const schema = describeSchema(db);
      db.close();
      return [name, schema];
    }),
  ));

if (process.env.UPDATE_CONTRACT) {
  const v = process.env.UPDATE_CONTRACT;
  if (!/^\d+\.\d+\.\d+$/.test(v) || compareVersions(APP_VERSION, v) >= 0) throw new Error(`UPDATE_CONTRACT=${v}: only a version above ${APP_VERSION} (not released yet) may be regenerated`);
  const db = await freshDb();
  mkdirSync(join(CONTRACTS, v), { recursive: true });
  writeFileSync(join(CONTRACTS, v, "schema.sql"), dumpSchema(db, v));
  db.close();
}

describe("contracts: the folders", () => {
  it("0.6.0 exists and every folder holds a schema and the three helper outputs", () => {
    expect(versions).toContain("0.6.0");
    for (const v of versions) {
      for (const f of ["schema.sql", "ops-poll.json", "ops-report.json", "ops-state.json", "README.md"]) expect(existsSync(join(CONTRACTS, v, f)), `${v}/${f}`).toBe(true);
    }
  });
});

describe("contracts: schema", () => {
  for (const v of versions) {
    const sql = readFileSync(join(CONTRACTS, v, "schema.sql"), "utf8");
    const contract = () => {
      const db = new DatabaseSync(":memory:");
      db.exec(sql);
      const schema = describeSchema(db);
      db.close();
      return schema;
    };

    it(`${v}: the dump loads, and a fresh database of this code satisfies it`, async () => {
      const head = await freshDb();
      expect(schemaProblems(contract(), describeSchema(head))).toEqual([]);
      head.close();
    });

    // the first version's test upgrades every fixture (about 1 s), the others reuse it
    it(`${v}: every released database, upgraded by this code, satisfies it`, async () => {
      for (const [name, schema] of await upgradedSchemas()) expect(schemaProblems(contract(), schema), name).toEqual([]);
    }, 30_000);

    if (compareVersions(APP_VERSION, v) < 0) {
      it(`${v}: is not released yet, so its dump is exactly the schema of a fresh database`, async () => {
        const head = await freshDb();
        expect(dumpSchema(head, v), `run: UPDATE_CONTRACT=${v} pnpm test apps/server/test/contracts.test.ts`).toBe(sql);
        head.close();
      });
    }
  }

  describe("the check itself", () => {
    const schemaOf = (ddl: string): Schema => {
      const db = new DatabaseSync(":memory:");
      db.exec(ddl);
      const s = describeSchema(db);
      db.close();
      return s;
    };
    const BASE = `
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done'))
      );
      CREATE INDEX idx_notes_user ON notes(user_id, id);
      CREATE INDEX idx_notes_open ON notes(user_id) WHERE status = 'new';`;

    it("accepts what an additive release does", () => {
      const grown = schemaOf(`${BASE}
        ALTER TABLE notes ADD COLUMN colour TEXT;
        ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE tags (id TEXT PRIMARY KEY, note_id TEXT REFERENCES notes(id));
        CREATE INDEX idx_notes_colour ON notes(colour);
        CREATE UNIQUE INDEX idx_tags_one ON tags(note_id);`);
      expect(schemaProblems(schemaOf(BASE), grown)).toEqual([]);
      // a wider CHECK list is fine
      const wider = schemaOf(BASE.replace("('new','done')", "('new','done','later')"));
      expect(schemaProblems(schemaOf(BASE), wider)).toEqual([]);
      // so is a CHECK that is gone: the column then takes every value
      const open = schemaOf(BASE.replace(" CHECK (status IN ('new','done'))", ""));
      expect(schemaProblems(schemaOf(BASE), open)).toEqual([]);
    });

    it("notices what an additive release must not do", () => {
      const base = schemaOf(BASE);
      const cases: [string, string, RegExp][] = [
        ["a dropped table", BASE.replace(/CREATE TABLE notes[\s\S]*?\);\s*CREATE INDEX idx_notes_user[^;]*;\s*CREATE INDEX idx_notes_open[^;]*;/, ""), /table notes is gone/],
        ["a dropped column", BASE.replace("body TEXT,", ""), /column notes\.body is gone/],
        ["a changed type", BASE.replace("body TEXT,", "body INTEGER,"), /notes\.body changed its type/],
        ["a column made NOT NULL", BASE.replace("body TEXT,", "body TEXT NOT NULL,"), /notes\.body became NOT NULL/],
        ["a changed default", BASE.replace("DEFAULT 'new'", "DEFAULT 'open'"), /notes\.status changed its default/],
        ["a narrowed CHECK", BASE.replace("('new','done')", "('new')"), /no longer allows 'done'/],
        ["a CHECK that still limits the column under another first word", BASE.replace("CHECK (status IN ('new','done'))", "CHECK (lower(status) IN ('new'))"), /no longer allows 'done'/],
        ["a dropped index", BASE.replace("CREATE INDEX idx_notes_user ON notes(user_id, id);", ""), /index \(user_id, id\) of notes is gone/],
        ["a changed partial index", BASE.replace("WHERE status = 'new'", "WHERE status = 'done'"), /index \(user_id\) where status = 'new' of notes is gone/],
        ["a changed foreign key", BASE.replace("ON DELETE CASCADE", "ON DELETE SET NULL"), /foreign keys of notes changed/],
        ["a new unique index on old columns", `${BASE}\nCREATE UNIQUE INDEX idx_one_per_user ON notes(user_id);`, /new unique index unique \(user_id\) on notes/],
      ];
      for (const [what, ddl, expected] of cases) {
        expect(schemaProblems(base, schemaOf(ddl)).join("; "), what).toMatch(expected);
      }
      // a column that is NOT NULL without a default only comes with a table rebuild
      const rebuilt = BASE.replace("body TEXT,", "body TEXT,\n        owner TEXT NOT NULL,");
      expect(schemaProblems(base, schemaOf(rebuilt)).join("; ")).toMatch(/new column notes\.owner is NOT NULL without a default/);
    });
  });
});

// ── helper CLI ───────────────────────────────────────────

type Shape = string | Shape[] | { [key: string]: Shape };

function shapeOf(v: unknown): Shape {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shapeOf(x)]));
  return typeof v;
}

/** The actual shape against the contract. Forbidden extra keys also means the same key order: a regular expression reads the line. */
function shapeProblems(expected: Shape, actual: Shape, extraKeys: "forbidden" | "allowed", at = "$"): string[] {
  if (typeof expected === "string" || typeof actual === "string") return expected === actual ? [] : [`${at} is ${JSON.stringify(actual)}, the contract says ${JSON.stringify(expected)}`];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [`${at} is ${Array.isArray(actual) ? "a list" : "not a list"}, the contract says ${Array.isArray(expected) ? "a list" : "not a list"}`];
    return expected.length && actual.length ? shapeProblems(expected[0]!, actual[0]!, extraKeys, `${at}[]`) : [];
  }
  const out: string[] = [];
  const want = Object.keys(expected);
  const got = Object.keys(actual);
  for (const k of want) if (!(k in actual)) out.push(`${at}.${k} is missing`);
  if (extraKeys === "forbidden") {
    for (const k of got) if (!(k in expected)) out.push(`${at}.${k} is not in the contract`);
    if (!out.length && want.join() !== got.join()) out.push(`${at} has its keys in another order: ${got.join(", ")}, the contract says ${want.join(", ")}`);
  }
  for (const k of want) if (k in actual) out.push(...shapeProblems(expected[k]!, actual[k]!, extraKeys, `${at}.${k}`));
  return out;
}

interface CliCase {
  name: string;
  setup: "none" | "queued" | "claimed";
  args: string[];
  stdin?: unknown;
  stdinText?: string;
  keepsStateKeys?: boolean;
  /** What the helper looks for in the raw line (JavaScript syntax). */
  lineRegex: string;
  shape: Shape;
}
interface CliContract {
  contract: string;
  exitCode: number;
  lines: number;
  lineMaxLength?: number;
  extraKeys: "forbidden" | "allowed";
  cases: CliCase[];
}

/** The ops CLI the way the helper runs it: what it prints, split into lines, and its exit code. */
async function runOps(s: Awaited<ReturnType<typeof setupApp>>["s"], args: string[], stdin: string) {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  const code = await runCli(s, ["ops", ...args], { readStdin: async () => stdin });
  vi.restoreAllMocks();
  return { code, lines };
}

/** An app whose helper has reported in, with one doctor request queued or already handed to the helper. */
async function prepare(setup: CliCase["setup"]): Promise<{ s: Awaited<ReturnType<typeof setupApp>>["s"]; id: string }> {
  const { s, admin } = await setupApp();
  if (setup === "none") return { s, id: "" };
  await runOps(s, ["state", "--helper", "2"], "{}"); // the helper passes its version, a number
  const queued = await admin.call("POST", "/api/ops/request", { action: "doctor" });
  expect(queued.status).toBe(200);
  const id = queued.body.request.id as string;
  if (setup === "claimed") expect((await runOps(s, ["poll", "--helper", "2", "--done", ""], "")).code).toBe(0);
  return { s, id };
}

describe("contracts: helper CLI", () => {
  for (const v of versions) {
    for (const file of ["ops-poll.json", "ops-report.json", "ops-state.json"]) {
      const contract = JSON.parse(readFileSync(join(CONTRACTS, v, file), "utf8")) as CliContract;
      for (const c of contract.cases) {
        it(`${v}/${file}: ${c.name}`, async () => {
          const { s, id } = await prepare(c.setup);
          const stdin = c.stdinText ?? (c.stdin === undefined ? "" : JSON.stringify(c.stdin).replaceAll("<id>", id));
          const r = await runOps(s, c.args, stdin);
          expect(r.code).toBe(contract.exitCode);
          expect(r.lines).toHaveLength(contract.lines);
          // the raw line first: the helper reads text, not JSON
          expect(c.lineRegex, "every case names the pattern the helper uses").toBeDefined();
          expect(r.lines[0], `the line does not match ${c.lineRegex}`).toMatch(new RegExp(c.lineRegex));
          if (contract.lineMaxLength) expect(r.lines[0]!.length).toBeLessThanOrEqual(contract.lineMaxLength);
          const actual = shapeOf(JSON.parse(r.lines[0]!));
          expect(shapeProblems(c.shape, actual, contract.extraKeys)).toEqual([]);
          if (c.keepsStateKeys) {
            const sent = JSON.parse(stdin) as Record<string, unknown>;
            const state = (sent.state ?? sent) as Record<string, unknown>;
            expect(Object.keys(normaliseState(state)).sort(), "every key of the old helper's snapshot is still kept").toEqual(Object.keys(state).sort());
          }
        });
      }
    }
  }

  describe("the check itself", () => {
    it("tells shapes apart by key, type, order and nesting", () => {
      const want: Shape = { request: { id: "string", params: {}, secret: "null" } };
      const ok = shapeOf({ request: { id: "op_1", params: {}, secret: null } });
      expect(shapeProblems(want, ok, "forbidden")).toEqual([]);
      expect(shapeProblems(want, shapeOf({ request: { id: 1, params: {}, secret: null } }), "forbidden").join()).toMatch(/\$\.request\.id is "number"/);
      expect(shapeProblems(want, shapeOf({ request: { id: "a", params: {}, secret: "x" } }), "forbidden").join()).toMatch(/secret is "string"/);
      expect(shapeProblems(want, shapeOf({ request: null }), "forbidden").join()).toMatch(/\$\.request is "null"/);
      expect(shapeProblems(want, shapeOf({ request: { id: "a", params: {}, secret: null, extra: 1 } }), "forbidden").join()).toMatch(/extra is not in the contract/);
      expect(shapeProblems(want, shapeOf({ request: { secret: null, id: "a", params: {} } }), "forbidden").join()).toMatch(/another order/);
      // with extra keys allowed an added key and another order pass, a missing key still does not
      expect(shapeProblems(want, shapeOf({ request: { secret: null, id: "a", params: {}, extra: 1 } }), "allowed")).toEqual([]);
      expect(shapeProblems(want, shapeOf({ request: { id: "a", params: {} } }), "allowed").join()).toMatch(/secret is missing/);
      expect(shapeProblems(["string"], shapeOf(["a", "b"]), "forbidden")).toEqual([]);
      expect(shapeProblems(["string"], shapeOf([1]), "forbidden")).toHaveLength(1);
    });

    it("the poll patterns match the helper's own answers and nothing looser", () => {
      const poll = JSON.parse(readFileSync(join(CONTRACTS, "0.6.0", "ops-poll.json"), "utf8")) as CliContract;
      const [idle, queued] = poll.cases.map((c) => new RegExp(c.lineRegex));
      expect(idle!.test('{"request":null}')).toBe(true);
      expect(idle!.test('{"request": null}')).toBe(false);
      const line = (extra = "", id = "op_0123456789abcdef") => `{"request":{"id":"${id}","action":"doctor","params":{},"secret":null${extra}}}`;
      expect(queued!.test(line())).toBe(true);
      expect(queued!.test(line(',"note":"x"'))).toBe(false);
      expect(queued!.test(line("", "op_0123456789ABCDEF"))).toBe(false);
      expect(queued!.test(line().replace('"params":{},"secret":null', '"secret":null,"params":{}'))).toBe(false);
      expect(queued!.test(line().replace(",", ", "))).toBe(false);
    });
  });
});
