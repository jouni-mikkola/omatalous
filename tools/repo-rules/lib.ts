/**
 * Shared helpers of the repo rules (see repo-rules.test.ts). They read the working tree, never write it,
 * and parse TypeScript with the compiler API that is already a devDependency, so a comment or a string that only
 * mentions `Date.now` is not mistaken for a call.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** A place in the tree and what is wrong there. */
export interface Finding {
  file: string;
  line: number;
  why: string;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "data", "coverage", "backups", "test-results", "playwright-report", ".claude/worktrees"]);

function walkTree(root: string, dir: string, out: string[]): void {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(rel)) continue;
    if (e.isDirectory()) walkTree(root, rel, out);
    else out.push(rel);
  }
}

let files: string[] | undefined;

/**
 * The files of the repo at `root`: the tracked ones and the untracked ones that are not ignored (`git ls-files
 * --cached --others --exclude-standard`), so a new file meets the rules before its commit. Regular files only (no
 * symlink, folder or submodule), as paths from the root with forward slashes. Without a .git folder (a source
 * tarball) the folder is walked instead. When git is there and fails, the test fails with git's message: a rule that
 * silently saw no files would pass for the wrong reason.
 */
export function listFiles(root: string): string[] {
  let list: string[];
  if (existsSync(resolve(root, ".git"))) {
    try {
      list = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
    } catch (err) {
      const e = err as { stderr?: Buffer; message: string };
      throw new Error(`git ls-files failed in ${root}: ${e.stderr?.toString("utf8").trim() || e.message}`);
    }
  } else {
    list = [];
    walkTree(root, "", list);
  }
  // a file that is deleted in the working tree is still listed until the deletion is staged
  return [...new Set(list)]
    .filter((f) => {
      try {
        return lstatSync(resolve(root, f)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/** The files of this repo (`listFiles`), read once. */
export function repoFiles(): string[] {
  return (files ??= listFiles(ROOT));
}

const TEXT = new Map<string, string>();

export function readText(rel: string): string {
  let t = TEXT.get(rel);
  if (t === undefined) {
    t = readFileSync(resolve(ROOT, rel), "utf8");
    TEXT.set(rel, t);
  }
  return t;
}

export const isTestFile = (f: string) => /(^|\/)(test|fixtures)\//.test(f) || /\.(test|spec)\.tsx?$/.test(f);

/** Non-test TypeScript files whose path starts with one of the prefixes. */
export function sourceFiles(...prefixes: string[]): string[] {
  return repoFiles().filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !isTestFile(f) && prefixes.some((p) => f.startsWith(p)));
}

const TREES = new Map<string, ts.SourceFile>();

export function parse(rel: string): ts.SourceFile {
  let sf = TREES.get(rel);
  if (!sf) {
    // no parent pointers: a visitor passes what it needs down, and parsing is about 40 percent faster
    sf = ts.createSourceFile(rel, readText(rel), ts.ScriptTarget.ES2022, false, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    TREES.set(rel, sf);
  }
  return sf;
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Visits every node below `root`, `root` included. Return false from `visit` to skip a node's children. */
export function walk(root: ts.Node, visit: (node: ts.Node) => boolean | void): void {
  const go = (n: ts.Node) => {
    if (visit(n) === false) return;
    ts.forEachChild(n, go);
  };
  go(root);
}

export interface ImportRef {
  spec: string;
  line: number;
  /** `import type`, `export type` or `import { type X }` for every name: erased at build time. */
  typeOnly: boolean;
  node: ts.Node;
}

/** Module specifiers a file loads: import and export declarations, `import()` calls, `import x = require()`. */
export function importsOf(rel: string): ImportRef[] {
  const sf = parse(rel);
  const out: ImportRef[] = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const named = c?.namedBindings;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, line: lineOf(sf, n), typeOnly, node: n });
      return false;
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, line: lineOf(sf, n), typeOnly: n.isTypeOnly, node: n });
      return false;
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push({ spec: n.arguments[0].text, line: lineOf(sf, n), typeOnly: false, node: n });
    }
    if (ts.isExternalModuleReference(n) && ts.isStringLiteral(n.expression)) out.push({ spec: n.expression.text, line: lineOf(sf, n), typeOnly: false, node: n });
  });
  return out;
}

