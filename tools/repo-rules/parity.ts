/**
 * Rules 7, 8 and 11 of the repo rules: lists that must agree and live in different files or languages, and the
 * comment every report carries. Nothing links the lists at build time, so a test reads each list and compares.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, lineOf, parse, plainString, readText, repoFiles, walk } from "./lib.ts";

/** The string items of the first array literal or union of string literals that a declaration `name` holds. */
function stringList(file: string, name: string): { items: string[]; line: number } {
  const sf = parse(file);
  let found: { items: string[]; line: number } | undefined;
  const fromArray = (n: ts.Expression): string[] | undefined => {
    let e = n;
    while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isArrayLiteralExpression(e) ? e.elements.map((x) => plainString(x)).filter((x): x is string => x !== undefined) : undefined;
  };
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      const items = fromArray(n.initializer);
      if (items) found = { items, line: lineOf(sf, n) };
    } else if (ts.isTypeAliasDeclaration(n) && n.name.text === name && ts.isUnionTypeNode(n.type)) {
      const items = n.type.types.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []));
      found = { items, line: lineOf(sf, n) };
    }
  });
  if (!found || found.items.length === 0) throw new Error(`${file}: no list named ${name} found; the parity rule needs updating to where the list moved`);
  return found;
}

describe("repo rules: parity", () => {
  it("rule 7: the ops action list is the same in services/ops-validate.ts, scripts/ops-helper.sh and the web OpsAction type", () => {
    const SERVER = "apps/server/src/services/ops-validate.ts";
    const HELPER = "scripts/ops-helper.sh";
    const WEB = "apps/web/src/components/ops/types.ts";
    const reference = stringList(SERVER, "OPS_ACTIONS");
    expect(reference.items.length).toBeGreaterThan(5);

    const sh = readText(HELPER).split("\n");
    const listAt = sh.findIndex((l) => /^ACTIONS="[^"]*"/.test(l));
    expect(listAt, `${HELPER} has an ACTIONS="..." line`).toBeGreaterThanOrEqual(0);
    const helperList = /^ACTIONS="([^"]*)"/.exec(sh[listAt]!)![1]!.split(/\s+/).filter(Boolean);
    // the dispatch in run_request: `  name) act_name ;;` between `case $action in` and `esac`
    const caseAt = sh.findIndex((l) => /^\s*case \$action in\s*$/.test(l));
    const dispatch: string[] = [];
    for (let i = caseAt + 1; caseAt >= 0 && i < sh.length && !/^\s*esac\b/.test(sh[i]!); i++) {
      const m = /^\s+([a-z][a-z-]*)\)\s+act_/.exec(sh[i]!);
      if (m) dispatch.push(m[1]!);
    }
    expect(caseAt, `${HELPER} has the case $action in dispatch`).toBeGreaterThanOrEqual(0);

    const others: { file: string; line: number; what: string; items: string[] }[] = [
      { file: HELPER, line: listAt + 1, what: "ACTIONS", items: helperList },
      { file: HELPER, line: caseAt + 1, what: "the case $action dispatch", items: dispatch },
      { file: WEB, ...stringList(WEB, "OpsAction"), what: "OpsAction" },
    ];
    const found: Finding[] = [];
    for (const o of others) {
      const missing = reference.items.filter((a) => !o.items.includes(a));
      const extra = o.items.filter((a) => !reference.items.includes(a));
      if (missing.length) found.push({ file: o.file, line: o.line, why: `${o.what} lacks ${missing.map((m) => `"${m}"`).join(", ")} (OPS_ACTIONS in ${SERVER}:${reference.line} has it)` });
      if (extra.length) found.push({ file: o.file, line: o.line, why: `${o.what} has ${extra.map((m) => `"${m}"`).join(", ")}, which OPS_ACTIONS in ${SERVER}:${reference.line} does not` });
    }
    expectNoFindings("ops action list", found, "make the three lists equal. OPS_ACTIONS is the source: add the action there, to ACTIONS and the dispatch in scripts/ops-helper.sh, and to OpsAction in apps/web/src/components/ops/types.ts.");
  });

  it("rule 8: every report in packages/core/src/reports is registered in reports/index.ts and shown by a section of the web page, and every registry key is in docs/ARCHITECTURE.md", () => {
    const DIR = "packages/core/src/reports/";
    const INDEX = `${DIR}index.ts`;
    const DOC = "docs/ARCHITECTURE.md";
    // files of that folder that are not reports
    const NOT_REPORTS = new Set(["index.ts", "shared.ts"]);
    const found: Finding[] = [];

    const sf = parse(INDEX);
    // module file -> the names it brings in as values (a type is not a registered report)
    const valuesFrom = new Map<string, string[]>();
    let registry: ts.ObjectLiteralExpression | undefined;
    let registryLine = 1;
    walk(sf, (n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause && !n.importClause.isTypeOnly) {
        const names: string[] = [];
        const b = n.importClause.namedBindings;
        if (n.importClause.name) names.push(n.importClause.name.text);
        if (b && ts.isNamedImports(b)) for (const e of b.elements) if (!e.isTypeOnly) names.push(e.name.text);
        valuesFrom.set(n.moduleSpecifier.text.replace(/^\.\//, ""), names);
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "REPORTS" && n.initializer) {
        let e = n.initializer;
        while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
        if (ts.isObjectLiteralExpression(e)) {
          registry = e;
          registryLine = lineOf(sf, n);
        }
      }
    });
    if (!registry) throw new Error(`${INDEX}: no REPORTS object literal found; the parity rule needs updating to where the registry moved`);
    const keys: string[] = [];
    const used = new Set<string>();
    for (const p of registry.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) keys.push(p.name.text);
      walk(p, (n) => void (ts.isIdentifier(n) && used.add(n.text)));
    }
    expect(keys.length, "the registry has its keys").toBeGreaterThan(5);

    const reportFiles = repoFiles().filter((f) => f.startsWith(DIR) && /^[^/]+\.ts$/.test(f.slice(DIR.length)) && !NOT_REPORTS.has(f.slice(DIR.length)));
    expect(reportFiles.length).toBeGreaterThan(5);
    for (const file of reportFiles) {
      const names = valuesFrom.get(file.slice(DIR.length)) ?? [];
      if (!names.some((n) => used.has(n))) {
        found.push({ file, line: 1, why: `is not registered: ${INDEX} does not import it into REPORTS (if it is a helper and not a report, add it to NOT_REPORTS in tools/repo-rules/parity.ts)` });
      }
    }

    // Each web section names the core reports it reads (`reports: [...]` in its `section` export), so a report that
    // no section shows fails here instead of going missing from the page.
    const SECTIONS = "apps/web/src/pages/reports/sections/";
    // reports the page may leave out on purpose
    const NO_SECTION = new Set<string>();
    const sectionFiles = repoFiles().filter((f) => f.startsWith(SECTIONS) && /^[^/]+\.tsx$/.test(f.slice(SECTIONS.length)));
    expect(sectionFiles.length, "the web report sections are found").toBeGreaterThan(5);
    const shown = new Set<string>();
    const ids = new Map<string, string>();
    for (const file of sectionFiles) {
      const sec = parse(file);
      let init: ts.ObjectLiteralExpression | undefined;
      walk(sec, (n) => {
        if (ts.isVariableStatement(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const d of n.declarationList.declarations) {
            let e = d.initializer;
            while (e && (ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
            if (ts.isIdentifier(d.name) && d.name.text === "section" && e && ts.isObjectLiteralExpression(e)) init = e;
          }
        }
      });
      if (!init) {
        found.push({ file, line: 1, why: "does not `export const section = { id, title, order, reports, Component }`, so pages/reports/registry.ts cannot show it" });
        continue;
      }
      for (const p of init.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        if (p.name.text === "id") {
          const id = plainString(p.initializer);
          if (id === undefined) continue;
          const other = ids.get(id);
          if (other) found.push({ file, line: lineOf(sec, p), why: `uses the section id "${id}", which ${other} has too` });
          ids.set(id, file);
        }
        if (p.name.text === "reports" && ts.isArrayLiteralExpression(p.initializer)) {
          for (const el of p.initializer.elements) {
            const name = plainString(el);
            if (name === undefined) continue;
            if (!keys.includes(name)) found.push({ file, line: lineOf(sec, el), why: `reads the report "${name}", which ${INDEX}:${registryLine} does not have` });
            shown.add(name);
          }
        }
      }
    }
    for (const key of keys) {
      if (!shown.has(key) && !NO_SECTION.has(key)) {
        found.push({ file: INDEX, line: registryLine, why: `the report "${key}" is read by no section in ${SECTIONS} (add a file there, or list the key in \`reports\` of the section that shows it; a report the page leaves out goes in NO_SECTION in tools/repo-rules/parity.ts)` });
      }
    }

    // A key counts when it is in the bullet that lists the registry ("- Reports are a registry ..."), not anywhere in
    // the document: the word `summary` or `balances` may well appear in another section.
    const lines = readText(DOC).split("\n");
    const start = lines.findIndex((l) => /^- Reports are a registry/i.test(l));
    if (start < 0) {
      found.push({ file: DOC, line: 1, why: 'has no bullet that starts with "Reports are a registry": the parity rule reads the report list from it' });
    } else {
      let end = start + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end]!)) end++;
      const bullet = lines.slice(start, end).join("\n");
      for (const key of keys) {
        if (!bullet.includes(`\`${key}\``)) found.push({ file: DOC, line: start + 1, why: `the registry key \`${key}\` (${INDEX}:${registryLine}) is not in the "Reports are a registry" bullet; add it to its list` });
      }
    }
    expectNoFindings("reports registry", found, "register the report in packages/core/src/reports/index.ts (see its header comment for the other places a report goes), give it a section file in apps/web/src/pages/reports/sections/ and list its key in docs/ARCHITECTURE.md.");
  });

  it("rule 11: every report and every report section says what the household decides with it (a `Decision:` comment)", () => {
    const CORE = "packages/core/src/reports/";
    const SECTIONS = "apps/web/src/pages/reports/sections/";
    // files of the core folder that are not reports
    const NOT_REPORTS = new Set(["index.ts", "shared.ts"]);
    // a comment line (`//`, `/**` or a ` * ` line of a block) that holds `Decision:` and then some words
    const DECISION = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*Decision:[ \t]*\S/m;
    const files = repoFiles().filter((f) => (f.startsWith(CORE) && /^[^/]+\.ts$/.test(f.slice(CORE.length)) && !NOT_REPORTS.has(f.slice(CORE.length))) || (f.startsWith(SECTIONS) && /^[^/]+\.tsx$/.test(f.slice(SECTIONS.length))));
    expect(files.length, "the reports and their sections are found").toBeGreaterThan(10);
    const found: Finding[] = [];
    for (const file of files) {
      if (!DECISION.test(readText(file))) found.push({ file, line: 1, why: "has no `Decision:` comment" });
    }
    expectNoFindings("report decisions", found, "start the file with `// Decision: <what the household decides with this view>`, for example `// Decision: cancel or renegotiate a contract that got dearer`. A view that supports no decision does not belong on the page; one that is going away says `Decision: none, removed in <task>`.");
  });
});
