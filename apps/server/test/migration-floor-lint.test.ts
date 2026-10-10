/**
 * The compat header is a promise that older builds may keep running on the schema a migration leaves. A wrong promise
 * loses data, so the lint is an allowlist: a migration may carry the header only when every statement in it is one of
 *   CREATE TABLE [IF NOT EXISTS], CREATE INDEX [IF NOT EXISTS] (not unique), ALTER TABLE ... ADD COLUMN (nullable or
 *   with a DEFAULT, not a key).
 * Anything else, however it is spelled, makes the header an error. A migration that is on the list throughout must
 * carry the header (so the floor is a decision, not a default).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compatFloor } from "../src/db/migrate.ts";
import { findMigrationsDir } from "../src/db/open.ts";

/** The first migration the lint covers. 0001 to 0008 are applied on installs and are never edited. */
const FIRST_LINTED = 9;

/** The statements of a migration: comments cut out (each counts as a space), split on `;` outside quotes. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      cur += " ";
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 1;
      cur += " ";
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] !== close) continue;
        // a doubled quote inside a literal or an identifier is one quote character
        if (c !== "[" && sql[j + 1] === close) j++;
        else break;
      }
      cur += sql.slice(i, j + 1);
      i = j;
    } else if (c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const IDENT = String.raw`(?:"[^"]+"|\`[^\`]+\`|\[[^\]]+\]|[\w.]+)`;
const ADD_COLUMN = new RegExp(`^ALTER TABLE ${IDENT} ADD (?:COLUMN )?(.+)$`, "i");

/** Is the statement one that cannot remove, rewrite or constrain what older code reads or writes? */
function isAdditive(statement: string): boolean {
  if (/^CREATE TABLE (IF NOT EXISTS )?\S/i.test(statement)) return true;
  if (/^CREATE INDEX (IF NOT EXISTS )?\S/i.test(statement)) return true;
  // string literals out of the way, so a default of 'NOT NULL' or 'unique' does not count
  const add = ADD_COLUMN.exec(statement.replace(/'(?:[^']|'')*'/g, "''"));
  if (!add) return false;
  const definition = add[1]!;
  if (/\b(PRIMARY KEY|UNIQUE)\b/i.test(definition)) return false;
  return !/\bNOT NULL\b/i.test(definition) || /\bDEFAULT\b/i.test(definition);
}

/** What is wrong with the header of one migration (none: the empty list). */
function floorProblems(sql: string): string[] {
  const out: string[] = [];
  let declared = false;
  try {
    declared = compatFloor({ name: "lint.sql", sql }) !== null;
  } catch (err) {
    declared = true;
    out.push((err as Error).message);
  }
  const breaking = /^--\s*migrate:\s*breaking\s+\S+/m.test(sql);
  const rebuild = /^--\s*migrate:\s*foreign_keys=off\s*$/m.test(sql);
  const all = statements(sql);
  const unsafe = all.filter((s) => !isAdditive(s));
  if (declared) {
    if (breaking) out.push("a breaking migration must not declare a compat floor");
    if (rebuild) out.push("a table rebuild must not declare a compat floor");
    for (const s of unsafe) out.push(`a compat floor needs additive statements only, and this one is not on the list: ${s.slice(0, 70)}`);
  } else if (/^--\s*migrate:\s*compat\b/m.test(sql)) {
    out.push("the compat header is not in the leading comment block, so it is not read");
  } else if (!breaking && !rebuild && all.length && !unsafe.length) {
    out.push('an additive migration needs a "-- migrate: compat <version>" header: the oldest app version that may run on the schema it leaves');
  }
  return out;
}

