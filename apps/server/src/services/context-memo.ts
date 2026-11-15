/**
 * Work out of a cached context that requests repeat with the same arguments: the loan proposals of the dashboard and of
 * Tarkistettavat, and the questions of the queue. The header asks for the count of open questions on every page and the
 * front page reads the queue as well, and each of these reads the whole history. The context is built once per data
 * version (`services/analysis.ts`), so an answer is kept beside it per name and arguments: a mark, a rule or a new day
 * builds it again, and a new data version is a new context that drops them all with the old one.
 *
 * The arguments are compared as JSON, so a Map or a Set goes in as its entries. A kept answer is shared by the requests
 * that ask for it: a caller reads it and never changes it.
 */
import type { AnalysisContext } from "@banking/core";

/** A member's inputs change one answer at a time, so a few argument sets per name cover the pages open at once. */
const PER_NAME = 4;

const held = new WeakMap<AnalysisContext, Map<string, Map<string, unknown>>>();

export function memoOn<T>(ctx: AnalysisContext, name: string, args: unknown, build: () => T): T {
  let names = held.get(ctx);
  if (!names) held.set(ctx, (names = new Map()));
  let answers = names.get(name);
  if (!answers) names.set(name, (answers = new Map()));
  const key = JSON.stringify(args) ?? "";
  if (answers.has(key)) return answers.get(key) as T;
  const built = build();
  if (answers.size >= PER_NAME) answers.delete(answers.keys().next().value!);
  answers.set(key, built);
  return built;
}
