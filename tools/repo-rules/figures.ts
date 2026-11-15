/**
 * Rules 37, 38 (ADR 0020) and 39 (ADR 0021). 37: the figure registry (`packages/core/src/figures.ts`) gives one name to one figure, and
 * each figure's source function and field exist in the file it names, so a figure moved or renamed in code fails until
 * the registry follows. 38: the limits of the figures (`const MIN_X = 3`, `const minWeeks = 8`) are in `thresholds.ts` with their reason; a
 * new top-level numeric constant in `analysis/` or `reports/` fails, and the constants that are there today are listed
 * in limits-baseline.txt, a list that only shrinks. 39: a file of `analysis/` or `reports/` takes no median or mean of its
 * own (`median`, `mean` from stats.ts): what a month is expected to be comes from `expected.ts`. The files that take
 * one for something else are in levels-baseline.txt, a list that only shrinks.
 *
 * Rule 52 (the one definition of a figure): every entry says its `scope` and whether it is `additive` and names one
 * function, and every figure word of docs/MONEY_FLOWS.md is the name of an entry or is in figure-words-baseline.txt, a
 * list that only shrinks. Rule 53 (part and whole): `paymentCents` and `wholeCents`, the whole of a bank's payment or a
 * row, are read only in the files of part-whole-baseline.txt and at most as often as its count, a list that only shrinks until one typed pair owns both.
 */
import ts from "typescript6";
import { lineOf, walk } from "./lib.ts";

export interface FigureEntry {
  name: string;
  source: { file: string; fn: string; field: string };
  scope?: string;
  additive?: unknown;
}

export interface FigureProblem {
  id: string;
  why: string;
}

/** `read` gives the text of a file under packages/core/src, or null when there is none. */
export function figureProblems(figures: Readonly<Record<string, FigureEntry>>, read: (file: string) => string | null): FigureProblem[] {
  const found: FigureProblem[] = [];
  const names = new Map<string, string>();
  const sources = new Map<string, string>();
  const word = (text: string, w: string) => new RegExp(`(?<![\\w$])${w.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text);
  for (const [id, f] of Object.entries(figures)) {
    const name = f.name.toLowerCase();
    const sameName = names.get(name);
    if (sameName) found.push({ id, why: `the name "${f.name}" is also the name of ${sameName}: one name, one figure, so name the difference` });
    else names.set(name, id);
    const key = `${f.source.file} ${f.source.fn} ${f.source.field}`;
    const sameSource = sources.get(key);
    if (sameSource) found.push({ id, why: `the same source as ${sameSource}: two entries for one figure, keep one` });
    else sources.set(key, id);
    const text = read(f.source.file);
    if (text === null) found.push({ id, why: `source file packages/core/src/${f.source.file} does not exist` });
    else {
      if (!word(text, f.source.fn)) found.push({ id, why: `${f.source.file} has no ${f.source.fn}` });
      if (!word(text, f.source.field)) found.push({ id, why: `${f.source.file} has no ${f.source.field}` });
    }
  }
  return found;
}

const SCOPES = new Set(["own", "household"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The entries that miss a `scope` of own or household, a true or false `additive`, or one function name as `source.fn`. */
export function shapeProblems(figures: Readonly<Record<string, FigureEntry>>): FigureProblem[] {
  const found: FigureProblem[] = [];
  for (const [id, f] of Object.entries(figures)) {
    if (f.scope === undefined || !SCOPES.has(f.scope)) found.push({ id, why: `scope is ${JSON.stringify(f.scope)}: say "own" (told for a member's view) or "household" (told for the household alone)` });
    if (typeof f.additive !== "boolean") found.push({ id, why: "additive is not true or false: say whether the members' own figures add up to the household's" });
    if (!IDENTIFIER.test(f.source.fn)) found.push({ id, why: `source.fn is ${JSON.stringify(f.source.fn)}: name the one function that computes the figure` });
  }
  return found;
}

export interface FigureWord {
  word: string;
  line: number;
}

/**
 * The words in italics of the first column of the first table of docs/MONEY_FLOWS.md (the one headed `| Word |`): the
 * names the pages show for a figure, each with the line it stands on.
 */
export function figureWords(doc: string): FigureWord[] {
  const found: FigureWord[] = [];
  let inTable = false;
  doc.split("\n").forEach((text, i) => {
    if (!inTable) {
      inTable = /^\|\s*Word\s*\|/.test(text);
      return;
    }
    if (!text.startsWith("|")) {
      inTable = false;
      return;
    }
    const first = text.split("|")[1] ?? "";
    for (const m of first.matchAll(/\*([^*]+)\*/g)) found.push({ word: m[1]!.trim(), line: i + 1 });
  });
  return found;
}

export interface WordProblem {
  /** "doc": a word of the table; "baseline": a line of the baseline. */
  where: "doc" | "baseline";
  word: string;
  line: number;
  why: string;
}

/**
 * A word of the table is the name of a registry entry (`names`, in lower case) or is in the baseline. A baseline line
 * that is a registry name now, or is no word of the table any more, is stale: the list only shrinks.
 */
export function wordProblems(words: readonly FigureWord[], names: ReadonlySet<string>, baseline: readonly string[]): WordProblem[] {
  const found: WordProblem[] = [];
  const listed = new Set(baseline.map((w) => w.toLowerCase()));
  const seen = new Set<string>();
  for (const { word, line } of words) {
    const key = word.toLowerCase();
    seen.add(key);
    if (!names.has(key) && !listed.has(key)) found.push({ where: "doc", word, line, why: `*${word}* is no figure of the registry: add it to figures.ts with its source, or write the name of the figure that it is` });
  }
  baseline.forEach((word, i) => {
    const key = word.toLowerCase();
    if (names.has(key)) found.push({ where: "baseline", word, line: i + 1, why: `*${word}* is in the registry now: delete the line` });
    else if (!seen.has(key)) found.push({ where: "baseline", word, line: i + 1, why: `*${word}* is no word of the table any more: delete the line` });
  });
  return found;
}

const PART_WHOLE = new Set(["paymentCents", "wholeCents"]);

/**
 * The reads of `paymentCents` and `wholeCents` of a file: `x.paymentCents`, and the name in a destructuring. Writing a
 * field (`x.wholeCents = n`) and naming it in a type or an object literal is not a read.
 */
export function partWholeReads(sf: ts.SourceFile): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  const written = new Set<ts.Node>();
  walk(sf, (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) written.add(n.left);
    if (ts.isPropertyAccessExpression(n) && PART_WHOLE.has(n.name.text) && !written.has(n)) found.push({ name: n.name.text, line: lineOf(sf, n.name) });
    if (ts.isObjectBindingPattern(n)) {
      for (const el of n.elements) {
        const field = el.propertyName ?? el.name;
        if (ts.isIdentifier(field) && PART_WHOLE.has(field.text)) found.push({ name: field.text, line: lineOf(sf, el) });
      }
    }
  });
  return found;
}