describe("compat floor lint", () => {
  const dir = findMigrationsDir();

  it("the migrations from 0009 on follow it", () => {
    const linted = readdirSync(dir).filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) >= FIRST_LINTED);
    expect(linted.length).toBeGreaterThan(0);
    for (const f of linted) {
      const problems = floorProblems(readFileSync(join(dir, f), "utf8"));
      expect(problems, `${f}: ${problems.join("; ")}`).toEqual([]);
    }
  });

  const H = "-- migrate: compat 0.6.0\n";

  it("accepts the additive statements, however they are spelled", () => {
    for (const sql of [
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);",
      "create table if not exists notes (id integer);",
      'CREATE TABLE "my notes" (id INTEGER);',
      "CREATE INDEX idx_a ON notes(body);",
      "CREATE INDEX IF NOT EXISTS idx_a ON notes(body) WHERE body IS NOT NULL;",
      "ALTER TABLE accounts ADD COLUMN note TEXT;",
      "ALTER TABLE accounts ADD note TEXT;",
      'ALTER TABLE "accounts" ADD COLUMN "note" TEXT;',
      "ALTER TABLE main.accounts ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE accounts ADD COLUMN owner TEXT REFERENCES users(id);",
      // text inside a literal or a comment is not a statement
      "ALTER TABLE accounts ADD COLUMN note TEXT DEFAULT 'x; DROP TABLE users; -- NOT NULL';",
      "-- DELETE FROM users;\nCREATE TABLE a (id TEXT REFERENCES u(id) ON DELETE CASCADE); /* UPDATE a SET b = 1; */",
    ]) {
      expect(floorProblems(`${H}${sql}`), sql).toEqual([]);
      expect(floorProblems(sql), `${sql} without the header`).toHaveLength(1);
    }
  });

  it("refuses the header on anything else, including the spellings a pattern list would miss", () => {
    for (const sql of [
      "DROP TABLE x;",
      "DROP INDEX idx_a;",
      "DROP VIEW v;",
      "DROP TRIGGER t;",
      "ALTER TABLE a RENAME TO b;",
      "ALTER TABLE a RENAME COLUMN c TO d;",
      "ALTER TABLE a DROP COLUMN b;",
      "DELETE FROM a;",
      'DELETE FROM "a";',
      "UPDATE a SET b = 1;",
      'UPDATE "a" SET b = 1;',
      "UPDATE main.a SET b = 1;",
      "UPDATE OR IGNORE a SET b = 1;",
      "UPDATE OR REPLACE a SET b = 1;",
      "REPLACE INTO a (id) VALUES (1);",
      "INSERT OR REPLACE INTO a (id) VALUES (1);",
      "INSERT INTO a (id) VALUES (1);",
      "CREATE UNIQUE INDEX idx_u ON a(b);",
      "CREATE TRIGGER trg AFTER INSERT ON a BEGIN UPDATE a SET b = 1; END;",
      "CREATE TEMP TABLE t (id INTEGER);",
      "CREATE VIEW v AS SELECT 1;",
      "ALTER TABLE a ADD COLUMN b TEXT NOT NULL;",
      "ALTER TABLE a ADD COLUMN b TEXT PRIMARY KEY;",
      "ALTER TABLE a ADD COLUMN b TEXT UNIQUE;",
      "PRAGMA foreign_keys = OFF;",
      "ANALYZE a;",
      "VACUUM;",
      // hidden behind comments and a harmless first statement
      "/* harmless */ DELETE FROM a;",
      "DELETE/**/FROM a;",
      "CREATE TABLE ok (id INTEGER); /* ; */ DROP TABLE a;",
      "CREATE TABLE ok (id INTEGER);\n-- ALTER TABLE a ADD COLUMN b TEXT;\nDELETE FROM a;",
      "CREATE TABLE ok (id TEXT DEFAULT ';'); DELETE FROM a",
    ]) {
      const problems = floorProblems(`${H}${sql}`);
      expect(problems.length, sql).toBeGreaterThan(0);
      expect(problems.join("; "), sql).toMatch(/not on the list/);
    }
  });

  it("a breaking migration or a table rebuild declares no floor and needs none", () => {
    const risky = "DELETE FROM a;";
    expect(floorProblems(`-- migrate: breaking rows go\n${risky}`)).toEqual([]);
    expect(floorProblems(`-- migrate: breaking rows go\n${H}${risky}`).join("; ")).toMatch(/breaking migration must not declare/);
    expect(floorProblems("-- migrate: foreign_keys=off\n-- migrate: breaking rebuilt\nCREATE TABLE t2 (x INTEGER);")).toEqual([]);
    expect(floorProblems(`-- migrate: foreign_keys=off\n${H}CREATE TABLE t2 (x INTEGER);`).join("; ")).toMatch(/rebuild must not declare/);
  });

  it("a header that is malformed or not in the leading comment block is an error, not silence", () => {
    expect(floorProblems("-- migrate: compat 0.6\nCREATE TABLE a (id INTEGER);").join("; ")).toMatch(/invalid compat header/);
    expect(floorProblems(`CREATE TABLE a (id INTEGER);\n${H}`).join("; ")).toMatch(/not in the leading comment block/);
  });

  it("a migration that changes data has no floor and may say nothing", () => {
    // no header means no floor: every older build refuses the database, which is the safe default
    expect(floorProblems("INSERT INTO settings (key, value, updated_at) VALUES ('a', '1', 'x');")).toEqual([]);
  });

  it("splits statements outside quotes and comments only", () => {
    expect(statements("A; 'x;y'; \"a;b\"; [c;d]; `e;f`; -- g;h\nI /* j;k */ L;")).toEqual(["A", "'x;y'", '"a;b"', "[c;d]", "`e;f`", "I L"]);
    expect(statements("A 'it''s;ok'; B")).toEqual(["A 'it''s;ok'", "B"]);
  });
});
