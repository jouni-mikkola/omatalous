/**
 * Rules 37, 38 (ADR 0020) and 39 (ADR 0021). 37: the figure registry (`packages/core/src/figures.ts`) gives one name to one figure, and
 * each figure's source function and field exist in the file it names, so a figure moved or renamed in code fails until
 * the registry follows. 38: the limits of the figures (`const MIN_X = 3`, `const minWeeks = 8`) are in `thresholds.ts` with their reason; a
 * new top-level numeric constant in `analysis/` or `reports/` fails, and the constants that are there today are listed
 * in limits-baseline.txt, a list that only shrinks. 39: a file of `analysis/` or `reports/` takes no median or mean of its
 * own (`median`, `mean` from stats.ts): what a month is expected to be comes from `expected.ts`. The files that take
 * one for something else are in levels-baseline.txt, a list that only shrinks.
 */
import ts from "typescript6";
import { lineOf } from "./lib.ts";

export interface FigureEntry {
  name: string;
  source: { file: string; fn: string; field: string };
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
