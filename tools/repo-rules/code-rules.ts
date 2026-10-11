/**
 * Rules 1, 2, 3 and 5 of the repo rules: what core may use, where SQL lives, that every query on a user's data
 * names the user, and who writes security events. Each is an invariant from CLAUDE.md that no compiler checks.
 */
import { builtinModules } from "node:module";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, importsOf, lineIn, lineOf, literals, MIGHT_HOLD_SQL, parse, plainString, readText, repoFiles, SQL_START, sourceFiles, walk } from "./lib.ts";

const SELF = "tools/repo-rules/code-rules.ts";
const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "")));

describe("repo rules: code", () => {
  it("rule 1: core is pure (no Date.now, new Date(), process, performance, crypto, node: imports or Math.random in packages/core/src)", () => {
    // globals that read the clock, the host or entropy; each is named in the finding
    const HOST: Record<string, string> = {
      process: "reads the host process: pass the value in from the server",
      performance: "reads the clock: take the time as an argument",
      crypto: "is host entropy and not repeatable: pass the value in",
    };
    const found: Finding[] = [];
    const files = sourceFiles("packages/core/src/");
    expect(files.length, "the scan found core").toBeGreaterThan(25);
    for (const file of files) {
      const sf = parse(file);
      const add = (node: ts.Node, why: string) => found.push({ file, line: lineOf(sf, node), why });
      for (const imp of importsOf(file)) {
        const bare = imp.spec.replace(/^node:/, "");
        if (imp.spec.startsWith("node:") || NODE_BUILTINS.has(bare)) add(imp.node, `imports ${imp.spec}: core must run in the browser too`);
      }
      // An identifier is a use of the global when it is not a name: not a property, not a declaration, not in a
      // type, and not a name the file declares itself (a local `process` function is its own thing).
      const names = new Set<ts.Node>();
      const declared = new Set<string>();
      const uses: ts.Identifier[] = [];
      walk(sf, (n) => {
        if (ts.isTypeNode(n)) return false;
        if (ts.isPropertyAccessExpression(n) || ts.isPropertyAssignment(n) || ts.isPropertySignature(n) || ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isEnumMember(n)) {
          names.add(n.name);
        }
        if (ts.isImportSpecifier(n) || ts.isBindingElement(n)) {
          if (n.propertyName) names.add(n.propertyName);
        }
        if (
          (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isImportSpecifier(n) || ts.isBindingElement(n) || ts.isNamespaceImport(n) || ts.isImportClause(n) || ts.isClassDeclaration(n)) &&
          n.name &&
          ts.isIdentifier(n.name)
        ) {
          declared.add(n.name.text);
          names.add(n.name);
        }
        if (ts.isIdentifier(n) && Object.hasOwn(HOST, n.text) && !names.has(n)) uses.push(n);
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
          const name = `${n.expression.text}.${n.name.text}`;
          if (name === "Date.now") add(n, "Date.now() reads the clock: take the time as an argument");
          else if (name === "Math.random") add(n, "Math.random() is not repeatable: pass a seed or the value in");
          else if (n.expression.text === "globalThis" && (n.name.text === "Date" || Object.hasOwn(HOST, n.name.text))) add(n, `globalThis.${n.name.text} reaches the host or the clock: take it as an argument`);
        }
        if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && (n.arguments?.length ?? 0) === 0) {
          add(n, "new Date() without an argument reads the clock: take the time as an argument");
        }
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date") add(n, "Date() reads the clock");
      });
      for (const id of uses) if (!declared.has(id.text)) add(id, `${id.text} ${HOST[id.text]}`);
    }
    expectNoFindings("core is pure", found, "packages/core/src is shared with the browser and tested without mocks, so it takes the time, randomness and settings as arguments. Move the call to apps/server and pass the value in.");
  });

  it("rule 2: SQL only in apps/server/src/db/ (allowlist: services/health.ts, services/secret-rotation.ts)", () => {
    const ALLOWED = new Set(["apps/server/src/services/health.ts", "apps/server/src/services/secret-rotation.ts"]);
    const found: Finding[] = [];
    const files = sourceFiles("apps/server/src/").filter((f) => !f.startsWith("apps/server/src/db/"));
    expect(files.length).toBeGreaterThan(40);
    const used = new Set<string>();
    for (const file of files) {
      // most files hold no SQL, so they are not parsed
      if (!MIGHT_HOLD_SQL.test(readText(file))) continue;
      const sf = parse(file);
      const here: Finding[] = [];
      for (const lit of literals(file)) if (SQL_START.test(lit.text)) here.push({ file, line: lit.line, why: `SQL statement: ${lit.text.trim().replace(/\s+/g, " ").slice(0, 60)}` });
      walk(sf, (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "prepare") here.push({ file, line: lineOf(sf, n), why: ".prepare() is a direct database call" });
      });
      if (here.length && ALLOWED.has(file)) used.add(file);
      else found.push(...here);
    }
    // an allowlist entry that no longer needs to be there is removed, so the list only shrinks
    for (const file of ALLOWED) if (!used.has(file)) found.push({ file: SELF, line: lineIn(SELF, file), why: `${file} is on the SQL allowlist but has no SQL any more: remove it from ALLOWED` });
    expectNoFindings("SQL outside db/", found, "put the statement in a method of a db/*-repo.ts class (all SQL lives in apps/server/src/db/) and call that method from the service.");
  });

  it("rule 3: every statement in db/finance-repo.ts and db/finance/ on a user table is bound to user_id", () => {
    // the facade and every module under db/finance/ (a new module is covered the day it is added)
    const repoFilesList = repoFiles().filter((f) => f === "apps/server/src/db/finance-repo.ts" || /^apps\/server\/src\/db\/finance\/.+\.ts$/.test(f));
    expect(repoFilesList.length, "the scan found the facade and its modules").toBeGreaterThan(7);
    const userTables = userTablesFromMigrations();
    for (const t of ["accounts", "connections", "transactions", "category_rules", "sync_runs"]) expect(userTables, `migrations declare ${t} with a user_id column`).toContain(t);

    const found: Finding[] = [];
    let checked = 0;
    let viaFilterSide = 0;
    const filterSides: ts.MethodDeclaration[] = [];
    const filterSideFiles: string[] = [];
    for (const file of repoFilesList) {
      walk(parse(file), (n) => {
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "filterSide") {
          filterSides.push(n);
          filterSideFiles.push(file);
        }
      });
      for (const lit of literals(file)) {
        // a statement that starts with WITH (a CTE) is read like a SELECT
        const first = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.exec(lit.text)?.[1]?.toUpperCase();
        const verb = first === "WITH" ? "SELECT" : first;
        if (!verb || !SQL_START.test(lit.text)) continue;
        const tables = [...lit.text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:OR\s+\w+\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase());
        const mine = tables.filter((t) => userTables.has(t));
        if (mine.length === 0) continue;
        checked++;
        // an insert stores the column; a read, update or delete compares it with a bound parameter (a JOIN ... ON
        // a.user_id = b.user_id does not limit the rows to one user)
        const bound = verb === "INSERT" ? /\buser_id\b/i.test(lit.text) : /\buser_id\s*(=|!=|<>)\s*\?|\buser_id\s+IN\s*\(/i.test(lit.text);
        if (bound) continue;
        // the WHERE parts that filterSide() builds: it always starts with user_id (checked below)
        if (lit.exprs.some((e) => e.replace(/\s+/g, "") === 'side.where.join(" AND ")'.replace(/\s+/g, ""))) {
          viaFilterSide++;
          continue;
        }
        found.push({ file, line: lit.line, why: `${verb} on ${[...new Set(mine)].join(", ")} has no user_id condition` });
      }
    }
    expect(checked, "the scan found the statements").toBeGreaterThan(30);
    if (viaFilterSide > 0) {
      // the condition each side starts with, read from the literals inside filterSide()
      const starts: string[] = [];
      for (const m of filterSides) walk(m, (n) => void (plainString(n) !== undefined ? starts.push(plainString(n)!) : ts.isTemplateExpression(n) ? starts.push(n.head.text) : undefined));
      const ok = filterSides.length === 1 && starts.some((p) => p.startsWith("user_id = ?")) && starts.some((p) => p.startsWith("user_id != ?"));
      if (!ok) {
        found.push({ file: filterSideFiles[0] ?? repoFilesList[0]!, line: 1, why: "statements are built from filterSide(), but there is not exactly one filterSide() that adds `user_id = ?` for the user's rows and `user_id != ?` for shared accounts" });
      }
    }
    expectNoFindings("user_id on every FinanceRepo statement", found, "add `AND user_id = ?` with this.ctx.userId (or store this.ctx.userId on insert). FinanceRepo and its modules are the isolation boundary: a query without it can read or change another member's rows.");
  });

  it("rule 5: INSERT INTO security_events only in db/security-repo.ts (everything else calls recordEvent)", () => {
    const ONLY = "apps/server/src/db/security-repo.ts";
    const INSERT = /INSERT\s+(OR\s+\w+\s+)?INTO\s+security_events\b/i;
    const found: Finding[] = [];
    // tests and frozen database dumps are not production paths; .claude/ holds planning notes
    const candidates = repoFiles().filter((f) => /\.(tsx?|mjs|js|sh)$/.test(f) && !/(^|\/)(test|fixtures)\//.test(f) && !/\.test\.(tsx?|sh)$/.test(f) && !f.startsWith(".claude/") && !f.startsWith("tools/repo-rules/"));
    expect(candidates.length).toBeGreaterThan(100);
    let writers = 0;
    for (const file of candidates) {
      if (!INSERT.test(readText(file))) continue;
      if (/\.tsx?$/.test(file)) {
        for (const lit of literals(file)) {
          if (!INSERT.test(lit.text)) continue;
          if (file === ONLY) writers++;
          else found.push({ file, line: lit.line, why: "writes to security_events directly" });
        }
      } else {
        readText(file)
          .split("\n")
          .forEach((text, i) => INSERT.test(text) && found.push({ file, line: i + 1, why: "writes to security_events directly" }));
      }
    }
    expect(writers, `${ONLY} still holds the insert`).toBeGreaterThan(0);
    expectNoFindings("security events", found, "call recordEvent() from services/security.ts. Security events go through one writer so they carry IP, user agent and the 90 day pruning.");
  });

  it("rule 17: a series' charges a year come from recurring.ts only (no `365.25 /` in another source file)", () => {
    const OWNER = "packages/core/src/recurring.ts";
    const PER_YEAR = /365\.25\s*\//;
    const files = sourceFiles("packages/core/src/", "apps/server/src/", "apps/web/src/");
    expect(files.length).toBeGreaterThan(100);
    expect(PER_YEAR.test(readText(OWNER)), `${OWNER} still holds the cadence table`).toBe(true);
    const found: Finding[] = [];
    for (const file of files) {
      if (file === OWNER || !PER_YEAR.test(readText(file))) continue;
      readText(file)
        .split("\n")
        .forEach((text, i) => PER_YEAR.test(text) && found.push({ file, line: i + 1, why: "counts charges a year from the interval: a second per-year rule beside the series' own" }));
    }
    expectNoFindings("one owner per figure", found, "cost a series with its own `perMonth`, `monthlyCents` or `yearlyCents`. recurring.ts counts the charges it saw (11 for day care that is free in July), so a cost from the interval reads an unchanged contract as dearer (ADR 0004).");
  });
});

