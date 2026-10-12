/**
 * Rule 24: an export of core or the server has a reader in another source file. A test is no reader, and neither is a
 * line that only passes the name on (`export { x } from`, `export * from`, the index files): code that nothing runs
 * but a test is code to delete, as `merchantStats` and `splitLoanPayment` were. Names are matched by their spelling,
 * with no type information, so the rule can miss an unread export whose name another file also uses; it never refuses
 * one that is read. The unread exports of today are in unread-exports.txt (`file  name`, one per line), a list that
 * only shrinks: an entry that is read, or gone, fails too.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, isTestFile, lineIn, lineOf, parse, readText, sourceFiles } from "./lib.ts";

const LIST = "tools/repo-rules/unread-exports.txt";

/** Where an export must be read: the sources of the product, and the findings tool that runs core. */
export const READERS = ["packages/core/src/", "apps/server/src/", "apps/web/src/", "tools/findings/"];
/** Where the exports checked are. apps/web/src is not here yet: it has 77 unread names, and the list would take them all. */
export const OWNERS = ["packages/core/src/", "apps/server/src/"];

const DECLARES = (p: ts.Node) =>
  ts.isFunctionDeclaration(p) ||
  ts.isFunctionExpression(p) ||
  ts.isClassDeclaration(p) ||
  ts.isClassExpression(p) ||
  ts.isInterfaceDeclaration(p) ||
  ts.isTypeAliasDeclaration(p) ||
  ts.isEnumDeclaration(p) ||
  ts.isEnumMember(p) ||
  ts.isVariableDeclaration(p) ||
  ts.isParameter(p) ||
  ts.isBindingElement(p) ||
  ts.isPropertyDeclaration(p) ||
  ts.isPropertySignature(p) ||
  ts.isMethodDeclaration(p) ||
  ts.isMethodSignature(p) ||
  ts.isPropertyAssignment(p) ||
  ts.isGetAccessorDeclaration(p) ||
  ts.isSetAccessorDeclaration(p) ||
  ts.isTypeParameterDeclaration(p) ||
  ts.isModuleDeclaration(p);

/**
 * The names a source text reads: every identifier except a declared name, a name in an `export` list and a name in an
 * `import` list (the use of an imported name is found where it is used). `import { a as b }` reads `a`, `b.c` reads `c`.
 */
export function namesRead(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const go = (n: ts.Node, parent: ts.Node | undefined) => {
    if (ts.isIdentifier(n) && parent) {
      const skip =
        ts.isExportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) ||
        ts.isNamespaceExport(parent) ||
        (ts.isImportSpecifier(parent) && parent.propertyName !== n) ||
        (DECLARES(parent) && (parent as { name?: ts.Node }).name === n);
      if (!skip) out.add(n.text);
    }
    ts.forEachChild(n, (c) => go(c, n));
  };
  go(sf, undefined);
  return out;
}

/** The names a file exports under their own declaration: not what it passes on from another module. */
export function ownExports(sf: ts.SourceFile): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const add = (id: ts.Node) => ts.isIdentifier(id) && out.push({ name: id.text, line: lineOf(sf, id) });
  const bindings = (b: ts.BindingName) => (ts.isIdentifier(b) ? add(b) : b.elements.forEach((e) => ts.isBindingElement(e) && bindings(e.name)));
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause)) s.exportClause.elements.forEach((e) => add(e.name));
      continue;
    }
    const mods = ts.canHaveModifiers(s) ? ts.getModifiers(s) : undefined;
    if (!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isVariableStatement(s)) s.declarationList.declarations.forEach((d) => bindings(d.name));
    else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) {
      if (s.name) add(s.name);
    }
  }
  return out;
}

/**
 * The exports of the files under `owners` that no other file under `readers` reads, as `file  name` with the line.
 * A test file is no reader. `sf` gives the parsed text of a file.
 */
export function unreadExports(files: readonly string[], sf: (file: string) => ts.SourceFile, owners = OWNERS, readers = READERS): { key: string; file: string; line: number }[] {
  const under = (prefixes: readonly string[]) => files.filter((f) => !isTestFile(f) && prefixes.some((p) => f.startsWith(p)));
  const read = new Map(under(readers).map((f) => [f, namesRead(sf(f))] as const));
  const out: { key: string; file: string; line: number }[] = [];
  for (const file of under(owners)) {
    const seen = new Set<string>();
    for (const { name, line } of ownExports(sf(file))) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (![...read].some(([other, names]) => other !== file && names.has(name))) out.push({ key: `${file}  ${name}`, file, line });
    }
  }
  return out;
}

const listed = () => readText(LIST).split("\n").filter(Boolean);

describe("repo rules: unread exports (rule 24)", () => {
  const files = () => sourceFiles(...READERS);

  it("rule 24a: an export of core or the server is read by another source file, except the list", () => {
    expect(sourceFiles(...OWNERS).length, "the scan found the sources").toBeGreaterThan(100);
    const known = new Set(listed());
    const found: Finding[] = unreadExports(files(), parse)
      .filter((u) => !known.has(u.key))
      .map((u) => ({ file: u.file, line: u.line, why: `export ${u.key.split("  ")[1]} is read by no other source file (a test does not count)` }));
    expectNoFindings("unread exports", found, `delete the export with its test, or drop \`export\` when only its own file uses it. Do not add it to ${LIST}.`);
  }, 30_000); // parses every source file of core and the server: a loaded machine takes over the five seconds a test gets

  it("rule 24b: every entry of the list is still an unread export, so the list shrinks when one is deleted or read", () => {
    const live = new Set(unreadExports(files(), parse).map((u) => u.key));
    const found: Finding[] = listed()
      .filter((k) => !live.has(k))
      .map((k) => ({ file: LIST, line: lineIn(LIST, k), why: `no longer an unread export, delete the line: ${k}` }));
    expectNoFindings("unread exports list", found, `remove the listed lines from ${LIST}. Good: the export is gone or read.`);
  }, 30_000);
});
