/**
 * Rule 42: a rate limiter is built from the limits schema (platform/limits.ts, services/limiters.ts), never from a
 * number written at the call. `new RateLimiter(5, ...)` or `new LoginLimiter(10, ...)` hides a limit from the admin who
 * can change it, and a second copy of a default drifts from the first. A name that is a constant of the same file with
 * a number as its value counts as a number.
 */
import ts from "typescript6";
import { lineOf, walk } from "./lib.ts";

const LIMITERS = new Set(["RateLimiter", "LoginLimiter"]);

/** True when the expression is made of numbers only: `5`, `15 * 60_000`, `-1`, `(2)`. */
function isNumeric(e: ts.Expression, consts: ReadonlyMap<string, ts.Expression>, seen = new Set<string>()): boolean {
  if (ts.isNumericLiteral(e)) return true;
  if (ts.isParenthesizedExpression(e)) return isNumeric(e.expression, consts, seen);
  if (ts.isPrefixUnaryExpression(e)) return isNumeric(e.operand, consts, seen);
  if (ts.isBinaryExpression(e)) return isNumeric(e.left, consts, seen) && isNumeric(e.right, consts, seen);
  if (ts.isIdentifier(e) && consts.has(e.text) && !seen.has(e.text)) return isNumeric(consts.get(e.text)!, consts, new Set(seen).add(e.text));
  return false;
}

/** The lines of `new RateLimiter(<number>, ...)` and `new LoginLimiter(<number>, ...)` in a file. */
export function handWrittenLimiters(sf: ts.SourceFile): { line: number; name: string }[] {
  const consts = new Map<string, ts.Expression>();
  walk(sf, (n) => {
    if (!ts.isVariableStatement(n) || !(n.declarationList.flags & ts.NodeFlags.Const)) return;
    for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  });
  const found: { line: number; name: string }[] = [];
  walk(sf, (n) => {
    if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression) || !LIMITERS.has(n.expression.text)) return;
    const first = n.arguments?.[0];
    if (first && isNumeric(first, consts)) found.push({ line: lineOf(sf, n), name: n.expression.text });
  });
  return found;
}