describe("repo rules: one owner for dates and windows (ADR 0005)", () => {
  it("rule 18: no local month length (`30.44`) or month-end string outside dates.ts and recurring.ts", () => {
    const OWNERS = new Set(["packages/core/src/dates.ts", "packages/core/src/recurring.ts"]);
    const BANNED: [RegExp, string][] = [
      [/30\.44/, "a local month length: use DAYS_PER_MONTH from dates.ts"],
      [/daysInMonth\([^)]*\)\)?\.padStart|String\(daysInMonth\(|daysInMonth\([^)]*\)\)\)\.padStart|-\$\{daysInMonth\(/, "a month end built by hand: use monthEnd or dateIn from dates.ts"],
    ];
    const found: Finding[] = [];
    for (const file of sourceFiles("packages/core/src/", "apps/server/src/", "apps/web/src/")) {
      if (OWNERS.has(file)) continue;
      readText(file)
        .split("\n")
        .forEach((text, i) => {
          for (const [re, why] of BANNED) if (re.test(text)) found.push({ file, line: i + 1, why });
        });
    }
    expectNoFindings("one owner for dates", found, "dates.ts owns month arithmetic: monthEnd, dateIn, addMonthsToDate, DAYS_PER_MONTH (ADR 0005).");
  });

  it("rule 19: `historyCovers(` only in usual.ts and context.ts, or on the shrinking baseline", () => {
    const OWNERS = new Set(["packages/core/src/analysis/usual.ts", "packages/core/src/analysis/context.ts"]);
    // today's other callers and how many calls each; a count may only go down
    const BASELINE: Record<string, number> = {
      "packages/core/src/analysis/alerts.ts": 2,
      "packages/core/src/analysis/dashboard.ts": 1,
      "packages/core/src/analysis/income-changes.ts": 1,
      "packages/core/src/analysis/income-events.ts": 3,
      "packages/core/src/analysis/insights/commitments.ts": 1,
      "packages/core/src/analysis/insights/subscriptions.ts": 1,
      "packages/core/src/optimise/common.ts": 1,
      "packages/core/src/reports/categories.ts": 1,
      "packages/core/src/reports/drift.ts": 4,
      "packages/core/src/reports/summary.ts": 1,
    };
    const SELF = "tools/repo-rules/code-rules.ts";
    const found: Finding[] = [];
    const seen = new Map<string, number>();
    for (const file of sourceFiles("packages/core/src/", "apps/server/src/", "apps/web/src/")) {
      if (OWNERS.has(file)) continue;
      const n = (readText(file).match(/historyCovers\(/g) ?? []).length;
      if (n) seen.set(file, n);
      if (n > (BASELINE[file] ?? 0)) found.push({ file, line: lineIn(file, "historyCovers("), why: `${n} calls, baseline ${BASELINE[file] ?? 0}: build a usual base with completeMonthsBefore` });
    }
    for (const [file, n] of Object.entries(BASELINE)) if ((seen.get(file) ?? 0) < n) found.push({ file: SELF, line: lineIn(SELF, `"${file}"`), why: `${file} has ${seen.get(file) ?? 0} calls now: lower its baseline to that` });
    expectNoFindings("usual windows", found, "a usual base is complete months (completeMonthsBefore in analysis/usual.ts, ADR 0005).");
  });
});