/**
 * The module specifiers of a file, found by the compiler's token scanner without building a syntax tree: about five
 * times faster than `importsOf`, which the boundary rule needs for 170 files. Use `importsOf` when the line or the
 * type-only flag matters.
 */
export function specifiersOf(rel: string): string[] {
  return ts.preProcessFile(readText(rel), true, true).importedFiles.map((i) => i.fileName);
}

/** The text of a string literal or a template without substitutions, else undefined. */
export function plainString(n: ts.Node): string | undefined {
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : undefined;
}

/**
 * Every string-like literal in a file, with a template reduced to its literal parts: `${...}` becomes `\u0000`, and
 * the source of each substitution is kept in `exprs`. Nested templates are visited on their own.
 */
export interface Literal {
  text: string;
  exprs: string[];
  node: ts.Node;
  line: number;
}

export function literals(rel: string): Literal[] {
  const sf = parse(rel);
  const out: Literal[] = [];
  walk(sf, (n) => {
    const s = plainString(n);
    if (s !== undefined) out.push({ text: s, exprs: [], node: n, line: lineOf(sf, n) });
    else if (ts.isTemplateExpression(n)) {
      out.push({
        text: n.head.text + n.templateSpans.map((sp) => `\u0000${sp.literal.text}`).join(""),
        exprs: n.templateSpans.map((sp) => sp.expression.getText(sf)),
        node: n,
        line: lineOf(sf, n),
      });
    }
  });
  return out;
}

/**
 * The start of a statement the app sends through `Db`. A SELECT needs its FROM (or a number or a function call
 * after it), so prose such as "Select a file" is not taken for SQL. Transaction words are left out on purpose:
 * "rollback" is an ops action and "BEGIN RSA PRIVATE KEY" a PEM header, and `Db.batch` wraps statements itself.
 */
const SQL_FORMS = [
  /SELECT\s[\s\S]{0,2000}?\bFROM\s+\S/,
  /SELECT\s+(\d|[\w.]+\()/,
  /INSERT\s+(OR\s+\w+\s+)?INTO\s/,
  /UPDATE\s+(OR\s+\w+\s+)?\w+\s+SET\s/,
  /WITH\s+(RECURSIVE\s+)?\w+\s*(\([^)]*\)\s*)?AS\s*\(/,
  /DELETE\s+FROM\s/,
  /REPLACE\s+INTO\s/,
  /CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s/,
  /ALTER\s+TABLE\s/,
  /DROP\s+(TABLE|INDEX|VIEW|TRIGGER)\s/,
  /PRAGMA\s+\w/,
  /VACUUM(\s+INTO\b|\s*;?\s*$)/,
];
export const SQL_START = new RegExp(`^\\s*(?:${SQL_FORMS.map((r) => r.source).join("|")})`, "i");

/** True when the raw text might hold SQL (comments included): a cheap test that lets a rule skip parsing a file. */
export const MIGHT_HOLD_SQL = new RegExp(`${SQL_FORMS.map((r) => r.source).join("|")}|\\.prepare\\(`, "i");

/** Throws one error that lists every finding as `file:line  why`, then how to fix the class of problem. */
export function expectNoFindings(rule: string, found: readonly Finding[], fix: string): void {
  if (found.length === 0) return;
  const shown = found.slice(0, 40).map((f) => `  ${f.file}:${f.line}  ${f.why}`);
  if (found.length > shown.length) shown.push(`  ... and ${found.length - shown.length} more`);
  throw new Error(`${rule}: ${found.length} problem${found.length === 1 ? "" : "s"}\n${shown.join("\n")}\nTo fix: ${fix}`);
}

/** The 1-based line of the first line of `file` that contains `needle` (1 when none does): points a failure at a list entry. */
export function lineIn(file: string, needle: string): number {
  const i = readText(file).split("\n").findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
}

/** Lines of a file the way `wc -l` counts them. */
export function lineCount(rel: string): number {
  const t = readText(rel);
  if (t === "") return 0;
  return t.split("\n").length - (t.endsWith("\n") ? 1 : 0);
}
