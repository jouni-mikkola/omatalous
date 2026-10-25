/**
 * Rule 13: a test that builds random households (`randomHistory`) carries its own timeout of at least 30 s. Alone such
 * a test takes 1 to 7 s against vitest's 5 s default, and when several workers check at once it takes three times as
 * long. The failure then looks like a false finding while it is a busy machine. A loop over seeds is long on purpose:
 * give the test the time instead of lowering the seeds.
 */
import ts from "typescript";
import { lineOf, walk } from "./lib.ts";

export const MIN_MS = 30_000;

/** `it`, `test`, `it.skip`, `it.each(rows)` and the like: the call that registers a test. */
function isTestCall(callee: ts.Expression): boolean {
  let e: ts.Expression = callee;
  for (;;) {
    if (ts.isIdentifier(e)) return e.text === "it" || e.text === "test";
    if (ts.isPropertyAccessExpression(e)) e = e.expression;
    else if (ts.isCallExpression(e)) e = e.expression;
    else return false;
  }
}

function timeoutOf(args: readonly ts.Expression[]): number | undefined {
  for (const a of args.slice(1)) {
    if (ts.isNumericLiteral(a)) return Number(a.text.replace(/_/g, ""));
    if (ts.isObjectLiteralExpression(a)) {
      for (const p of a.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === "timeout" && ts.isNumericLiteral(p.initializer)) return Number(p.initializer.text.replace(/_/g, ""));
      }
    }
  }
  return undefined;
}

/**
 * The seeded tests of a file that have no timeout of MIN_MS or more. A test is seeded when its callback calls
 * `randomHistory` or a function of the same file that does (followed to any depth), so a `load()` helper cannot hide it.
 */
export function untimedSeeded(sf: ts.SourceFile): { line: number; ms: number | undefined }[] {
  const helpers = new Map<string, string>();
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) helpers.set(n.name.text, n.getText(sf));
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) helpers.set(n.name.text, n.initializer.getText(sf));
  });
  const seeded = new Set<string>();
  const reaches = (text: string) => text.includes("randomHistory(") || [...seeded].some((h) => new RegExp(`(?<![\\w$.])${h}\\(`).test(text));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, text] of helpers) {
      if (!seeded.has(name) && reaches(text)) {
        seeded.add(name);
        grew = true;
      }
    }
  }
  const found: { line: number; ms: number | undefined }[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !isTestCall(n.expression)) return;
    const body = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
    if (!body || !reaches(body.getText(sf))) return;
    const ms = timeoutOf(n.arguments);
    if (ms === undefined || ms < MIN_MS) found.push({ line: lineOf(sf, n), ms });
    return false;
  });
  return found;
}