describe("repo rules: request bodies and marks", () => {
  it("rule 14: every request body in apps/server/src/routes is read inside strictObject() or a parse*() call, never with c.req.json() or parseBody()", () => {
    // Services that check the body they are handed with strictObject themselves. An entry no call uses any more fails.
    const DELEGATES = new Map<string, string>([
      ["apps/server/src/routes/admin.ts s.instance.save", "services/instance.ts checks every field against FIELDS"],
      ["apps/server/src/routes/admin.ts s.instance.setFeatures", "services/instance.ts checks the flags against FEATURE_IDS"],
      ["apps/server/src/routes/admin.ts activateBankApp", "app-setup.ts checks appId and privateKeyPem"],
      ["apps/server/src/routes/admin.ts checkAppId", "app-setup.ts checks appId and privateKeyPem"],
      ["apps/server/src/routes/ops.ts requestOp", "services/ops-validate.ts checks the action against the allowlist"],
    ]);
    const found: Finding[] = [];
    const used = new Set<string>();
    let reads = 0;
    for (const file of sourceFiles("apps/server/src/routes/")) {
      const sf = parse(file);
      const isBody = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "body";
      const covered = new Set<ts.Node>();
      // the calls that take the body as an argument and check it
      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return;
        const callee = n.expression.getText(sf);
        const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
        const delegate = `${file} ${callee}`;
        if (name !== "strictObject" && !name.startsWith("parse") && !DELEGATES.has(delegate)) return;
        for (const a of n.arguments) {
          const inner = ts.isAwaitExpression(a) ? a.expression : a;
          if (!isBody(inner)) continue;
          covered.add(inner);
          if (DELEGATES.has(delegate)) used.add(delegate);
        }
      });
      walk(sf, (n) => {
        // the raw readers: only body() in routes/shared.ts may call them, so every read goes through its JSON check
        if (ts.isFunctionDeclaration(n) && n.name?.text === "body" && file === "apps/server/src/routes/shared.ts") return false;
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["json", "parseBody", "text", "arrayBuffer", "formData", "blob"].includes(n.expression.name.text)) {
          const target = n.expression.expression;
          if (ts.isPropertyAccessExpression(target) && target.name.text === "req") found.push({ file, line: lineOf(sf, n), why: `c.req.${n.expression.name.text}() reads the body around body(): use strictObject(await body(c), [...])` });
        }
        if (!isBody(n)) return;
        reads++;
        if (!covered.has(n)) found.push({ file, line: lineOf(sf, n), why: "request body read outside strictObject() or a parse*() call" });
      });
    }
    expect(reads, "the scan found the request bodies").toBeGreaterThan(15);
    for (const key of DELEGATES.keys()) if (!used.has(key)) found.push({ file: SELF, line: lineIn(SELF, key), why: `${key} no longer takes a request body: remove it from DELEGATES` });
    expectNoFindings("request bodies", found, "wrap the body: strictObject(await body(c), [...keys]) or a parse*(await body(c)) function in platform/validate.ts or the route (CLAUDE.md: browser input is validated against allowlists).");
  });

  it("rule 15: the web app does not parse mark subjects or filter on a next date (core's cancelledMerchants and expectedCharges own them)", () => {
    const found: Finding[] = [];
    for (const file of sourceFiles("apps/web/src/")) {
      const sf = parse(file);
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "startsWith") return;
        const arg = n.arguments[0] && plainString(n.arguments[0]);
        if (arg !== undefined && /^(merchant|alert):/.test(arg)) found.push({ file, line: lineOf(sf, n), why: `parses the mark subject "${arg}"` });
      });
      // a filter on a series' next date picks the coming charges by hand: one date per series, unlike the forecast
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "filter") return;
        for (const arg of n.arguments) {
          walk(arg, (m) => {
            if (ts.isPropertyAccessExpression(m) && m.name.text === "nextDate") found.push({ file, line: lineOf(sf, m), why: "filters on .nextDate: the coming charges come from expectedCharges() (coming.ts)" });
          });
        }
      });
    }
    expectNoFindings("mark subjects and next dates in web", found, "call cancelledMerchants() or expectedCharges() from @banking/core, or look the mark up by its whole subject.");
  });
});

/** Tables whose CREATE TABLE in a migration has a `user_id` column: the rows that belong to one member. */
function userTablesFromMigrations(): Set<string> {
  const tables = new Set<string>();
  for (const file of repoFiles().filter((f) => /^apps\/server\/migrations\/.+\.sql$/.test(f))) {
    const sql = readText(file);
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      while (i < sql.length && depth > 0) {
        const c = sql[i++];
        if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      if (/\buser_id\b/i.test(sql.slice(start, i))) tables.add(m[1]!.toLowerCase());
    }
  }
  return tables;
}
