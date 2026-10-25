/**
 * Rule 24: an export of core or the server has a reader in another source file. A test is no reader, and neither is a
 * line that only passes the name on (`export { x } from`, `export * from`, the index files): code that nothing runs
 * but a test is code to delete, as `merchantStats` and `splitLoanPayment` were. Names are matched by their spelling,
 * with no type information, so the rule can miss an unread export whose name another file also uses; it never refuses
 * one that is read. The unread exports of today are in unread-exports.txt (`file  name`, one per line), a list that
 * only shrinks: an entry that is read, or gone, fails too. A folder the public tree leaves out keeps its entries in an
 * unread-exports.txt of its own, so the public list names none of its files.
 */
import ts from "typescript";
import { isTestFile, lineOf } from "./lib.ts";

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
 * A test file is no reader, and a file in a private folder (left out of the public tree, extensions.ts) reads only for
 * another private file: the public tree must hold up without it. `sf` gives the parsed text of a file.
 */
const isPrivate = (file: string) => file.includes("/private/");

export function unreadExports(files: readonly string[], sf: (file: string) => ts.SourceFile, owners = OWNERS, readers = READERS): { key: string; file: string; line: number }[] {
  const under = (prefixes: readonly string[]) => files.filter((f) => !isTestFile(f) && prefixes.some((p) => f.startsWith(p)));
  // Index each name once instead of copying and searching all source files for every export. A null entry
  // means more than one file reads it, so at least one reader is outside any given owner.
  const allRead = new Map<string, string | null>();
  const publicRead = new Map<string, string | null>();
  const index = (map: Map<string, string | null>, name: string, file: string) => map.set(name, map.has(name) && map.get(name) !== file ? null : file);
  for (const file of under(readers)) {
    for (const name of namesRead(sf(file))) {
      index(allRead, name, file);
      if (!isPrivate(file)) index(publicRead, name, file);
    }
  }
  const out: { key: string; file: string; line: number }[] = [];
  for (const file of under(owners)) {
    const seen = new Set<string>();
    for (const { name, line } of ownExports(sf(file))) {
      if (seen.has(name) || exempt(file, name)) continue;
      seen.add(name);
      const read = isPrivate(file) ? allRead : publicRead;
      if (!read.has(name) || read.get(name) === file) out.push({ key: `${file}  ${name}`, file, line });
    }
  }
  return out;
}

/**
 * Exports that are read where no source reader looks: `module` by the generated line of its registry (a re-export
 * passes a name on and reads nothing), `cases` by the test of its module, and the contract by the modules to come.
 */
const FEATURES = /^packages\/core\/src\/features\//;
const exempt = (file: string, name: string) =>
  file === "packages/core/src/features/contract.ts" || (FEATURES.test(file) && ((name === "module" && /\/[^/]+\/[^/]+\/index\.ts$/.test(file)) || (name === "cases" && file.endsWith("/fixture.ts"))));