export interface PartWholeProblem {
  /** "source": a read in a file; "baseline": a line of the baseline. */
  where: "source" | "baseline";
  /** `file  name`. */
  key: string;
  line: number;
  why: string;
}

/**
 * The reads of a file are counted by field: a baseline line `file  name  count` allows that many. A read past the count
 * is new, and a count above the reads, or a line with no reads, is stale: the list only shrinks. `reads` is in source
 * order, so the first read past the count is the one named.
 */
export function partWholeProblems(reads: readonly { key: string; line: number }[], baseline: readonly string[]): PartWholeProblem[] {
  const allowed = new Map<string, { count: number; line: number }>();
  baseline.forEach((text, i) => {
    const m = /^(.+?)\s{2}(\d+)$/.exec(text);
    if (m) allowed.set(m[1]!, { count: Number(m[2]), line: i + 1 });
  });
  const found: PartWholeProblem[] = [];
  const count = new Map<string, number>();
  for (const { key, line } of reads) {
    const n = (count.get(key) ?? 0) + 1;
    count.set(key, n);
    const limit = allowed.get(key)?.count ?? 0;
    if (n === limit + 1) {
      const name = key.split("  ")[1];
      const reads = limit === 0 ? `reads ${name}` : `reads ${name} more than the baseline's ${limit}`;
      found.push({ where: "source", key, line, why: `${reads}: the whole beside the viewer's part. A figure of a shared loan or account is the part (monthlyCents, partCents), and the whole only names the loan or the row` });
    }
  }
  baseline.forEach((text, i) => {
    const m = /^(.+?)\s{2}(\d+)$/.exec(text);
    if (!m) {
      found.push({ where: "baseline", key: text, line: i + 1, why: `the line is not "file  field  count": ${text}` });
      return;
    }
    const n = count.get(m[1]!) ?? 0;
    if (n === 0) found.push({ where: "baseline", key: m[1]!, line: i + 1, why: `no longer reads the field, delete the line: ${m[1]}` });
    else if (n < Number(m[2])) found.push({ where: "baseline", key: m[1]!, line: i + 1, why: `reads the field ${n} time${n === 1 ? "" : "s"} now, so lower the count from ${m[2]}: ${m[1]}` });
  });
  return found;
}

const isNumber = (e: ts.Expression): boolean =>
  ts.isNumericLiteral(e) ||
  (ts.isPrefixUnaryExpression(e) && isNumber(e.operand)) ||
  (ts.isParenthesizedExpression(e) && isNumber(e.expression)) ||
  (ts.isBinaryExpression(e) && isNumber(e.left) && isNumber(e.right)) ||
  (ts.isAsExpression(e) && isNumber(e.expression));

/** The top-level `const name = <number>` of a file, whatever the case of the name: a limit written where it is used. */
export function looseLimits(sf: ts.SourceFile): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && isNumber(d.initializer)) found.push({ name: d.name.text, line: lineOf(sf, d) });
    }
  }
  return found;
}

const STATS = /(^|\/)stats\.ts$/;
const LEVEL_NAMES = new Set(["median", "mean"]);

/** The `median` and `mean` a file imports from stats.ts: a level over values that is not the expected figure. */
export function ownLevels(sf: ts.SourceFile): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier) || !STATS.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const name = (el.propertyName ?? el.name).text;
      if (!el.isTypeOnly && LEVEL_NAMES.has(name)) found.push({ name, line: lineOf(sf, el) });
    }
  }
  return found;
}
